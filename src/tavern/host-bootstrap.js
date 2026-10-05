// Served as /tauri-main.js inside the original ST document. All persistence stays in the parent STE app.
import { lodash } from './lib.js';
import { installDraftRecovery } from '/ste/draft-recovery.js';
import { captureRecoveryFile } from '/ste/recovery-export.js';
import { installRegexAssets } from '/ste/regex-assets.js';
import { installHelperHost } from '/ste/helper-host.js';
import { installHelperControls } from '/ste/helper-controls.js';
import { installPackageControls } from '/ste/package-controls.js';

const channel = new URLSearchParams(location.search).get('host');
const host = window.parent.__STE_TAVERN_HOSTS__?.get(channel);
if (!host) throw new Error('请从 STE 的聊天或故事页面打开酒馆');
window._ = lodash;
// ST normally lives at /. At /tavern.html, jQuery UI otherwise treats #tab
// links resolved against <base href="/"> as remote and inserts a second document.
const documentBase = document.querySelector('base');
if (documentBase) documentBase.href = location.href;

window.__STE_STAMP_CHAT__ = (messages) => {
    const seen = new Set();
    for (const message of messages) {
        message.extra ??= {};
        const identity = message.extra.ste_runtime ?? {};
        const messageId = identity.messageId ?? crypto.randomUUID();
        if (seen.has(messageId)) throw new Error('消息 ID 重复，保存已停止，正文未覆盖');
        seen.add(messageId);
        message.extra.ste_runtime = { ...identity, messageId,
            role: message.is_user ? 'user' : identity.role === 'system' || ['system', 'narrator', 'comment'].includes(message.extra.type) ? 'system' : 'assistant' };
        if (Array.isArray(message.swipes)) {
            message.swipe_info ??= [];
            message.swipes.forEach((_, index) => {
                const info = message.swipe_info[index] ??= {};
                info.extra ??= {};
                info.extra.ste_runtime = { ...info.extra.ste_runtime, messageId, role: message.extra.ste_runtime.role,
                    candidateId: info.extra.ste_runtime?.candidateId
                        ?? (index === 0 && identity.candidateId === `${messageId}:main` ? identity.candidateId : crypto.randomUUID()) };
            });
            message.extra.ste_runtime.candidateId = message.swipe_info[message.swipe_id ?? 0]?.extra.ste_runtime.candidateId;
        } else message.extra.ste_runtime.candidateId ??= `${messageId}:main`;
    }
};
window.__STE_NEW_MESSAGE_ID__ = message => {
    delete message.extra?.ste_runtime;
    for (const info of message.swipe_info ?? []) delete info.extra?.ste_runtime;
    window.__STE_STAMP_CHAT__([message]);
};
window.__STE_OPEN_CARD_EDITOR__ = card => {
    const form = document.querySelector('#form_create');
    if (!form) return;
    let revision = form.querySelector('input[name="_ste_revision"]');
    if (!revision) { revision = document.createElement('input'); revision.type = 'hidden'; revision.name = '_ste_revision'; form.append(revision); }
    revision.value = card._ste_revision ?? ''; revision.dataset.avatar = card.avatar;
};

async function invoke(command, args) {
    if (command === 'read_frontend_template' || command === 'read_frontend_extension_template') {
        const name = String(args?.name ?? '');
        const extension = command === 'read_frontend_extension_template' ? String(args?.extension ?? '') : null;
        if (!/^[\w.-]+$/.test(name) || name.includes('..') || (extension !== null && !/^[\w-]+$/.test(extension))) {
            throw new Error('无效的酒馆模板路径');
        }
        const path = extension === null ? '/scripts/templates/' + name : '/scripts/extensions/' + extension + '/' + name + '.html';
        const response = await originalFetch(path);
        if (!response.ok) throw new Error('找不到酒馆模板：' + name);
        return response.text();
    }
    const response = await host.request('/ste/invoke', { command, args });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? `STE 不支持此命令：${command}`);
    return data;
}

window.__TAURI__ = {
    core: { invoke, convertFileSrc: path => path },
    event: { listen: async (name, listener) => {
        const handler = event => listener({ event: name, payload: event.detail });
        window.addEventListener(name, handler);
        return () => window.removeEventListener(name, handler);
    } },
};
window.__TAURITAVERN__ = { invoke: { safeInvoke: invoke, flushAll: () => host.flush() }, api: {}, iosPolicy: null };
window.__TAURITAVERN_THUMBNAIL__ = (type, file) => host.thumbnail(type, file);

function apiPath(input) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    return url.origin === location.origin && (url.pathname.startsWith('/api/') || ['/csrf-token', '/version'].includes(url.pathname))
        ? url.pathname + url.search : null;
}
function parseBody(body) {
    if (body instanceof FormData) return Object.fromEntries([...new Set(body.keys())].map(key => {
        const values = body.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
    }));
    if (typeof body === 'string') return body ? JSON.parse(body) : undefined;
    return body;
}
const originalFetch = window.fetch.bind(window);
let generationType = 'normal';
let responseTurn;
let worldEntries = [];
let worldHandled = false;
let worldPreparationError;
window.__STE_AGENT_MODE__ = false;
window.__STE_EFFECTIVE_WORLDS__ = async entries => {
    try {
        const [response, storyResponse] = await Promise.all([host.request('/ste/worldbook-versions/effective'), host.request('/ste/story-worlds')]);
        const versions = await response.json();
        if (!response.ok) throw new Error(versions.error?.message ?? '世界书版本读取失败');
        const storyEntries = await storyResponse.json();
        if (!storyResponse.ok) throw new Error(storyEntries.error?.message ?? '故事世界书读取失败');
        const seen = new Set(entries.map(entry => JSON.stringify([entry.world, String(entry.uid)])));
        entries = [...entries, ...storyEntries.filter(entry => { const key = JSON.stringify([entry.world, String(entry.uid)]); if (seen.has(key)) return false; seen.add(key); return true; })];
        return entries.map(entry => {
            const version = versions.find(item => item.world === entry.world && String(item.uid) === String(entry.uid));
            return version ? { ...entry, content: version.content } : entry;
        });
    } catch (error) { worldPreparationError = error; throw error; }
};
window.__STE_WORLD_PROMPT__ = async entries => {
    const st = stModule ?? await import('./script.js');
    const { getRegexedString, regex_placement } = await import('./scripts/extensions/regex/engine.js');
    const expand = text => st.substituteParams(getRegexedString(text, regex_placement.WORLD_INFO, { isPrompt: true }));
    host.setWorldTransformer(expand);
    worldEntries = entries.filter(entry => !entry.disable).map(entry => ({ world: entry.world, uid: entry.uid }));
    worldHandled = true;
    const blue = entries.filter(entry => !entry.disable && entry.constant).map(entry => expand(entry.content)).join('\n\n');
    return { worldInfoString: blue, worldInfoBefore: blue, worldInfoAfter: '', worldInfoExamples: [], worldInfoDepth: [],
        anBefore: [], anAfter: [], outletEntries: {}, worldInfoActivation: { trigger: generationType, activated: { entries: [] } } };
};
window.fetch = async (input, options = {}) => {
    const path = apiPath(input);
    if (!path) return originalFetch(input, options);
    const rawBody = options.body ?? (typeof input === 'object' && input.clone ? await input.clone().text() : undefined);
    const body = parseBody(rawBody);
    if (path === '/api/backends/chat-completions/generate' && stModule) {
        const type = typeof body.type === 'string' ? body.type : 'quiet';
        if (worldPreparationError && !['quiet', 'impersonate'].includes(type)) throw worldPreparationError;
        const { oai_settings } = await import('./scripts/openai.js');
        window.__STE_STAMP_CHAT__(stModule.chat);
        body.ste_context = { type, ...(window.__STE_HELPER_GENERATING__ ? { source: 'helper' } : {}), worldHandled, worldEntries, maxContext: oai_settings.openai_max_context,
            chat: [{ chat_metadata: structuredClone(stModule.chat_metadata) }, ...structuredClone(stModule.chat)] };
    }
    const response = await host.request(path, body, options.signal ?? input?.signal);
    if (path.split('?')[0] === '/api/characters/edit' && response.ok) {
        const saved = await response.clone().json();
        const revision = document.querySelector('#form_create input[name="_ste_revision"]');
        if (revision?.dataset.avatar === body.avatar_url && typeof saved._ste_revision === 'string') revision.value = saved._ste_revision;
    }
    if (path === '/api/backends/chat-completions/generate' && !['quiet', 'impersonate'].includes(body.ste_context?.type)) responseTurn = response.headers.get('x-ste-turn-id');
    if (path === '/api/chats/save') {
        window.__STE_SAVE_FAILED__ = !response.ok;
        if (response.ok) queueMicrotask(() => { void window.__STE_DRAFT_CAPTURE__?.().catch(() => {}); });
    }
    return response;
};

// Token counting is one of the remaining synchronous upstream jQuery contracts.
const originalAjax = $.ajax.bind($);
$.ajax = (urlOrOptions, maybeOptions) => {
    const options = typeof urlOrOptions === 'string' ? { ...maybeOptions, url: urlOrOptions } : { ...urlOrOptions };
    const path = options.url && apiPath(options.url);
    if (!path) return originalAjax(urlOrOptions, maybeOptions);
    const deferred = $.Deferred();
    const controller = new AbortController();
    const xhr = deferred.promise({ abort: () => controller.abort(), status: 0 });
    const succeed = data => {
        xhr.status = 200; xhr.responseJSON = data;
        options.success?.(data, 'success', xhr);
        deferred.resolve(data, 'success', xhr);
        options.complete?.(xhr, 'success');
    };
    const fail = error => {
        xhr.status = error.status ?? 500;
        options.error?.(xhr, 'error', error);
        deferred.reject(xhr, 'error', error);
        options.complete?.(xhr, 'error');
    };
    if (options.async === false) {
        try { succeed(host.tokenize(path, parseBody(options.data))); } catch (error) { fail(error); }
    } else {
        host.request(path, parseBody(options.data), controller.signal).then(async response => {
            if (!response.ok) throw Object.assign(new Error((await response.json()).error?.message ?? 'STE 请求失败'), { status: response.status });
            return options.dataType === 'text' ? response.text() : response.json();
        }).then(succeed, fail);
    }
    return xhr;
};

window.__STE_BAIBAI_HIDE__ = message => {
    message.extra ??= {};
    if (!message.extra.bbs_hidden) message.extra.ste_baibai_hidden_before = message.is_system === true;
    message.extra.bbs_hidden = true;
};
async function flushBaiBai() {
    const started = Date.now();
    while (window.__STE_BAIBAI_BUSY__?.()) {
        if (Date.now() - started > 30_000) throw new Error('柏宝书仍在整理记忆，已保留当前聊天，请完成后再离开');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await window.__STE_BAIBAI_FLUSH__?.();
}
async function restoreBaiBaiHidden(st) {
    let changed = false;
    for (const [index, message] of st.chat.entries()) {
        if (!message.extra?.bbs_hidden) continue;
        message.is_system = message.extra.ste_baibai_hidden_before === true || message.extra.ste_runtime?.role === 'system';
        delete message.extra.bbs_hidden; delete message.extra.ste_baibai_hidden_before;
        $(`#chat .mes[mesid="${index}"]`).attr('is_system', String(message.is_system));
        changed = true;
    }
    if (changed) await st.saveChatConditional();
}
window.__STE_TAVERN_FLUSH__ = async () => {
    const st = await import('./script.js');
    st.stopGeneration();
    await st.waitForGenerationIdle();
    await window.__STE_HELPER_FLUSH__?.();
    await flushBaiBai();
    const editor = $('#chat .edit_textarea').closest('.mes').find('.mes_edit_done');
    if (editor.length) await st.messageEditDone(editor);
    await st.flushDebouncedChatSave();
    // An earlier debounced write may have failed and cleared its timer. Retry the current chat.
    await st.saveChatConditional();
    st.cancelPendingSettingsSave();
    if (!await st.saveSettings()) throw new Error('酒馆设置尚未保存');
    await host.flush();
    await window.__STE_DRAFT_CAPTURE__?.();
};
window.__STE_BEFORE_CHAT_SWITCH__ = async () => {
    if (stModule?.getCurrentChatId() === undefined) return;
    // A slash command such as /branch-create can switch chats from inside Generate.
    // Waiting for that enclosing command to finish here would wait for ourselves.
    if (host.isRequestActive()) { stModule.stopGeneration(); await stModule.waitForGenerationIdle(); }
    await window.__STE_HELPER_FLUSH__?.();
    await flushBaiBai();
    const editor = $('#chat .edit_textarea').closest('.mes').find('.mes_edit_done');
    if (editor.length) await stModule.messageEditDone(editor);
    await stModule.flushDebouncedChatSave();
    await stModule.saveChatConditional();
    await host.flush();
    await window.__STE_DRAFT_CAPTURE__?.();
};
let stModule;
window.__STE_TAVERN_SNAPSHOT__ = async () => captureRecoveryFile(stModule ?? await import('./script.js'));
window.__STE_TAVERN_OPEN_SETTINGS__ = async section => {
    if (section === 'chat') {
        // Invoke the native menu handler without bubbling an off-frame click to
        // upstream's document handler, which closes menus without hover/focus.
        $('#options_button').triggerHandler('click');
        return;
    }
    if (section === 'branches') {
        const { Popup, POPUP_TYPE } = await import('./scripts/popup.js');
        const st = stModule ?? await import('./script.js');
        const response = await host.request('/ste/branches');
        const snapshot = await response.json();
        if (!response.ok) throw new Error(snapshot.error?.message ?? '读取分支失败');
        const panel = document.createElement('div'); panel.style.textAlign = 'left';
        const heading = document.createElement('h3'); heading.textContent = snapshot.title;
        const label = document.createElement('label'); label.textContent = '当前故事的分支';
        const select = document.createElement('select'); select.id = 'ste_branch_select'; select.setAttribute('aria-label', '选择故事分支');
        for (const line of snapshot.lines) select.append(new Option(line.name, line.key));
        select.value = snapshot.current.key; label.append(select);
        const hint = document.createElement('p'); hint.textContent = '切换前会保存当前聊天，后续回复只写入所选分支。';
        const actions = document.createElement('div'); actions.className = 'flex-container';
        const switchButton = document.createElement('button'); switchButton.className = 'menu_button'; switchButton.textContent = '切换分支'; switchButton.disabled = true;
        const createButton = document.createElement('button'); createButton.className = 'menu_button'; createButton.textContent = '从最后一楼新建分支'; createButton.disabled = !st.chat.length;
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        actions.append(switchButton, createButton); panel.append(heading, label, hint, actions, error);
        const popup = new Popup(panel, POPUP_TYPE.TEXT, '', { okButton: '关闭' });
        let busy = false;
        select.addEventListener('change', () => { switchButton.disabled = select.value === snapshot.current.key; });
        const run = async action => {
            if (busy) return;
            busy = true; select.disabled = switchButton.disabled = createButton.disabled = true; error.textContent = '';
            try {
                const current = await host.request('/ste/branches');
                if (!current.ok || (await current.json()).current.key !== snapshot.current.key) throw new Error('当前聊天已切换，请重新打开分支列表');
                await action(); await popup.complete(1);
            } catch (reason) { error.textContent = String(reason?.message ?? reason); }
            finally { busy = false; select.disabled = false; switchButton.disabled = select.value === snapshot.current.key; createButton.disabled = !st.chat.length; }
        };
        switchButton.addEventListener('click', () => { void run(() => st.openCharacterChat(select.value)); });
        createButton.addEventListener('click', () => { void run(async () => {
            await window.__STE_BEFORE_CHAT_SWITCH__();
            const result = await (await import('./scripts/bookmarks.js')).branchChat(st.chat.length - 1);
            if (!result) throw new Error('未能创建分支，当前聊天已保留');
        }); });
        await popup.show(); return;
    }
    const runtime = section === 'runtime';
    const scripts = section === 'scripts';
    const drawer = $(runtime || scripts ? '#extensions-settings-button' : '#sys-settings-button');
    const content = drawer.children('.drawer-content');
    if (content.hasClass('closedDrawer')) await (stModule ?? await import('./script.js')).doNavbarIconClick.call(drawer.children('.drawer-toggle')[0]);
    if (runtime || scripts) {
        const panel = $(scripts ? '#ste_helper_settings' : '#ste_runtime_settings');
        if (!panel.find('.inline-drawer-content').is(':visible')) panel.find('.inline-drawer-toggle').trigger('click');
        await panel.find('.inline-drawer-content').promise();
    }
    const control = document.querySelector(scripts ? '#ste_helper_status_summary' : runtime ? '#ste_play_mode' : '#ste_main_profile');
    if (!control) throw new Error('聊天界面尚未准备好，请稍后再试');
    control.scrollIntoView({ block: 'center' });
    if (scripts) control.setAttribute('tabindex', '-1');
    control.focus({ preventScroll: true });
};
window.__STE_TAVERN_DIRTY__ = () => host.isGenerating() || stModule?.hasUnsavedChat() || !!document.querySelector('#chat .edit_textarea')
    || !!document.querySelector('#send_textarea')?.value;
async function installConnectionControls() {
    const { oai_settings } = await import('./scripts/openai.js');
    const panel = document.createElement('div');
    panel.className = 'flex-container flexFlowColumn';
    panel.innerHTML = '<label>STE 主模型<select id="ste_main_profile"></select></label><label>工具模型<select id="ste_tool_profile"></select></label><button type="button" class="menu_button" id="ste_manage_profiles">管理连接</button><small>连接与 STE 设置页共用。预设仍在原预设面板选择。</small><hr>';
    document.querySelector('#openai_api')?.prepend(panel);
    const request = async data => {
        const response = await host.request('/ste/configuration', data);
        const config = await response.json();
        if (!response.ok) throw new Error(config.error?.message ?? '连接设置保存失败');
        return config;
    };
    const render = config => {
        for (const [id, field] of [['ste_main_profile', 'mainProfileId'], ['ste_tool_profile', 'toolProfileId']]) {
            const select = panel.querySelector('#' + id);
            select.replaceChildren(...config.profiles.map(profile => new Option(`${profile.name} · ${profile.model}`, profile.id)));
            if (config[field]) select.value = config[field];
        }
        const chosen = config.profiles.find(p => p.id === config.mainProfileId);
        oai_settings.chat_completion_source = 'custom';
        oai_settings.custom_model = chosen.model;
        oai_settings.custom_url = chosen.apiUrl;
        $('#main_api').val('openai').prop('disabled', true).attr('title', '当前使用 STE 的 Chat Completion 连接');
        $('#chat_completion_source').val('custom').prop('disabled', true);
        $('#custom_model_id').val(chosen.model).prop('disabled', true);
        $('#custom_api_url').val(chosen.apiUrl).prop('disabled', true);
        $('#api_key_custom').prop('disabled', true);
    };
    render(await request());
    panel.querySelector('#ste_main_profile').addEventListener('change', async event => {
        try { render(await request({ mainProfileId: event.target.value })); }
        catch (error) { toastr.error(error.message); render(await request()); }
    });
    panel.querySelector('#ste_tool_profile').addEventListener('change', async event => {
        try { render(await request({ toolProfileId: event.target.value })); }
        catch (error) { toastr.error(error.message); render(await request()); }
    });
    panel.querySelector('#ste_manage_profiles').addEventListener('click', () => { void host.request('/ste/manage-profiles'); });
}
async function installRuntimeControls(st) {
    const drafts = installDraftRecovery(st, host);
    const refreshRegex = installRegexAssets(host);
    st.eventSource.makeFirst(st.event_types.CHAT_CHANGED, refreshRegex);
    await refreshRegex();
    const panel = document.createElement('div');
    panel.className = 'extension_container';
    panel.id = 'ste_runtime_settings';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>STE 游玩与记忆</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content"><label>游玩模式<select id="ste_play_mode"><option value="classic">无 Agent · 原酒馆流程</option><option value="agent">Agent · 自动查阅资料与记忆</option></select></label>
        <label id="ste_memory_owner_label">记忆维护<select id="ste_memory_owner"><option value="none">不自动维护</option><option value="baibai">柏宝书</option><option value="native-agent">STE 文件记忆</option></select></label>
        <p id="ste_agent_status" role="status"></p><small id="ste_cache_status"></small>
        <div class="flex-container"><button class="menu_button" id="ste_memory_open">查看 / 修改记忆</button><button class="menu_button" id="ste_references_open">本轮引用</button><button class="menu_button" id="ste_world_versions">世界书版本</button><button class="menu_button" id="ste_memory_retry">补全记忆</button><button class="menu_button" id="ste_context_reset">新上下文周期</button></div>
        <small>原角色卡、世界书与预设仍在原抽屉管理。工具模型在 API 抽屉选择。</small></div></div>`;
    document.querySelector('#extensions_settings')?.prepend(panel);
    async function request(path, data) {
        const response = await host.request(path, data);
        const value = await response.json();
        if (!response.ok) throw new Error(value.error?.message ?? '操作失败');
        return value;
    }
    const mode = panel.querySelector('#ste_play_mode'), owner = panel.querySelector('#ste_memory_owner');
    function renderStatus(status) {
        panel.querySelector('#ste_agent_status').textContent = status.message;
        const cached = status.usage?.prompt_tokens_details?.cached_tokens;
        panel.querySelector('#ste_cache_status').textContent = status.cache
            ? `${status.cache.reason} · 本地相同前缀约 ${status.cache.estimatedPrefixTokens} token · 服务端缓存 ${typeof cached === 'number' ? cached + ' token' : '未报告'}` : '';
    }
    async function refresh() {
        const config = await request('/ste/runtime');
        mode.value = config.mode; owner.value = config.memoryOwner;
        owner.disabled = config.mode === 'agent';
        owner.querySelector('option[value="native-agent"]').disabled = config.mode !== 'agent';
        window.__STE_AGENT_MODE__ = config.mode === 'agent';
        window.__STE_CONTEXT_RESERVE__ = config.contextReserveTokens;
        window.__STE_MEMORY_OWNER__ = config.memoryOwner;
        window.__STE_BAIBAI_REFRESH__?.();
        if (config.memoryOwner !== 'baibai') await restoreBaiBaiHidden(st);
        await drafts.select(config.chatKey);
        renderStatus(config.status);
        return config;
    }
    async function change() {
        try {
            if (window.__STE_BAIBAI_BUSY__?.()) throw new Error('柏宝书正在整理记忆，请完成后再切换维护者');
            await request('/ste/runtime', { mode: mode.value, memoryOwner: mode.value === 'agent' ? 'native-agent' : owner.value === 'native-agent' ? 'none' : owner.value });
            await refresh();
        } catch (error) { toastr.error(error.message); await refresh(); }
    }
    mode.addEventListener('change', change); owner.addEventListener('change', change);
    const { Popup, POPUP_TYPE } = await import('./scripts/popup.js');
    const pluginControls = document.createElement('div'); pluginControls.className = 'flex-container flexFlowColumn';
    pluginControls.innerHTML = '<hr><b>柏宝书原版插件</b><small id="ste_baibai_installed"></small><small>摘要使用 STE 工具模型；当前支持非向量记忆。安装后重新打开聊天生效。</small><button type="button" class="menu_button" id="ste_baibai_choose">选择插件 ZIP</button><input type="file" id="ste_baibai_zip" accept=".zip"><button class="menu_button" id="ste_baibai_remove">移除插件</button>';
    pluginControls.querySelector('#ste_baibai_choose').addEventListener('click', () => pluginControls.querySelector('#ste_baibai_zip').click());
    panel.querySelector('.inline-drawer-content').append(pluginControls);
    const installed = await request('/ste/extensions');
    const pluginStatus = pluginControls.querySelector('#ste_baibai_installed');
    pluginStatus.textContent = installed.baibai ? `已安装 ${installed.baibai.version}` : '尚未安装。使用安装说明中固定版本的 GitHub 源码 ZIP。';
    pluginControls.querySelector('#ste_baibai_remove').disabled = !installed.baibai;
    pluginControls.querySelector('#ste_baibai_remove').addEventListener('click', async () => {
        try {
            await window.__STE_TAVERN_FLUSH__();
            if (owner.value === 'baibai') await request('/ste/runtime', { memoryOwner: 'none' });
            await refresh();
            await request('/ste/extensions/remove'); location.reload();
        } catch (error) { toastr.error(error.message); }
    });
    const docsLink = document.createElement('a'); docsLink.textContent = '下载已验证的 1.2.7 原版 ZIP';
    docsLink.href = `https://github.com/baibai-git/ST-BaiBai-Book/archive/${installed.supported.commit}.zip`; docsLink.target = '_blank'; docsLink.rel = 'noopener'; pluginControls.append(docsLink);
    pluginControls.querySelector('#ste_baibai_zip').addEventListener('change', async event => {
        try {
            const file = event.target.files?.[0]; if (!file) return;
            if (file.size > 25 * 1024 * 1024) throw new Error('插件 ZIP 需小于 25 MB');
            await window.__STE_TAVERN_FLUSH__();
            const result = await request('/ste/extensions/install', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
            pluginStatus.textContent = `已安装 ${result.version}，正在重新打开聊天…`;
            location.reload();
        } catch (error) { toastr.error(error.message); }
    });
    panel.querySelector('#ste_memory_open').addEventListener('click', async () => {
        try {
            const snapshot = await request('/ste/memory');
            const container = document.createElement('div');
            container.style.textAlign = 'left';
            const select = document.createElement('select'); select.id = 'ste_memory_file';
            select.append(new Option('新建笔记', ''));
            const states = { active: '可用', invalidated: '来源已变化', conflict: '文件冲突' };
            for (const doc of snapshot.documents) select.append(new Option(`${doc.path} · ${states[doc.status] ?? doc.status} · ${doc.owner === 'manual' ? '手动' : '自动'}`, doc.path));
            const path = document.createElement('input'); path.id = 'ste_memory_path'; path.className = 'text_pole'; path.placeholder = '如 style.md 或 characters/林.md'; path.value = 'style.md';
            const body = document.createElement('textarea'); body.id = 'ste_memory_body'; body.className = 'text_pole'; body.rows = 16;
            const sources = document.createElement('pre'); sources.style.whiteSpace = 'pre-wrap';
            let expectedDigest = null;
            select.addEventListener('change', () => {
                const doc = snapshot.documents.find(item => item.path === select.value);
                path.value = doc?.path ?? ''; body.value = doc?.body ?? ''; expectedDigest = doc?.digest ?? null;
                sources.textContent = doc?.sourceRefs.map(ref => `来源消息：${ref.messageId} / ${ref.candidateId}`).join('\n') ?? '';
            });
            const note = document.createElement('p'); note.textContent = '手动保存后，这份笔记由你维护，Agent 会保留你的修改。';
            container.append(note, select, path, body, sources);
            const ok = await new Popup(container, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '保存笔记' }).show();
            if (ok) { await request('/ste/memory/save', { path: path.value, body: body.value, expectedDigest }); toastr.success('笔记已保存'); }
        } catch (error) { toastr.error(error.message); }
    });
    panel.querySelector('#ste_references_open').addEventListener('click', async () => {
        try {
            const status = await request('/ste/runtime/status');
            const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.style.textAlign = 'left';
            pre.textContent = status.references?.map(ref => `${ref.label} (${ref.resourceId})\n${ref.text}`).join('\n\n') || '本轮尚无引用资料。';
            await new Popup(pre, POPUP_TYPE.TEXT, '', { wide: true }).show();
        } catch (error) { toastr.error(error.message); }
    });
    panel.querySelector('#ste_memory_retry').addEventListener('click', () => { void request('/ste/runtime/retry-memory').catch(error => toastr.error(error.message)); });
    panel.querySelector('#ste_world_versions').addEventListener('click', async () => {
        try {
            const container = document.createElement('div'); container.style.textAlign = 'left';
            const note = document.createElement('p'); note.textContent = '接受后只在当前故事分支生效。原条目保留；修改来源剧情会使对应版本失效。'; container.append(note);
            const list = document.createElement('div'); container.append(list);
            async function draw() {
                const versions = await request('/ste/worldbook-versions'); list.replaceChildren();
                if (!versions.length) { list.textContent = '尚无世界书版本草稿。'; return; }
                const labels = { draft: '待接受', active: '当前生效', superseded: '历史版本', invalidated: '来源或原件已变化', rejected: '已拒绝' };
                for (const version of versions) {
                    const row = document.createElement('details'); row.open = version.status === 'draft';
                    const title = document.createElement('summary'); title.textContent = `${version.worldName} / ${version.entryName} v${version.version} · ${labels[version.status]}`;
                    const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap';
                    text.textContent = `原条目：\n${version.originalContent}\n\nv${version.version}：\n${version.content}\n\n原因：${version.reason}\n来源：${version.sourceRefs.map(ref => ref.messageId).join('、')}`;
                    row.append(title, text);
                    for (const [action, label] of [['accept', '接受此版本'], ['reject', '拒绝 / 撤回此版本']]) {
                        if (action === 'accept' && version.status !== 'draft' || action === 'reject' && !['draft', 'active'].includes(version.status)) continue;
                        const button = document.createElement('button'); button.className = 'menu_button'; button.textContent = label;
                        button.addEventListener('click', async () => { try { await request('/ste/worldbook-versions/' + action, { id: version.id }); await draw(); } catch (error) { toastr.error(error.message); } }); row.append(button);
                    }
                    list.append(row);
                }
            }
            await draw(); await new Popup(container, POPUP_TYPE.TEXT, '', { wide: true }).show();
        } catch (error) { toastr.error(error.message); }
    });
    panel.querySelector('#ste_context_reset').addEventListener('click', async () => {
        try { await request('/ste/runtime/reset-context'); await refresh(); toastr.info('下一轮将重新建立上下文周期，故事正文保留。'); }
        catch (error) { toastr.error(error.message); }
    });
    st.eventSource.makeFirst(st.event_types.GENERATION_AFTER_COMMANDS, async (type, _options, dryRun) => {
        if (dryRun) return;
        if (!window.__STE_DRAFT_READY__()) throw new Error('请先恢复或丢弃聊天底部的草稿，再继续发送');
        generationType = type; responseTurn = null; worldHandled = false; worldEntries = []; worldPreparationError = undefined;
        await refresh();
    });
    st.eventSource.makeFirst(st.event_types.MESSAGE_RECEIVED, async (messageId, type) => {
        if (!responseTurn || type === 'first_message') return;
        const turnId = responseTurn; responseTurn = null;
        const message = st.chat[messageId];
        if (!message || message.is_user) return;
        window.__STE_STAMP_CHAT__(st.chat);
        try { await request('/ste/runtime/confirm-candidate', { turnId, messageId: message.extra.ste_runtime.messageId,
            candidateId: `candidate:${turnId}`, content: message.mes }); }
        catch { return; } // Stopped/failed partial prose still saves, without a factual completion identity.
        message.extra.ste_runtime = { ...message.extra.ste_runtime, turnId, candidateId: `candidate:${turnId}` };
        if (message.swipe_info?.[message.swipe_id ?? 0]) {
            const info = message.swipe_info[message.swipe_id ?? 0]; info.extra ??= {};
            info.extra.ste_runtime = { ...message.extra.ste_runtime };
        }
    });
    st.eventSource.on(st.event_types.CHAT_CHANGED, () => refresh().catch(error => toastr.error(error.message)));
    await refresh();
    const timer = setInterval(() => { void request('/ste/runtime/status').then(renderStatus).catch(() => {}); }, 1500);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
}
function installManagementControls() {
    const routes = [
        ['#rm_button_create, #character_import_button, #external_import_button', 'library', '在 STE 资料库创建或导入角色'],
        ['#delete_button, #character_context_menu_delete, #bulkDeleteButton', 'library', '在 STE 资料库管理角色'],
        ['#export_button', 'character', '在 STE 角色详情导出角色卡'],
        ['#chat_import_button, .PastChat_cross', 'story', '在 STE 故事页导入或管理聊天'],
        ['#world_import_button', 'worldbook', '在 STE 世界书管理页导入'],
    ];
    const unavailable = [
        ['#rm_button_group_chats', '当前支持单角色聊天和故事分支，群聊尚未接入。'],
        ['#add_background_button_top, #add_bg_button, #avatar_upload_file', '当前可选择内置背景与用户头像；自定义图片上传尚未接入。'],
    ];
    for (const [selector, , title] of routes) for (const element of document.querySelectorAll(selector)) element.title = title;
    for (const [selector, title] of unavailable) for (const element of document.querySelectorAll(selector)) {
        element.title = title; element.setAttribute('aria-disabled', 'true');
    }
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const route = routes.find(([selector]) => event.target.closest(selector));
        const blocked = unavailable.find(([selector]) => event.target.closest(selector));
        if (!route && !blocked) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (blocked) { toastr.info(blocked[1]); return; }
        void host.request('/ste/manage', { target: route[1] }).then(async response => {
            if (!response.ok) throw new Error((await response.json()).error?.message ?? '无法打开管理页');
        }).catch(error => toastr.error(error.message));
    }, true);
}

window.__STE_TAVERN_READY__ = () => { void import('./script.js').then(async st => {
    stModule = st; await installConnectionControls(); await installRuntimeControls(st);
    await installHelperControls(await installHelperHost(host, st)); await installPackageControls(host); installManagementControls(); host.ready();
}).catch(error => { toastr.error(error.message); console.error(error); }); };
// Blob module linking serves the user-installed browser build in WebViews as well as the browser.
// Imported ST modules still resolve to the original, single module instance in this iframe.
const extensionUrls = new Map();
window.__STE_EXTENSION_RESOURCE__ = (name, resource) => name === 'third-party/ST-BaiBai-Book'
    ? extensionUrls.get(String(resource).split(/[?#]/)[0]) : undefined;
window.__STE_BAIBAI_ASSET_URL__ = relative => {
    const root = new URL('/scripts/extensions/third-party/ST-BaiBai-Book/', location.href);
    const resolved = new URL(relative, new URL('dist/index.js', root));
    if (!resolved.href.startsWith(root.href)) throw new Error('柏宝书资源不在安装包内');
    const url = extensionUrls.get(decodeURIComponent(resolved.pathname.slice(root.pathname.length)));
    if (!url) throw new Error('柏宝书安装包缺少资源：' + relative);
    return url;
};
window.__STE_BAIBAI_IMPORT__ = specifier => {
    const path = String(specifier);
    if (path !== '/script.js' && !path.startsWith('/scripts/')) throw new Error('尚未支持的柏宝书模块：' + path);
    return import(new URL(path, location.href).href);
};
const packageResponse = await host.request('/ste/extensions/package');
if (!packageResponse.ok) throw new Error((await packageResponse.json()).error?.message ?? '插件安装包无法读取');
const installedPackage = await packageResponse.json();
if (installedPackage) {
    const config = await (await host.request('/ste/runtime')).json();
    window.__STE_MEMORY_OWNER__ = config.memoryOwner;
    for (const [path, text] of Object.entries(installedPackage.files)) {
        const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'text/markdown';
        extensionUrls.set(path, URL.createObjectURL(new Blob([path === 'dist/index.js' ? installedPackage.module : text], { type })));
    }
    window.addEventListener('pagehide', () => { for (const url of extensionUrls.values()) URL.revokeObjectURL(url); }, { once: true });
}
window.__TAURITAVERN_MAIN_READY__ = Promise.resolve();
