import { helperClient } from './helper-client.js';
import { helperMessages, helperMessageSource, prepareHelperMessageChanges } from './helper-messages.js';

const safeScript = text => text.replace(/<\/script/gi, '<\\/script');
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export async function installHelperHost(host, st) {
    const { extension_settings } = await import('/scripts/extensions.js');
    const { executeSlashCommandsWithOptions } = await import('/scripts/slash-commands.js');
    const lodashSource = await (await fetch('/ste/helper-lodash.js')).text();
    const frames = new Map(), blocks = new Map(), inflight = new Set(), eventWaiters = new Map();
    let config, generation = 0, eventSerial = 0, writerBusy = false, scanTimer, mutationQueue = Promise.resolve();
    let controlsChanged = () => {};
    const scriptContainer = document.createElement('div'); scriptContainer.hidden = true; document.body.append(scriptContainer);
    // The enclosing document also restricts frame navigation, which a child CSP alone cannot do.
    const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "frame-src 'self'; object-src 'none'"; document.head.append(policy);
    const style = document.createElement('style'); style.textContent = '.ste-helper-source[hidden]{display:none!important}'; document.head.append(style);
    const events = Object.fromEntries(['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED',
        'MESSAGE_SWIPED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS',
        'GENERATION_ENDED', 'GENERATION_STOPPED'].filter(name => st.event_types[name]).map(name => [name, st.event_types[name]]));
    async function request(path, body) {
        const response = await host.request(path, body), data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? '脚本设置操作失败');
        return data;
    }
    const live = record => record.generation === generation && record.chatFile === st.getCurrentChatId() && frames.has(record.token) && record.frame.isConnected;
    function snapshot(record) {
        const readable = record.grants.includes('read');
        const script = config?.settings.scripts.find(script => script.id === record.scriptId);
        return { messages: readable ? helperMessages(st.chat) : [], sources: readable ? st.chat.map(helperMessageSource) : [],
            variables: readable ? structuredClone(st.chat_metadata.variables ?? {}) : {},
            globalVariables: readable ? structuredClone(extension_settings.variables?.global ?? {}) : {},
            scriptData: readable ? structuredClone(script?.data ?? {}) : {}, user: readable ? st.name1 : '', character: readable ? st.name2 : '' };
    }
    const post = (record, message) => { if (live(record)) record.frame.contentWindow?.postMessage({ steHelper: record.token, ...message }, '*'); };
    function showError(error, record) {
        const message = String(error?.message ?? error);
        if (record?.error === message) return;
        if (record) record.error = message;
        toastr.error(message, record?.name ?? '内置助手');
        controlsChanged();
    }
    function destroy(record) {
        frames.delete(record.token);
        if (record.generating) st.stopGeneration();
        for (const [id, waiter] of eventWaiters) if (waiter.record === record) { clearTimeout(waiter.timer); eventWaiters.delete(id); waiter.resolve(); }
        record.frame.remove();
        record.widget?.remove();
    }
    function dispose() {
        generation++;
        for (const record of [...frames.values()]) destroy(record);
        for (const [pre, block] of blocks) { observer.unobserve(block.wrapper); block.wrapper.remove(); pre.hidden = false; pre.classList.remove('ste-helper-source'); }
        blocks.clear();
    }
    function armEventTimeout(id, waiter) {
        clearTimeout(waiter.timer);
        waiter.timer = undefined;
        // A script awaiting an acknowledged host request is responsive. Its RPC
        // has its own client timeout; resume the idle deadline after the reply.
        if (waiter.record.pendingRequests) return;
        waiter.timer = setTimeout(() => {
            eventWaiters.delete(id);
            waiter.reject(new Error('脚本事件超过 5 秒未响应，请停用未响应的脚本'));
        }, 5000);
    }
    function updateEventTimeouts(record) {
        for (const [id, waiter] of eventWaiters) if (waiter.record === record) armEventTimeout(id, waiter);
    }
    function sendEvent(record, name, args, wait = true) {
        if (!live(record) || !record.ready) return Promise.resolve();
        const id = ++eventSerial;
        let result = Promise.resolve();
        if (wait) result = new Promise((resolve, reject) => {
            const waiter = { record, resolve, reject, timer: undefined };
            eventWaiters.set(id, waiter);
            armEventTimeout(id, waiter);
        });
        post(record, { kind: 'event', id, name, args, snapshot: snapshot(record) });
        return result;
    }
    function broadcast(name, args, wait = true, skipToken) {
        return Promise.all([...frames.values()].filter(record => record.token !== skipToken).map(record => sendEvent(record, name, args, wait).catch(error => showError(error, record))));
    }
    async function flush() {
        await Promise.all([...frames.values()].map(record => sendEvent(record, 'ste-helper-flush', [])));
        await Promise.all([...inflight]);
    }
    async function storeSettings(settings, current = config) {
        config = await request('/ste/helpers/save', { chatKey: current.chatKey, revision: current.revision, settings });
        return config;
    }
    function variableTarget(record, option = { type: 'chat' }) {
        if (option.type === 'chat') return { value: st.chat_metadata.variables ?? {}, apply: value => { st.chat_metadata.variables = value; } };
        if (option.type === 'global') return { value: extension_settings.variables?.global ?? {}, global: true,
            apply: value => { extension_settings.variables ??= {}; extension_settings.variables.global = value; } };
        if (option.type === 'script') {
            const script = config.settings.scripts.find(script => script.id === record.scriptId);
            if (!script) throw new Error('楼层内容没有独立的 script 变量，请使用 message 变量');
            return { value: script.data, script, apply: value => { script.data = value; } };
        }
        if (option.type === 'message' && Number.isInteger(option.message_id) && st.chat[option.message_id]) {
            const message = st.chat[option.message_id], index = message.swipe_id ?? 0;
            return { value: message.variables?.[index] ?? {}, source: helperMessageSource(message),
                apply: value => { message.variables ??= []; message.variables[index] = value; } };
        }
        throw new Error('变量作用域无效');
    }
    async function perform(record, method, args) {
        if (!live(record)) throw new Error('脚本所属聊天已切换');
        const requireGrant = grant => { if (!record.grants.includes(grant)) throw new Error(`脚本未获 ${grant} 权限`); };
        if (method === 'replaceVariables') {
            requireGrant('write');
            const target = variableTarget(record, args.option);
            if (JSON.stringify(target.value) !== args.expected || (target.source && target.source !== args.source)) throw new Error('变量或楼层已变化，请读取最新资料后重试');
            if (!args.value || typeof args.value !== 'object' || Array.isArray(args.value) || JSON.stringify(args.value).length > 512 * 1024) throw new Error('变量必须是 512 KiB 以内的 JSON 对象');
            if (target.script) {
                // Publish script variables only after the file write succeeds. A failed RPC
                // then replies with the last saved snapshot, rather than an unsaved config.
                const next = structuredClone(config.settings);
                next.scripts.find(script => script.id === record.scriptId).data = structuredClone(args.value);
                await storeSettings(next);
            } else {
                target.apply(structuredClone(args.value));
                if (target.global) { st.cancelPendingSettingsSave(); if (!await st.saveSettings()) throw new Error('全局变量尚未保存'); }
                else await st.saveChatConditional();
            }
            return null;
        }
        if (method === 'setChatMessages') {
            requireGrant('write');
            if (writerBusy || host.isGenerating()) throw new Error('正文生成期间请等待回复结束再修改楼层');
            const mode = args.options?.refresh ?? 'affected';
            if (!['none', 'affected', 'all'].includes(mode)) throw new Error('未知的消息刷新方式');
            const changes = prepareHelperMessageChanges(st.chat, args.messages, args.sources ?? [], args.baselines ?? []);
            for (const { id, message } of changes) Object.assign(st.chat[id], message);
            await st.saveChatConditional();
            if (!live(record)) return;
            if (mode === 'all') queueMicrotask(() => { void st.reloadCurrentChat(); });
            else if (mode === 'affected') for (const { id, message } of changes) {
                st.updateMessageBlock(id, message);
                document.querySelector(`#chat .mes[mesid="${id}"]`)?.setAttribute('is_system', String(message.is_system === true));
                // Do not wait on the caller's own rendered-event handler before returning its RPC.
                void st.eventSource.emit(message.is_user ? st.event_types.USER_MESSAGE_RENDERED : st.event_types.CHARACTER_MESSAGE_RENDERED, id, { ste_helper: record.token });
            }
            scheduleScan(); return null;
        }
        if (method === 'substitute') { requireGrant('read'); return st.substituteParams(String(args.text ?? '')); }
        if (method === 'triggerSlash') {
            requireGrant('write'); requireGrant('read');
            const command = String(args.command ?? '');
            if (!/^\/(?:pass|echo|getvar|setvar|addvar|incvar|decvar|getglobalvar|setglobalvar|len|trim)(?:\s|$)/.test(command)
                || /[|\r\n]|\{:|:\}/.test(command)) throw new Error('脚本内支持单条 pass/echo/变量/len/trim 命令；其他命令请在原输入框使用');
            const result = await executeSlashCommandsWithOptions(command, { handleParserErrors: false, handleExecutionErrors: false });
            await st.saveChatConditional(); st.cancelPendingSettingsSave();
            if (!await st.saveSettings()) throw new Error('命令设置尚未保存');
            return result?.pipe ?? '';
        }
        if (method === 'generate' || method === 'generateRaw') {
            requireGrant('generate'); requireGrant('read');
            if (writerBusy || host.isGenerating() || window.__STE_HELPER_GENERATING__) throw new Error('当前模型请求尚未结束，请稍后再试');
            if (Object.keys(args).some(key => !['user_input', 'should_stream', 'should_silence', ...(method === 'generateRaw' ? ['ordered_prompts'] : [])].includes(key))
                || args.should_stream === true || (args.user_input !== undefined && typeof args.user_input !== 'string')) throw new Error('内置助手当前支持非流式文本生成；不支持覆盖连接、图片或工具配置');
            record.generating = true; window.__STE_HELPER_GENERATING__ = true;
            try {
                if (method === 'generate') return await st.generateQuietPrompt({ quietPrompt: args.user_input ?? '' });
                const prompts = args.ordered_prompts ?? [];
                if (!Array.isArray(prompts) || prompts.some(item => !item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string')) throw new Error('generateRaw 需要 role/content 提示词；内置占位符暂未支持');
                return await st.generateRaw({ prompt: [...prompts, ...(args.user_input ? [{ role: 'user', content: args.user_input }] : [])] });
            } finally { record.generating = false; window.__STE_HELPER_GENERATING__ = false; }
        }
        throw new Error('未支持的助手调用：' + method);
    }
    const onMessage = event => {
        const record = frames.get(event.data?.steHelper);
        if (!record || event.source !== record.frame.contentWindow || !live(record)) return;
        const message = event.data;
        if (message.kind === 'ready') { record.ready = true; controlsChanged(); return; }
        if (message.kind === 'height') {
            if (record.messageId !== null || record.widget) record.frame.style.height = `${Math.max(80, Math.min(record.widget ? Math.max(80, innerHeight * .45) : 1200, Number(message.height) || 200))}px`;
            return;
        }
        if (message.kind === 'error') { showError(message.message, record); return; }
        if (message.kind === 'event-done') {
            const waiter = eventWaiters.get(message.id);
            if (waiter?.record === record) { clearTimeout(waiter.timer); eventWaiters.delete(message.id); message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(); }
            return;
        }
        if (message.kind !== 'request' || !Number.isSafeInteger(message.id) || message.id <= record.lastRequest || JSON.stringify(message).length > 4 * 1024 * 1024) return;
        record.lastRequest = message.id;
        record.pendingRequests++;
        updateEventTimeouts(record);
        const operation = mutationQueue.then(async () => {
            try { const result = await perform(record, message.method, object(message.args)); post(record, { kind: 'reply', id: message.id, result, snapshot: snapshot(record) }); }
            catch (error) { post(record, { kind: 'reply', id: message.id, error: error.message, snapshot: snapshot(record) }); showError(error, record); }
        });
        mutationQueue = operation.catch(() => {}); inflight.add(operation);
        void operation.finally(() => {
            inflight.delete(operation); record.pendingRequests--; updateEventTimeouts(record);
            for (const other of frames.values()) if (other !== record) post(other, { kind: 'snapshot', snapshot: snapshot(other) });
        });
    };
    window.addEventListener('message', onMessage);
    function makeFrame({ container, content, scriptId, name, grants, messageId = null, html = false }) {
        const token = crypto.randomUUID(), frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts'); frame.className = 'ste-helper-frame'; frame.title = name;
        frame.style.cssText = 'width:100%;border:0;min-height:80px;color-scheme:dark light';
        const record = { token, frame, name, grants: [...grants], scriptId, messageId, generation, chatFile: st.getCurrentChatId(), lastRequest: 0, pendingRequests: 0, ready: false };
        const init = { scriptId, messageId, grants, events, snapshot: snapshot(record) };
        const doc = new DOMParser().parseFromString(html ? content : '<!doctype html><html><head></head><body></body></html>', 'text/html');
        for (const element of doc.querySelectorAll('base, meta[http-equiv], script[src]')) element.remove();
        const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
        csp.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
        const api = doc.createElement('script'); api.textContent = safeScript(lodashSource) + '\n;(' + safeScript(helperClient.toString()) + ')(' + safeJson(init) + ',' + safeJson(token) + ');';
        doc.head.prepend(csp, api);
        if (!html) { const code = doc.createElement('script'); code.textContent = '(async()=>{\n' + safeScript(content) + '\n})().catch(error=>{throw error});'; doc.body.append(code); }
        frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
        frames.set(token, record); container.append(frame); return record;
    }
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const block = [...blocks.values()].find(block => block.wrapper === entry.target);
            if (!block) continue;
            if (!entry.isIntersecting) { if (block.record) destroy(block.record); block.record = null; continue; }
            if (block.record || writerBusy || [...frames.values()].filter(record => record.messageId !== null).length >= 8) continue;
            block.record = makeFrame({ container: block.wrapper, content: block.content, scriptId: null,
                messageId: block.messageId, name: `第 ${block.messageId} 楼交互内容`, grants: config.settings.html.grants, html: true });
        }
    }, { root: document.querySelector('#chat'), rootMargin: '160px' });
    function scan() {
        for (const [pre, block] of blocks) if (!pre.isConnected || pre.textContent !== block.content || !config?.settings.html.enabled) {
            if (block.record) destroy(block.record); observer.unobserve(block.wrapper); block.wrapper.remove(); pre.hidden = false; pre.classList.remove('ste-helper-source'); blocks.delete(pre);
        }
        if (!config?.settings.html.enabled || writerBusy) return;
        for (const code of document.querySelectorAll('#chat pre code.language-html, #chat pre code.language-htm, #chat pre code.custom-language-html, #chat pre code.custom-language-htm')) {
            const pre = code.closest('pre'); if (blocks.has(pre)) continue;
            const messageId = Number(code.closest('.mes')?.getAttribute('mesid'));
            if (!st.chat[messageId]) continue;
            const wrapper = document.createElement('div'); wrapper.className = 'ste-helper-html'; wrapper.style.minHeight = '160px';
            const block = { wrapper, content: code.textContent, messageId, record: null };
            pre.classList.add('ste-helper-source'); pre.hidden = true; pre.after(wrapper); blocks.set(pre, block); observer.observe(wrapper);
        }
    }
    function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 80); }
    const mutations = new MutationObserver(scheduleScan); mutations.observe(document.querySelector('#chat'), { childList: true, subtree: true });
    function mountScript(script) {
        const mode = script.id === 'ste-beautify-status' ? script.data?.ste_widget?.mode : undefined;
        if (mode !== 'inline' && mode !== 'floating') return makeFrame({ container: scriptContainer, ...script, scriptId: script.id });
        const widget = document.createElement('section'); widget.dataset.steWidget = mode;
        widget.style.cssText = 'flex:none;overflow:hidden;border:1px solid var(--SmartThemeBorderColor);border-radius:8px;background:var(--SmartThemeBlurTintColor);color:var(--SmartThemeBodyColor);margin:4px 8px;max-width:calc(100% - 16px)';
        if (mode === 'floating') widget.style.cssText += ';position:fixed;z-index:120;right:8px;bottom:104px;width:320px;max-width:calc(100vw - 32px)';
        const toggle = document.createElement('button'); toggle.className = 'menu_button'; toggle.style.cssText = 'width:100%;margin:0;text-align:left;min-height:32px';
        toggle.textContent = `${script.name} · 收起`; toggle.setAttribute('aria-expanded', 'true'); widget.append(toggle);
        const form = document.querySelector('#form_sheld');
        if (mode === 'inline' && form) form.before(widget); else document.body.append(widget);
        const record = makeFrame({ container: widget, ...script, scriptId: script.id }); record.widget = widget;
        record.frame.style.maxHeight = '45vh';
        toggle.addEventListener('click', () => { record.frame.hidden = !record.frame.hidden; toggle.setAttribute('aria-expanded', String(!record.frame.hidden)); toggle.textContent = `${script.name} · ${record.frame.hidden ? '展开' : '收起'}`; });
        return record;
    }
    async function refresh() {
        dispose(); const current = generation;
        const loaded = await request('/ste/helpers');
        if (generation !== current) return;
        config = loaded;
        for (const script of config.settings.scripts.filter(script => script.enabled)) mountScript(script);
        scheduleScan(); controlsChanged();
    }
    st.eventSource.makeFirst(st.event_types.CHAT_CHANGED, refresh);
    for (const name of Object.values(events).filter(name => name !== st.event_types.CHAT_CHANGED)) st.eventSource.on(name, async (...args) => {
        if (window.__STE_HELPER_GENERATING__) return;
        if ([st.event_types.GENERATION_STARTED, st.event_types.GENERATION_AFTER_COMMANDS].includes(name) && args[2] === true) return;
        if (name === st.event_types.GENERATION_STARTED && args[0] !== 'quiet') writerBusy = true;
        if (name === st.event_types.GENERATION_ENDED || name === st.event_types.GENERATION_STOPPED) writerBusy = false;
        await broadcast(name, args.filter(arg => typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean'), true, args.at(-1)?.ste_helper);
        scheduleScan();
    });
    window.__STE_HELPER_FLUSH__ = flush;
    window.__STE_HELPER_STATE__ = () => ({ frames: frames.size, scriptFrames: [...frames.values()].filter(frame => frame.messageId === null).length,
        htmlFrames: [...frames.values()].filter(frame => frame.messageId !== null).length, pending: inflight.size, eventWaiters: eventWaiters.size, writerBusy,
        listeners: Object.values(st.eventSource.events).reduce((total, listeners) => total + listeners.length, 0),
        listenerCounts: Object.fromEntries(Object.entries(st.eventSource.events).filter(([, listeners]) => listeners.length).map(([name, listeners]) => [name, listeners.length])) });
    window.addEventListener('pagehide', () => { dispose(); clearTimeout(scanTimer); mutations.disconnect(); observer.disconnect(); window.removeEventListener('message', onMessage); }, { once: true });
    await refresh();
    return { get settings() { return structuredClone(config.settings); }, get records() { return [...frames.values()]; },
        onChange(handler) { controlsChanged = handler; },
        async configure(settings) {
            const baseline = config, snapshot = structuredClone(settings);
            for (const record of [...frames.values()]) if (record.messageId === null
                ? !settings.scripts.some(script => script.id === record.scriptId && script.enabled)
                : !settings.html.enabled) destroy(record);
            await flush(); await storeSettings(snapshot, baseline); await refresh();
        },
        async importScripts(scripts) { await flush(); config = await request('/ste/helpers/import', { chatKey: config.chatKey, revision: config.revision, scripts }); await refresh(); },
        async button(scriptId, name) { const record = [...frames.values()].find(record => record.scriptId === scriptId); if (record) await sendEvent(record, 'ste-helper-button:' + name, []); },
        get lastMessageId() { return st.chat.length - 1; },
        async variables(option) { const target = variableTarget({}, option); return { value: structuredClone(target.value), source: target.source, chatFile: st.getCurrentChatId() }; },
        async saveVariables(option, value, previous) {
            if (previous.chatFile !== st.getCurrentChatId()) throw new Error('变量所属聊天已切换，请重新打开变量面板');
            const record = { grants: ['write'], generation, chatFile: st.getCurrentChatId(), token: '__panel', frame: scriptContainer };
            frames.set(record.token, record);
            try { await perform(record, 'replaceVariables', { option, value, expected: JSON.stringify(previous.value), source: previous.source }); }
            finally { frames.delete(record.token); }
            await broadcast('ste-helper:variables', []);
        }, flush };
}
