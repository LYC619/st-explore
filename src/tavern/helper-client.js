// This function is serialized into an opaque-origin frame. It has no parent module access.
export function helperClient(initial, token) {
    let snapshot = initial.snapshot, serial = 0, queue = Promise.resolve(), pending = 0, failure;
    const waiting = new Map(), listeners = new Map();
    const send = payload => parent.postMessage({ steHelper: token, ...payload }, '*');
    const clone = value => structuredClone(value);
    const requireGrant = grant => { if (!initial.grants.includes(grant)) throw new Error(`脚本未获 ${grant} 权限，请在扩展抽屉设置`); };
    function request(method, args) {
        const id = ++serial;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { waiting.delete(id); reject(new Error('脚本请求超时')); }, 120000);
            waiting.set(id, { resolve, reject, timeout }); send({ kind: 'request', id, method, args });
        });
    }
    function enqueue(method, args) {
        pending++;
        const result = queue.then(() => request(method, args)).then(reply => {
            if (pending === 1 && reply.snapshot) snapshot = reply.snapshot;
            return reply.result;
        });
        queue = result.catch(error => { failure = error; send({ kind: 'error', message: error.message }); }).finally(() => pending--);
        return result;
    }
    async function flushHelperWrites() { await queue; if (failure) { const error = failure; failure = undefined; throw error; } }
    function variableTarget(option = { type: 'chat' }) {
        if (option.type === 'chat') return { option: { type: 'chat' }, value: snapshot.variables };
        if (option.type === 'global') return { option: { type: 'global' }, value: snapshot.globalVariables };
        if (option.type === 'script' && (!option.script_id || option.script_id === initial.scriptId)) return { option: { type: 'script' }, value: snapshot.scriptData };
        if (option.type === 'message') {
            let id = option.message_id;
            if (id === undefined || id === 'latest') id = snapshot.messages.findLast(message => !message.is_hidden)?.message_id;
            else if (Number.isInteger(id) && id < 0) id += snapshot.messages.length;
            if (!Number.isInteger(id) || !snapshot.messages[id]) throw new Error('变量所属楼层不存在');
            return { option: { type: 'message', message_id: id }, value: snapshot.messages[id].data, source: snapshot.sources[id] };
        }
        throw new Error('当前支持 chat、message、global 和本脚本的 script 变量');
    }
    function getVariables(option) { requireGrant('read'); return clone(variableTarget(option).value); }
    function replaceTarget(value, target) {
        requireGrant('write');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('变量必须是 JSON 对象');
        const next = JSON.parse(JSON.stringify(value));
        const args = { option: target.option, expected: JSON.stringify(target.value), value: next, source: target.source };
        if (target.option.type === 'chat') snapshot.variables = next;
        else if (target.option.type === 'global') snapshot.globalVariables = next;
        else if (target.option.type === 'script') snapshot.scriptData = next;
        else { const message = snapshot.messages[target.option.message_id]; message.data = next; message.swipes_data[message.swipe_id] = next; }
        void enqueue('replaceVariables', args).catch(() => {});
    }
    function replaceVariables(value, option) { requireGrant('write'); replaceTarget(value, variableTarget(option)); }
    function updateVariablesWith(updater, option) {
        requireGrant('read');
        const initial = variableTarget(option), target = { ...initial, value: clone(initial.value) };
        const result = updater(clone(target.value));
        const apply = value => {
            const latest = variableTarget(target.option);
            if (JSON.stringify(latest.value) !== JSON.stringify(target.value) || latest.source !== target.source) throw new Error('变量或楼层已变化，请读取最新资料后重试');
            replaceTarget(value, target); return clone(value);
        };
        return result?.then ? result.then(apply) : apply(result);
    }
    const insertOrAssignVariables = (variables, option) => updateVariablesWith(current => _.merge(current, clone(variables)), option);
    const insertVariables = (variables, option) => updateVariablesWith(current => _.defaultsDeep(current, clone(variables)), option);
    function deleteVariable(path, option) {
        const variables = getVariables(option), delete_occurred = _.has(variables, path);
        _.unset(variables, path); replaceVariables(variables, option); return { variables, delete_occurred };
    }
    function substitudeMacros(text) {
        requireGrant('read');
        return String(text).replace(/\{\{(.*?)\}\}/g, (_whole, macro) => {
            if (macro === 'char') return snapshot.character;
            if (macro === 'user') return snapshot.user;
            if (macro === 'lastMessageId') return String(snapshot.messages.length - 1);
            if (macro.startsWith('getvar::')) return String(_.get(snapshot.variables, macro.slice(8), ''));
            if (macro.startsWith('getglobalvar::')) return String(_.get(snapshot.globalVariables, macro.slice(14), ''));
            throw new Error('同步宏暂不支持 {{' + macro + '}}；其他宏可通过 steSubstituteMacros 异步展开');
        });
    }
    function getChatMessages(range, options = {}) {
        requireGrant('read');
        const text = substitudeMacros(range), match = /^(-?\d+)(?:-(-?\d+))?$/.exec(text);
        if (!match) return [];
        const index = value => Number(value) < 0 ? snapshot.messages.length + Number(value) : Number(value);
        const [start, end] = [index(match[1]), index(match[2] ?? match[1])].sort((a, b) => a - b);
        return snapshot.messages.filter(message => message.message_id >= start && message.message_id <= end
            && (!options.role || options.role === 'all' || message.role === options.role)
            && (!options.hide_state || options.hide_state === 'all' || message.is_hidden === (options.hide_state === 'hidden'))).map(message => {
            const base = { message_id: message.message_id, name: message.name, role: message.role, is_hidden: message.is_hidden };
            return clone(options.include_swipes ? { ...base, swipe_id: message.swipe_id, swipes: message.swipes, swipes_data: message.swipes_data, swipes_info: message.swipes_info }
                : { ...base, message: message.message, data: message.data, extra: message.extra });
        });
    }
    async function setChatMessages(messages, options = {}) {
        requireGrant('write'); await flushHelperWrites();
        return enqueue('setChatMessages', { messages, options, sources: snapshot.sources, baselines: snapshot.messages.map(message => ({ data: message.data, extra: message.extra })) });
    }
    function eventOn(name, listener) {
        if (typeof name !== 'string' || typeof listener !== 'function') throw new Error('事件名与监听函数无效');
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(listener);
        return { stop: () => { listeners.get(name)?.delete(listener); if (!listeners.get(name)?.size) listeners.delete(name); } };
    }
    function eventOnce(name, listener) { const handle = eventOn(name, async (...args) => { handle.stop(); await listener(...args); }); return handle; }
    function eventRemoveListener(name, listener) { listeners.get(name)?.delete(listener); }
    function eventClearAll() { listeners.clear(); }
    async function deliver(name, args) { for (const listener of [...listeners.get(name) ?? []]) await listener(...args); await flushHelperWrites(); }
    async function generate(config = {}) { requireGrant('generate'); requireGrant('read'); await flushHelperWrites(); return enqueue('generate', config); }
    async function generateRaw(config = {}) { requireGrant('generate'); requireGrant('read'); await flushHelperWrites(); return enqueue('generateRaw', config); }
    async function triggerSlash(command) { requireGrant('write'); requireGrant('read'); await flushHelperWrites(); return enqueue('triggerSlash', { command }); }
    async function steSubstituteMacros(text) { requireGrant('read'); return enqueue('substitute', { text }); }
    async function eventEmit(name, ...args) {
        if (Object.values(initial.events).includes(name)) throw new Error('脚本不能伪造酒馆生命周期事件');
        await deliver(name, args);
    }
    const api = { getVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables, insertVariables, deleteVariable,
        getChatMessages, setChatMessages, eventOn, eventOnce, eventRemoveListener, eventClearAll, eventEmit,
        generate, generateRaw, triggerSlash, substitudeMacros, steSubstituteMacros, flushHelperWrites,
        getLastMessageId: () => { requireGrant('read'); return snapshot.messages.length - 1; },
        getCurrentMessageId: () => { if (initial.messageId === null) throw new Error('当前不是楼层内嵌内容'); return initial.messageId; },
        getScriptId: () => initial.scriptId, getButtonEvent: name => 'ste-helper-button:' + name };
    Object.assign(globalThis, api, { TavernHelper: Object.freeze({ ...api }), tavern_events: Object.freeze(initial.events) });
    addEventListener('message', async event => {
        if (event.source !== parent || event.data?.steHelper !== token) return;
        const message = event.data;
        if (message.kind === 'reply') {
            const receiver = waiting.get(message.id); if (!receiver) return;
            waiting.delete(message.id); clearTimeout(receiver.timeout);
            if (message.error) { if (pending === 1 && message.snapshot) snapshot = message.snapshot; receiver.reject(new Error(message.error)); }
            else receiver.resolve(message);
        } else if (message.kind === 'event') {
            try { if (!pending && message.snapshot) snapshot = message.snapshot; await deliver(message.name, message.args ?? []); send({ kind: 'event-done', id: message.id }); }
            catch (error) { send({ kind: 'event-done', id: message.id, error: error.message }); }
        } else if (message.kind === 'snapshot' && !pending) snapshot = message.snapshot;
    });
    addEventListener('error', event => send({ kind: 'error', message: event.message }));
    addEventListener('unhandledrejection', event => send({ kind: 'error', message: String(event.reason?.message ?? event.reason) }));
    // Native frame teardown removes timers and listeners, including those created by user scripts.
    new ResizeObserver(() => send({ kind: 'height', height: Math.ceil(document.documentElement.scrollHeight) })).observe(document.documentElement);
    send({ kind: 'ready' });
}
