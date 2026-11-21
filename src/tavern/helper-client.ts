import type { HelperGrant } from '../lib/roleplay/helper-settings';
import type { GenerateOptions, HelperInitial, HelperRequests, HelperSnapshot, HelperToHost, HostToHelper, ResolvedVariableOption, VariableOption } from './protocol.js';
import type { Lodash } from './upstream.js';

// Pinned lodash bundle is prepended directly into the isolated frame before helperClient executes.
declare const _: Lodash;

interface ChatMessageFilterOptions {
    role?: 'all' | 'user' | 'assistant' | 'system';
    hide_state?: 'all' | 'hidden' | 'unhidden';
    include_swipes?: boolean;
}
interface VariableTarget {
    option: ResolvedVariableOption;
    value: Record<string, unknown>;
    source?: string;
}
interface PendingRequest {
    resolve(reply: Extract<HostToHelper, { kind: 'reply' }>): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
}
type EventListenerFn = (...args: unknown[]) => unknown;

// This function is serialized into an opaque-origin frame. It has no parent module access.
export function helperClient(initial: HelperInitial, token: string): void {
    let snapshot: HelperSnapshot = initial.snapshot, serial = 0, queue: Promise<unknown> = Promise.resolve(), pending = 0, failure: unknown;
    const waiting = new Map<number, PendingRequest>(), listeners = new Map<string, Set<EventListenerFn>>();
    const send = (payload: HelperToHost) => parent.postMessage({ steHelper: token, ...payload }, '*');
    const clone = <T>(value: T): T => structuredClone(value);
    const requireGrant = (grant: HelperGrant) => { if (!initial.grants.includes(grant)) throw new Error(`脚本未获 ${grant} 权限，请在扩展抽屉设置`); };
    function request<K extends keyof HelperRequests>(method: K, args: HelperRequests[K]): Promise<Extract<HostToHelper, { kind: 'reply' }>> {
        const id = ++serial;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { waiting.delete(id); reject(new Error('脚本请求超时')); }, 120000);
            waiting.set(id, { resolve, reject, timeout }); send({ kind: 'request', id, method, args } as HelperToHost);
        });
    }
    function enqueue<K extends keyof HelperRequests>(method: K, args: HelperRequests[K]): Promise<unknown> {
        pending++;
        const result = queue.then(() => request(method, args)).then(reply => {
            if (pending === 1 && reply.snapshot) snapshot = reply.snapshot;
            return reply.result;
        });
        queue = result.catch((error: unknown) => {
            failure = error;
            send({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }).finally(() => pending--);
        return result;
    }
    async function flushHelperWrites(): Promise<void> { await queue; if (failure) { const error = failure; failure = undefined; throw error; } }
    function variableTarget(option: VariableOption = { type: 'chat' }): VariableTarget {
        if (option.type === 'chat') return { option: { type: 'chat' }, value: snapshot.variables };
        if (option.type === 'global') return { option: { type: 'global' }, value: snapshot.globalVariables };
        if (option.type === 'script' && (!option.script_id || option.script_id === initial.scriptId)) return { option: { type: 'script' }, value: snapshot.scriptData };
        if (option.type === 'message') {
            let id: number | 'latest' | undefined = option.message_id;
            if (id === undefined || id === 'latest') {
                id = [...snapshot.messages].reverse().find(message => !message.is_hidden)?.message_id;
            } else if (Number.isInteger(id) && id < 0) {
                id += snapshot.messages.length;
            }
            if (typeof id !== 'number' || !Number.isInteger(id) || !snapshot.messages[id]) throw new Error('变量所属楼层不存在');
            return { option: { type: 'message', message_id: id }, value: snapshot.messages[id].data, source: snapshot.sources[id] };
        }
        throw new Error('当前支持 chat、message、global 和本脚本的 script 变量');
    }
    function getVariables(option?: VariableOption): Record<string, unknown> { requireGrant('read'); return clone(variableTarget(option).value); }
    function replaceTarget(value: unknown, target: VariableTarget): void {
        requireGrant('write');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('变量必须是 JSON 对象');
        const next = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
        const args: HelperRequests['replaceVariables'] = { option: target.option, expected: JSON.stringify(target.value), value: next, source: target.source };
        if (target.option.type === 'chat') snapshot.variables = next;
        else if (target.option.type === 'global') snapshot.globalVariables = next;
        else if (target.option.type === 'script') snapshot.scriptData = next;
        else if (target.option.message_id !== undefined) {
            const message = snapshot.messages[target.option.message_id];
            message.data = next;
            message.swipes_data[message.swipe_id] = next;
        }
        void enqueue('replaceVariables', args).catch(() => {});
    }
    function replaceVariables(value: Record<string, unknown>, option?: VariableOption): void { requireGrant('write'); replaceTarget(value, variableTarget(option)); }
    function updateVariablesWith<T extends Record<string, unknown>>(
        updater: (current: Record<string, unknown>) => T | Promise<T>,
        option?: VariableOption,
    ): T | Promise<T> {
        requireGrant('read');
        const initialTarget = variableTarget(option), target: VariableTarget = { ...initialTarget, value: clone(initialTarget.value) };
        const result = updater(clone(target.value));
        const apply = (value: T): T => {
            const latest = variableTarget(target.option);
            if (JSON.stringify(latest.value) !== JSON.stringify(target.value) || latest.source !== target.source) throw new Error('变量或楼层已变化，请读取最新资料后重试');
            replaceTarget(value, target); return clone(value);
        };
        return result && typeof (result as Promise<T>).then === 'function' ? (result as Promise<T>).then(apply) : apply(result as T);
    }
    const insertOrAssignVariables = (variables: Record<string, unknown>, option?: VariableOption) => updateVariablesWith(current => _.merge(current, clone(variables)), option);
    const insertVariables = (variables: Record<string, unknown>, option?: VariableOption) => updateVariablesWith(current => _.defaultsDeep(current, clone(variables)), option);
    function deleteVariable(path: string, option?: VariableOption): { variables: Record<string, unknown>; delete_occurred: boolean } {
        const variables = getVariables(option), delete_occurred = _.has(variables, path);
        _.unset(variables, path); replaceVariables(variables, option); return { variables, delete_occurred };
    }
    function substitudeMacros(text: string | number): string {
        requireGrant('read');
        return String(text).replace(/\{\{(.*?)\}\}/g, (_whole, macro: string) => {
            if (macro === 'char') return snapshot.character;
            if (macro === 'user') return snapshot.user;
            if (macro === 'lastMessageId') return String(snapshot.messages.length - 1);
            if (macro.startsWith('getvar::')) return String(_.get(snapshot.variables, macro.slice(8), ''));
            if (macro.startsWith('getglobalvar::')) return String(_.get(snapshot.globalVariables, macro.slice(14), ''));
            throw new Error('同步宏暂不支持 {{' + macro + '}}；其他宏可通过 steSubstituteMacros 异步展开');
        });
    }
    function getChatMessages(range: string | number, options: ChatMessageFilterOptions = {}) {
        requireGrant('read');
        const text = substitudeMacros(range), match = /^(-?\d+)(?:-(-?\d+))?$/.exec(text);
        if (!match) return [];
        const index = (value: string) => Number(value) < 0 ? snapshot.messages.length + Number(value) : Number(value);
        const [start, end] = [index(match[1]), index(match[2] ?? match[1])].sort((a, b) => a - b);
        return snapshot.messages.filter(message => message.message_id >= start && message.message_id <= end
            && (!options.role || options.role === 'all' || message.role === options.role)
            && (!options.hide_state || options.hide_state === 'all' || message.is_hidden === (options.hide_state === 'hidden'))).map(message => {
            const base = { message_id: message.message_id, name: message.name, role: message.role, is_hidden: message.is_hidden };
            return clone(options.include_swipes ? { ...base, swipe_id: message.swipe_id, swipes: message.swipes, swipes_data: message.swipes_data, swipes_info: message.swipes_info }
                : { ...base, message: message.message, data: message.data, extra: message.extra });
        });
    }
    async function setChatMessages(messages: unknown[], options: { refresh?: string } = {}): Promise<unknown> {
        requireGrant('write'); await flushHelperWrites();
        return enqueue('setChatMessages', { messages, options, sources: snapshot.sources, baselines: snapshot.messages.map(message => ({ data: message.data, extra: message.extra })) });
    }
    function eventOn(name: string, listener: EventListenerFn): { stop(): void } {
        if (typeof name !== 'string' || typeof listener !== 'function') throw new Error('事件名与监听函数无效');
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
        return { stop: () => { listeners.get(name)?.delete(listener); if (!listeners.get(name)?.size) listeners.delete(name); } };
    }
    function eventOnce(name: string, listener: EventListenerFn): { stop(): void } {
        const handle = eventOn(name, async (...args: unknown[]) => { handle.stop(); await listener(...args); });
        return handle;
    }
    function eventRemoveListener(name: string, listener: EventListenerFn): void { listeners.get(name)?.delete(listener); }
    function eventClearAll(): void { listeners.clear(); }
    async function deliver(name: string, args: unknown[]): Promise<void> { for (const listener of [...(listeners.get(name) ?? [])]) await listener(...args); await flushHelperWrites(); }
    async function generate(config: GenerateOptions = {}): Promise<unknown> { requireGrant('generate'); requireGrant('read'); await flushHelperWrites(); return enqueue('generate', config); }
    async function generateRaw(config: GenerateOptions = {}): Promise<unknown> { requireGrant('generate'); requireGrant('read'); await flushHelperWrites(); return enqueue('generateRaw', config); }
    async function triggerSlash(command: string): Promise<unknown> { requireGrant('write'); requireGrant('read'); await flushHelperWrites(); return enqueue('triggerSlash', { command }); }
    async function steSubstituteMacros(text: string): Promise<unknown> { requireGrant('read'); return enqueue('substitute', { text }); }
    async function eventEmit(name: string, ...args: unknown[]): Promise<void> {
        if (Object.values(initial.events).includes(name)) throw new Error('脚本不能伪造酒馆生命周期事件');
        await deliver(name, args);
    }
    const api = { getVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable,
        getChatMessages, setChatMessages, eventOn, eventOnce, eventRemoveListener, eventClearAll, eventEmit,
        generate, generateRaw, triggerSlash, substitudeMacros, steSubstituteMacros, flushHelperWrites,
        getLastMessageId: () => { requireGrant('read'); return snapshot.messages.length - 1; },
        getCurrentMessageId: () => { if (initial.messageId === null) throw new Error('当前不是楼层内嵌内容'); return initial.messageId; },
        getScriptId: () => initial.scriptId, getButtonEvent: (name: string) => 'ste-helper-button:' + name };
    Object.assign(globalThis, api, { TavernHelper: Object.freeze({ ...api }), tavern_events: Object.freeze(initial.events) });
    addEventListener('message', async (event: MessageEvent) => {
        if (event.source !== parent || !event.data || typeof event.data !== 'object' || (event.data as { steHelper?: unknown }).steHelper !== token) return;
        const message = event.data as HostToHelper;
        if (message.kind === 'reply') {
            const receiver = waiting.get(message.id); if (!receiver) return;
            waiting.delete(message.id); clearTimeout(receiver.timeout);
            if (message.error) { if (pending === 1 && message.snapshot) snapshot = message.snapshot; receiver.reject(new Error(message.error)); }
            else receiver.resolve(message);
        } else if (message.kind === 'event') {
            try { if (!pending && message.snapshot) snapshot = message.snapshot; await deliver(message.name, message.args ?? []); send({ kind: 'event-done', id: message.id }); }
            catch (error: unknown) { send({ kind: 'event-done', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
        } else if (message.kind === 'snapshot' && !pending) snapshot = message.snapshot;
    });
    addEventListener('error', event => send({ kind: 'error', message: event.message }));
    addEventListener('unhandledrejection', event => {
        const reason = event.reason as { message?: unknown } | unknown;
        const message = reason && typeof reason === 'object' && 'message' in reason ? String((reason as { message?: unknown }).message) : String(reason);
        send({ kind: 'error', message });
    });
    // Native frame teardown removes timers and listeners, including those created by user scripts.
    new ResizeObserver(() => send({ kind: 'height', height: Math.ceil(document.documentElement.scrollHeight) })).observe(document.documentElement);
    send({ kind: 'ready' });
}
