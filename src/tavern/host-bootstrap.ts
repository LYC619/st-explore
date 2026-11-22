// Served as /tauri-main.js inside the original ST document. All persistence stays in the parent STE app.
import { loadUpstream, errorMessage, type AjaxOptions, type UpstreamState, type WorldEntry } from './upstream.js';
import { installDraftRecovery } from './draft-recovery.js';
import { installProcessEvents, type ProcessEventsHandle } from './process-events.js';
import { installStatusPolling } from './status-polling.js';
import { captureRecoveryFile } from './recovery-export.js';
import { installRegexAssets } from './regex-assets.js';
import { installHelperHost } from './helper-host.js';
import { installHelperControls } from './helper-controls.js';
import { installPackageControls } from './package-controls.js';
import { installExtensionControls } from './extension-controls.js';
import type { STRawMessage } from '../types/chat';

interface ConfigurationProfile {
    id: string;
    name: string;
    model: string;
    apiUrl?: string;
    configured?: boolean;
}
interface ConfigurationPayload {
    profiles: ConfigurationProfile[];
    mainProfileId?: string;
    toolProfileId?: string;
    syncMessage?: string;
}
interface RuntimeStatusPayload {
    message: string;
    usage?: { prompt_tokens_details?: { cached_tokens?: number } };
    cache?: { reason: string; estimatedPrefixTokens: number };
    references?: { label: string; resourceId: string; text: string }[];
}
interface RuntimeConfigPayload {
    mode: string;
    memoryOwner: string;
    contextReserveTokens: number;
    chatKey: string;
    status: RuntimeStatusPayload;
}
interface ExtensionsPayload {
    baibai?: { version: string } | null;
    supported: { commit: string };
}
interface MemoryDocument {
    path: string;
    status: 'active' | 'invalidated' | 'conflict' | string;
    owner: string;
    body: string;
    digest: string;
    sourceRefs: { messageId: string; candidateId: string }[];
}
interface WorldbookVersionItem {
    id: string;
    worldName: string;
    entryName: string;
    version: number;
    status: 'draft' | 'active' | 'superseded' | 'invalidated' | 'rejected';
    originalContent: string;
    content: string;
    reason: string;
    sourceRefs: { messageId: string }[];
}
interface BranchesSnapshot {
    title: string;
    current: { key: string };
    lines: { name: string; key: string }[];
}
interface LibraryRefreshPayload {
    presetRevisions: Record<string, string>;
    worldRenames: Record<string, string>;
    presetRenames: Record<string, string>;
    externalPresetSwitch?: string;
    tags: { id: string }[];
    openai_settings: string[];
    openai_setting_names: string[];
}
interface InstalledExtensionPackage {
    files: Record<string, string>;
    module?: string;
}
interface EffectiveWorldVersion {
    world: string;
    uid: string | number;
    content: string;
}

const { lodash } = await loadUpstream('/lib.js');
const { installChatSurfaceApi } = await loadUpstream('/tauri/main/api/chat-surface.js');

const channel = new URLSearchParams(location.search).get('host');
const hostRegistry = window.parent?.__STE_TAVERN_HOSTS__
    ?? (window.parent?.opener as Window | undefined)?.__STE_TAVERN_HOSTS__
    ?? (window.opener as Window | undefined)?.__STE_TAVERN_HOSTS__;
const resolvedHost = channel ? hostRegistry?.get(channel) : undefined;
if (!resolvedHost) throw new Error('请从 STE 的聊天或故事页面打开酒馆');
const host = resolvedHost;
window._ = lodash;
// ST normally lives at /. At /tavern.html, jQuery UI otherwise treats #tab
// links resolved against <base href="/"> as remote and inserts a second document.
const documentBase = document.querySelector<HTMLBaseElement>('base');
if (documentBase) documentBase.href = location.href;

window.__STE_STAMP_CHAT__ = (messages: STRawMessage[]) => {
    const seen = new Set<string>();
    for (const message of messages) {
        message.extra ??= {};
        const identity = (message.extra.ste_runtime ?? {}) as { messageId?: string; candidateId?: string; role?: string; turnId?: string };
        const messageId = identity.messageId ?? crypto.randomUUID();
        if (seen.has(messageId)) throw new Error('消息 ID 重复，保存已停止，正文未覆盖');
        seen.add(messageId);
        const role = message.is_user ? 'user' : identity.role === 'system' || ['system', 'narrator', 'comment'].includes(message.extra.type) ? 'system' : 'assistant';
        message.extra.ste_runtime = { ...identity, messageId, role };
        if (Array.isArray(message.swipes)) {
            message.swipe_info ??= [];
            const swipeInfo = message.swipe_info;
            message.swipes.forEach((_, index) => {
                const info = (swipeInfo[index] ??= {}) as { extra?: Record<string, unknown> };
                info.extra ??= {};
                const priorRuntime = info.extra.ste_runtime as { candidateId?: string } | undefined;
                info.extra.ste_runtime = {
                    ...priorRuntime,
                    messageId,
                    role,
                    candidateId: priorRuntime?.candidateId
                        ?? (index === 0 && identity.candidateId === `${messageId}:main` ? identity.candidateId : crypto.randomUUID()),
                };
            });
            const currentInfo = swipeInfo[message.swipe_id ?? 0] as { extra?: { ste_runtime?: { candidateId?: string } } } | undefined;
            message.extra.ste_runtime.candidateId = currentInfo?.extra?.ste_runtime?.candidateId;
        } else message.extra.ste_runtime.candidateId ??= `${messageId}:main`;
    }
};
window.__STE_NEW_MESSAGE_ID__ = (message: STRawMessage) => {
    delete message.extra?.ste_runtime;
    for (const info of message.swipe_info ?? []) delete (info as { extra?: Record<string, unknown> }).extra?.ste_runtime;
    window.__STE_STAMP_CHAT__([message]);
};
window.__STE_OPEN_CARD_EDITOR__ = card => {
    const form = document.querySelector<HTMLElement>('#form_create');
    if (!form) return;
    let revision = form.querySelector<HTMLInputElement>('input[name="_ste_revision"]');
    if (!revision) { revision = document.createElement('input'); revision.type = 'hidden'; revision.name = '_ste_revision'; form.append(revision); }
    revision.value = card._ste_revision ?? ''; revision.dataset.avatar = card.avatar;
};

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
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
    const data = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(data.error?.message ?? `STE 不支持此命令：${command}`);
    return data;
}

window.__TAURI__ = {
    core: { invoke, convertFileSrc: path => path },
    event: { listen: async (name, listener) => {
        const handler = (event: Event) => listener({ event: name, payload: (event as CustomEvent).detail });
        window.addEventListener(name, handler);
        return () => window.removeEventListener(name, handler);
    } },
};
window.__TAURITAVERN__ = { invoke: { safeInvoke: invoke, flushAll: () => host.flush() }, api: {}, iosPolicy: null };
installChatSurfaceApi();
window.__TAURITAVERN_THUMBNAIL__ = (type, file) => host.thumbnail(type, file);
window.__STE_USER_AVATAR__ = name => host.userAvatar(name);

function apiPath(input: RequestInfo | URL): string | null {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    return url.origin === location.origin && (url.pathname.startsWith('/api/') || ['/csrf-token', '/version'].includes(url.pathname))
        ? url.pathname + url.search : null;
}
function parseBody(body: unknown): unknown {
    if (body instanceof FormData) return Object.fromEntries([...new Set(body.keys())].map(key => {
        const values = body.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
    }));
    if (typeof body === 'string') return body ? JSON.parse(body) : undefined;
    return body;
}
const originalFetch = window.fetch.bind(window);
let generationType = 'normal';
let processEvents: ProcessEventsHandle | undefined;
let responseTurn: string | null | undefined;
let worldEntries: { world: string; uid: string | number }[] = [];
let worldHandled = false;
let worldPreparationError: unknown;
window.__STE_AGENT_MODE__ = false;
window.__STE_EFFECTIVE_WORLDS__ = async (entries: WorldEntry[]) => {
    try {
        const [response, storyResponse] = await Promise.all([host.request('/ste/worldbook-versions/effective'), host.request('/ste/story-worlds')]);
        const versions = await response.json() as EffectiveWorldVersion[] & { error?: { message?: string } };
        if (!response.ok) throw new Error(versions.error?.message ?? '世界书版本读取失败');
        const storyEntries = await storyResponse.json() as WorldEntry[] & { error?: { message?: string } };
        if (!storyResponse.ok) throw new Error(storyEntries.error?.message ?? '故事世界书读取失败');
        const seen = new Set(entries.map(entry => JSON.stringify([entry.world, String(entry.uid)])));
        entries = [...entries, ...storyEntries.filter(entry => { const key = JSON.stringify([entry.world, String(entry.uid)]); if (seen.has(key)) return false; seen.add(key); return true; })];
        return entries.map(entry => {
            const version = versions.find(item => item.world === entry.world && String(item.uid) === String(entry.uid));
            return version ? { ...entry, content: version.content } : entry;
        });
    } catch (error) { worldPreparationError = error; throw error; }
};
window.__STE_WORLD_PROMPT__ = async (entries: WorldEntry[]) => {
    const st = stModule ?? await loadUpstream('/script.js');
    const { getRegexedString, regex_placement } = await loadUpstream('/scripts/extensions/regex/engine.js');
    const expand = (text: string) => st.substituteParams(getRegexedString(text, regex_placement.WORLD_INFO, { isPrompt: true }));
    host.setWorldTransformer(expand);
    worldEntries = entries.filter(entry => !entry.disable).map(entry => ({ world: entry.world, uid: entry.uid }));
    worldHandled = true;
    const blue = entries.filter(entry => !entry.disable && entry.constant).map(entry => expand(entry.content)).join('\n\n');
    return { worldInfoString: blue, worldInfoBefore: blue, worldInfoAfter: '', worldInfoExamples: [], worldInfoDepth: [],
        anBefore: [], anAfter: [], outletEntries: {}, worldInfoActivation: { trigger: generationType, activated: { entries: [] } } };
};
window.fetch = async (input: RequestInfo | URL, options: RequestInit = {}) => {
    const path = apiPath(input);
    if (!path) return originalFetch(input, options);
    const rawBody = options.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const body = parseBody(rawBody) as Record<string, unknown> | undefined;
    if (path === '/api/chats/save' && stModule && body) body.ste_persona_name = stModule.name1;
    if (path === '/api/backends/chat-completions/generate' && stModule && body) {
        const type = typeof body.type === 'string' ? body.type : 'quiet';
        if (worldPreparationError && !['quiet', 'impersonate'].includes(type)) throw worldPreparationError;
        const { oai_settings } = await loadUpstream('/scripts/openai.js');
        window.__STE_STAMP_CHAT__(stModule.chat);
        const card = stModule.characters?.[stModule.this_chid];
        body.ste_context = { type, processId: type === 'quiet' ? undefined : processEvents?.current(),
            preset: oai_settings.preset_settings_openai, character: card?.name, world: card?.data?.extensions?.world,
            userName: stModule.name1, ...(window.__STE_HELPER_GENERATING__ ? { source: 'helper' } : {}), worldHandled, worldEntries, maxContext: oai_settings.openai_max_context,
            chat: [{ chat_metadata: structuredClone(stModule.chat_metadata) }, ...structuredClone(stModule.chat)] };
    }
    const signal = options.signal ?? (input instanceof Request ? input.signal : undefined);
    const response = await host.request(path, body, signal);
    const steContext = body?.ste_context as { type?: string } | undefined;
    if (path === '/api/backends/chat-completions/generate') processEvents?.response(response.headers.get('x-ste-process-id'), steContext?.type);
    if (path === '/api/presets/save' && response.ok && typeof body?.name === 'string') menuPresetRevisions[body.name] = host.presetRevisions()[body.name];
    if (path === '/api/backends/chat-completions/status' && response.ok) {
        const status = await response.clone().json() as { ste_warning?: string };
        if (status.ste_warning) toastr.warning(status.ste_warning);
    }
    if (path.split('?')[0] === '/api/characters/edit' && response.ok) {
        const saved = await response.clone().json() as { _ste_revision?: string };
        const revision = document.querySelector<HTMLInputElement>('#form_create input[name="_ste_revision"]');
        if (revision && revision.dataset.avatar === body?.avatar_url && typeof saved._ste_revision === 'string') revision.value = saved._ste_revision;
    }
    if (path === '/api/backends/chat-completions/generate' && !['quiet', 'impersonate'].includes(String(steContext?.type ?? ''))) responseTurn = response.headers.get('x-ste-turn-id');
    if (path === '/api/chats/save') {
        window.__STE_SAVE_FAILED__ = !response.ok;
        if (response.ok) queueMicrotask(() => { void window.__STE_DRAFT_CAPTURE__?.().catch(() => {}); });
    }
    return response;
};

// Token counting is one of the remaining synchronous upstream jQuery contracts.
const originalAjax = $.ajax.bind($);
$.ajax = (urlOrOptions: string | AjaxOptions, maybeOptions?: AjaxOptions) => {
    const options: AjaxOptions = typeof urlOrOptions === 'string' ? { ...maybeOptions, url: urlOrOptions } : { ...urlOrOptions };
    const path = options.url && apiPath(options.url);
    if (!path) return originalAjax(urlOrOptions, maybeOptions);
    const deferred = $.Deferred();
    const controller = new AbortController();
    const xhr = deferred.promise({ abort: () => controller.abort(), status: 0 });
    const succeed = (data: unknown) => {
        xhr.status = 200; xhr.responseJSON = data;
        options.success?.(data, 'success', xhr);
        deferred.resolve(data, 'success', xhr);
        options.complete?.(xhr, 'success');
    };
    const fail = (error: unknown) => {
        xhr.status = (error as { status?: number } | null)?.status ?? 500;
        options.error?.(xhr, 'error', error);
        deferred.reject(xhr, 'error', error);
        options.complete?.(xhr, 'error');
    };
    if (options.async === false) {
        try { succeed(host.tokenize(path, parseBody(options.data))); } catch (error) { fail(error); }
    } else {
        host.request(path, parseBody(options.data), controller.signal).then(async response => {
            if (!response.ok) throw Object.assign(new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? 'STE 请求失败'), { status: response.status });
            return options.dataType === 'text' ? response.text() : response.json();
        }).then(succeed, fail);
    }
    return xhr;
};

window.__STE_BAIBAI_HIDE__ = (message: STRawMessage) => {
    message.extra ??= {};
    if (!message.extra.bbs_hidden) message.extra.ste_baibai_hidden_before = message.is_system === true;
    message.extra.bbs_hidden = true;
};
async function flushBaiBai(): Promise<void> {
    const started = Date.now();
    while (window.__STE_BAIBAI_BUSY__?.()) {
        if (Date.now() - started > 30_000) throw new Error('柏宝书仍在整理记忆，已保留当前聊天，请完成后再离开');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await window.__STE_BAIBAI_FLUSH__?.();
}
async function restoreBaiBaiHidden(st: UpstreamState): Promise<void> {
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
    // Until script.js finishes evaluating, ST has registered no chat or settings,
    // and importing it would wait on the same stalled load event as startup.
    if (!window.__STE_ST_EVALUATED__) {
        await host.flush();
        return;
    }
    const st = await loadUpstream('/script.js');
    // A failed/slow startup can still be closed. Do not serialize defaults before
    // settings and the selected chat exist; preserve the ordinary save path if
    // the user has typed, edited, generated, or a chat has already been loaded.
    if (!stModule && st.getCurrentChatId() === undefined && !st.hasUnsavedChat() && !window.__STE_TAVERN_DIRTY__?.()) {
        await host.flush();
        return;
    }
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
let stModule: UpstreamState | undefined;
let menuPresetRevisions: Record<string, string> = host.presetRevisions();
// Refresh menus after returning from STE, preserving the live prompt draft and chat.
window.__STE_TAVERN_REFRESH_LIBRARY__ = async () => {
    const response = await host.request('/ste/library/refresh');
    if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? '资料库列表无法读取');
    const data = await response.json() as LibraryRefreshPayload;
    const prevRevisions = menuPresetRevisions;
    menuPresetRevisions = data.presetRevisions;
    const worlds = await loadUpstream('/scripts/world-info.js');
    for (let i = 0; i < worlds.selected_world_info.length; i++) {
        worlds.selected_world_info[i] = data.worldRenames[worlds.selected_world_info[i]] ?? worlds.selected_world_info[i];
    }
    const st = stModule ?? await loadUpstream('/script.js');
    const currentWorld = st.chat_metadata[worlds.METADATA_KEY];
    if (typeof currentWorld === 'string' && data.worldRenames[currentWorld]) st.chat_metadata[worlds.METADATA_KEY] = data.worldRenames[currentWorld];
    await worlds.updateWorldInfoList();
    worlds.worldInfoCache.clear();
    const tags = await loadUpstream('/scripts/tags.js');
    tags.loadTagsSettings(data);
    const { FILTER_TYPES } = await loadUpstream('/scripts/filters.js');
    const groups = await loadUpstream('/scripts/group-chats.js');
    const visibleTags = new Set(data.tags.map(tag => tag.id));
    for (const helper of [st.entitiesFilter, groups.groupCandidatesFilter, groups.groupMembersFilter]) {
        const previous = helper.getFilterData(FILTER_TYPES.TAG);
        helper.setFilterData(FILTER_TYPES.TAG, {
            selected: previous.selected.filter(id => visibleTags.has(id)),
            excluded: previous.excluded.filter(id => visibleTags.has(id)),
        }, true);
    }
    const openai = await loadUpstream('/scripts/openai.js');
    const prevSelected = openai.oai_settings.preset_settings_openai;
    const prevRevision = prevRevisions[prevSelected];
    const selected = (!host.isGenerating() && data.externalPresetSwitch)
        ? data.externalPresetSwitch
        : (data.presetRenames[prevSelected] ?? prevSelected);
    openai.openai_settings.splice(0, openai.openai_settings.length, ...data.openai_settings.map(value => JSON.parse(value) as unknown));
    for (const key of Object.keys(openai.openai_setting_names)) delete openai.openai_setting_names[key];
    const picker = document.querySelector<HTMLSelectElement>('#settings_preset_openai')!;
    picker.replaceChildren();
    data.openai_setting_names.forEach((name, index) => {
        openai.openai_setting_names[name] = index;
        picker.add(new Option(name, String(index)));
    });
    openai.oai_settings.preset_settings_openai = selected in openai.openai_setting_names ? selected : '';
    picker.value = selected in openai.openai_setting_names ? String(openai.openai_setting_names[selected]) : '';
    const presetChangedExternally = prevSelected !== selected || prevRevision !== data.presetRevisions[selected];
    if (selected in openai.openai_setting_names && !host.isGenerating() && presetChangedExternally) {
        const refreshed = openai.openai_settings[openai.openai_setting_names[selected]];
        if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
            const refreshedRecord = refreshed as Record<string, unknown>;
            const preserved = {
                preset_settings_openai: selected,
                chat_completion_source: openai.oai_settings.chat_completion_source,
                custom_url: openai.oai_settings.custom_url,
                custom_model: openai.oai_settings.custom_model,
            };
            for (const optionalKey of [
                'assistant_prefill', 'top_k', 'min_p', 'top_a', 'repetition_penalty',
                'frequency_penalty', 'presence_penalty', 'temperature', 'top_p',
                'openai_max_context', 'openai_max_tokens', 'wi_format', 'scenario_format',
                'personality_format', 'impersonation_prompt', 'new_chat_prompt',
                'new_group_chat_prompt', 'new_example_chat_prompt', 'continue_nudge_prompt', 'group_nudge_prompt',
            ]) {
                if (!(optionalKey in refreshedRecord)) delete (openai.oai_settings as Record<string, unknown>)[optionalKey];
            }
            Object.assign(openai.oai_settings, refreshedRecord, preserved);
        }
    }
    tags.printTagFilters();
    await (stModule ?? await loadUpstream('/script.js')).printCharacters(true);
    if (await window.__STE_REFRESH_REGEX__?.() && !host.isGenerating() && !document.querySelector<HTMLTextAreaElement>('#chat .edit_textarea')) {
        await (stModule ?? await loadUpstream('/script.js')).printMessages();
    }
    await window.__STE_REFRESH_CONNECTIONS__?.();
};
window.__STE_TAVERN_SNAPSHOT__ = async () => captureRecoveryFile(stModule ?? await loadUpstream('/script.js'));
window.__STE_TAVERN_OPEN_SETTINGS__ = async section => {
    if (section === 'chat') {
        // Invoke the native menu handler without bubbling an off-frame click to
        // upstream's document handler, which closes menus without hover/focus.
        $('#options_button').triggerHandler('click');
        return;
    }
    if (section === 'branches') {
        const { Popup, POPUP_TYPE } = await loadUpstream('/scripts/popup.js');
        const st = stModule ?? await loadUpstream('/script.js');
        const response = await host.request('/ste/branches');
        const snapshot = await response.json() as BranchesSnapshot & { error?: { message?: string } };
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
        const run = async (action: () => Promise<unknown>) => {
            if (busy) return;
            busy = true; select.disabled = switchButton.disabled = createButton.disabled = true; error.textContent = '';
            try {
                const current = await host.request('/ste/branches');
                if (!current.ok || ((await current.json()) as BranchesSnapshot).current.key !== snapshot.current.key) throw new Error('当前聊天已切换，请重新打开分支列表');
                await action(); await popup.complete(1);
            } catch (reason) { error.textContent = errorMessage(reason); }
            finally { busy = false; select.disabled = false; switchButton.disabled = select.value === snapshot.current.key; createButton.disabled = !st.chat.length; }
        };
        switchButton.addEventListener('click', () => { void run(() => st.openCharacterChat(select.value)); });
        createButton.addEventListener('click', () => { void run(async () => {
            await window.__STE_BEFORE_CHAT_SWITCH__();
            const result = await (await loadUpstream('/scripts/bookmarks.js')).branchChat(st.chat.length - 1);
            if (!result) throw new Error('未能创建分支，当前聊天已保留');
        }); });
        await popup.show(); return;
    }
    const runtime = section === 'runtime';
    const scripts = section === 'scripts';
    const drawer = $(runtime || scripts ? '#extensions-settings-button' : '#sys-settings-button');
    const content = drawer.children('.drawer-content');
    if (content.hasClass('closedDrawer')) await (stModule ?? await loadUpstream('/script.js')).doNavbarIconClick.call(drawer.children('.drawer-toggle')[0]);
    if (runtime || scripts) {
        const panel = $(scripts ? (installedHelper ? '#tavern_helper' : '#ste_helper_settings') : '#ste_runtime_settings');
        if (!panel.find('.inline-drawer-content').is(':visible')) panel.find('.inline-drawer-toggle').trigger('click');
        await panel.find('.inline-drawer-content').promise();
    }
    const control = document.querySelector<HTMLElement>(scripts ? (installedHelper ? '#tavern_helper' : '#ste_helper_status_summary') : runtime ? '#ste_play_mode' : '#ste_main_profile');
    if (!control) throw new Error('聊天界面尚未准备好，请稍后再试');
    control.scrollIntoView({ block: 'center' });
    if (scripts) control.setAttribute('tabindex', '-1');
    control.focus({ preventScroll: true });
};
window.__STE_TAVERN_DIRTY__ = () => host.isGenerating() || !!stModule?.hasUnsavedChat() || !!document.querySelector<HTMLTextAreaElement>('#chat .edit_textarea')
    || !!document.querySelector<HTMLTextAreaElement>('#send_textarea')?.value;
async function installConnectionControls(): Promise<void> {
    const { oai_settings } = await loadUpstream('/scripts/openai.js');
    const panel = document.createElement('div');
    panel.className = 'flex-container flexFlowColumn';
    panel.innerHTML = '<label>STE 主模型<select id="ste_main_profile"></select></label><label>工具模型<select id="ste_tool_profile"></select></label><small id="ste_connection_status" role="status"></small><button type="button" class="menu_button" id="ste_restore_profiles">重新读取已保存连接</button><button type="button" class="menu_button" id="ste_refresh_models">刷新模型列表</button><button type="button" class="menu_button" id="ste_manage_profiles">管理连接</button><small>连接与 STE 设置页共用。预设仍在原预设面板选择；自定义模型可在管理连接中填写。</small><hr>';
    document.querySelector<HTMLElement>('#openai_api')?.prepend(panel);
    const notice = document.createElement('div');
    notice.id = 'ste_connection_notice';
    notice.style.cssText = 'padding:6px 10px;flex-shrink:0;min-width:0;max-width:100%;white-space:normal;font-size:13px;background:var(--SmartThemeBlurTintColor);border-radius:8px';
    notice.innerHTML = '<span role="status" style="display:block;white-space:normal;overflow-wrap:anywhere"></span> <button type="button" class="menu_button" style="min-width:44px;min-height:44px">选择连接</button>';
    notice.querySelector<HTMLButtonElement>('button')!.addEventListener('click', () => {
        if (!document.querySelector<HTMLElement>('#rm_api_block')?.classList.contains('openDrawer')) $('#sys-settings-button .drawer-toggle').trigger('click');
        panel.querySelector<HTMLSelectElement>('#ste_main_profile')!.focus();
    });
    document.querySelector<HTMLElement>('#send_form')?.before(notice);
    for (const control of panel.querySelectorAll<HTMLElement>('select,button')) control.style.minHeight = '44px';
    const request = async (data?: Record<string, unknown>): Promise<ConfigurationPayload> => {
        const response = await host.request('/ste/configuration', data);
        const config = await response.json() as ConfigurationPayload & { error?: { message?: string } };
        if (!response.ok) throw new Error(config.error?.message ?? '连接设置保存失败');
        return config;
    };
    const render = (config: ConfigurationPayload) => {
        const fields: ['ste_main_profile' | 'ste_tool_profile', 'mainProfileId' | 'toolProfileId'][] = [
            ['ste_main_profile', 'mainProfileId'],
            ['ste_tool_profile', 'toolProfileId'],
        ];
        for (const [id, field] of fields) {
            const select = panel.querySelector<HTMLSelectElement>('#' + id)!;
            select.replaceChildren(...config.profiles.map(profile => {
                const option = new Option(`${profile.name} · ${profile.model}${profile.configured === false ? '（未配置密钥）' : ''}`, profile.id);
                option.disabled = profile.configured === false;
                return option;
            }));
            const currentId = config[field];
            if (!config.profiles.some(profile => profile.id === currentId)) {
                const missing = new Option('所选连接不可用，请重新选择', currentId ?? '');
                missing.disabled = true; select.prepend(missing);
            }
            if (currentId) select.value = currentId;
        }
        const chosen = config.profiles.find(p => p.id === config.mainProfileId && p.configured !== false);
        const tool = config.profiles.find(p => p.id === config.toolProfileId && p.configured !== false);
        const warning = config.syncMessage || (!chosen ? '所选主模型连接缺失或未配置。已有聊天可正常浏览，发送前请选择完整连接。'
            : !tool ? '所选工具模型连接缺失或未配置，使用工具或记忆维护前请重新选择。' : '');
        notice.hidden = !warning;
        notice.querySelector<HTMLElement>('span')!.textContent = warning;
        panel.querySelector<HTMLElement>('#ste_connection_status')!.textContent = warning;
        panel.querySelector<HTMLButtonElement>('#ste_restore_profiles')!.hidden = !warning;
        panel.querySelector<HTMLButtonElement>('#ste_refresh_models')!.disabled = !chosen;
        oai_settings.chat_completion_source = 'custom';
        oai_settings.custom_model = chosen?.model ?? '';
        oai_settings.custom_url = chosen?.apiUrl ?? '';
        $('#main_api').val('openai').prop('disabled', true).attr('title', '当前使用 STE 的 Chat Completion 连接');
        $('#chat_completion_source').val('custom').prop('disabled', true);
        $('#custom_model_id').val(chosen?.model ?? '').prop('disabled', true);
        $('#custom_api_url').val(chosen?.apiUrl ?? '').prop('disabled', true);
        $('#api_key_custom').prop('disabled', true);
    };
    render(await request());
    window.__STE_REFRESH_CONNECTIONS__ = async () => { render(await request()); };
    panel.querySelector<HTMLButtonElement>('#ste_restore_profiles')!.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
        try {
            const config = await request({ restore: true }); render(config);
            if (config.profiles.some(p => p.id === config.mainProfileId && p.configured !== false)) $('#api_button_openai').trigger('click');
            else toastr.info('当前配置中仍未找到所选连接，请重新选择或打开“管理连接”。');
        } catch (error) { toastr.error(errorMessage(error)); }
        finally { button.disabled = false; }
    });
    panel.querySelector<HTMLButtonElement>('#ste_refresh_models')!.addEventListener('click', () => { $('#api_button_openai').trigger('click'); });
    panel.querySelector<HTMLSelectElement>('#ste_main_profile')!.addEventListener('change', async event => {
        try { render(await request({ mainProfileId: (event.target as HTMLSelectElement).value })); $('#api_button_openai').trigger('click'); }
        catch (error) { toastr.error(errorMessage(error)); render(await request()); }
    });
    panel.querySelector<HTMLSelectElement>('#ste_tool_profile')!.addEventListener('change', async event => {
        try { render(await request({ toolProfileId: (event.target as HTMLSelectElement).value })); }
        catch (error) { toastr.error(errorMessage(error)); render(await request()); }
    });
    panel.querySelector<HTMLElement>('#ste_manage_profiles')!.addEventListener('click', () => { void host.request('/ste/manage-profiles'); });
}
async function installRuntimeControls(st: UpstreamState): Promise<void> {
    const drafts = installDraftRecovery(st, host);
    const refreshRegex = installRegexAssets(host);
    window.__STE_REFRESH_REGEX__ = refreshRegex;
    st.eventSource.makeFirst(st.event_types.CHAT_CHANGED, refreshRegex);
    // APP_READY may follow the initial chat paint. Redraw only if loading the
    // linked/applied rules changed what that already visible chat should show.
    if (await refreshRegex() && st.chat.length) await st.printMessages();
    const panel = document.createElement('div');
    panel.className = 'extension_container';
    panel.id = 'ste_runtime_settings';
    panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>STE 游玩与记忆</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
        <div class="inline-drawer-content"><label>游玩模式<select id="ste_play_mode"><option value="classic">无 Agent · 原酒馆流程</option><option value="agent">Agent · 自动查阅资料与记忆</option></select></label>
        <label id="ste_memory_owner_label">记忆维护<select id="ste_memory_owner"><option value="none">不自动维护</option><option value="baibai">柏宝书</option><option value="native-agent">STE 文件记忆</option></select></label>
        <p id="ste_agent_status" role="status"></p><small id="ste_cache_status"></small>
        <div class="flex-container"><button class="menu_button" id="ste_memory_open">查看 / 修改记忆</button><button class="menu_button" id="ste_references_open">本轮引用</button><button class="menu_button" id="ste_world_versions">世界书版本</button><button class="menu_button" id="ste_memory_retry">补全记忆</button><button class="menu_button" id="ste_context_reset">新上下文周期</button></div>
        <small>原角色卡、世界书与预设仍在原抽屉管理。工具模型在 API 抽屉选择。</small></div></div>`;
    document.querySelector<HTMLElement>('#extensions_settings')?.prepend(panel);
    async function request<T>(path: string, data?: unknown): Promise<T> {
        const response = await host.request(path, data);
        const value = await response.json() as T & { error?: { message?: string } };
        if (!response.ok) throw new Error(value?.error?.message ?? '操作失败');
        return value;
    }
    const mode = panel.querySelector<HTMLSelectElement>('#ste_play_mode')!, owner = panel.querySelector<HTMLSelectElement>('#ste_memory_owner')!;
    function renderStatus(status: RuntimeStatusPayload): void {
        panel.querySelector<HTMLElement>('#ste_agent_status')!.textContent = status.message;
        const cached = status.usage?.prompt_tokens_details?.cached_tokens;
        panel.querySelector<HTMLElement>('#ste_cache_status')!.textContent = status.cache
            ? `${status.cache.reason} · 本地相同前缀约 ${status.cache.estimatedPrefixTokens} token · 服务端缓存 ${typeof cached === 'number' ? cached + ' token' : '未报告'}` : '';
    }
    async function refresh(): Promise<RuntimeConfigPayload> {
        const config = await request<RuntimeConfigPayload>('/ste/runtime');
        mode.value = config.mode; owner.value = config.memoryOwner;
        owner.disabled = config.mode === 'agent';
        owner.querySelector<HTMLOptionElement>('option[value="native-agent"]')!.disabled = config.mode !== 'agent';
        window.__STE_AGENT_MODE__ = config.mode === 'agent';
        window.__STE_CONTEXT_RESERVE__ = config.contextReserveTokens;
        window.__STE_MEMORY_OWNER__ = config.memoryOwner;
        window.__STE_BAIBAI_REFRESH__?.();
        if (config.memoryOwner !== 'baibai') await restoreBaiBaiHidden(st);
        await drafts.select(config.chatKey);
        renderStatus(config.status);
        return config;
    }
    async function change(): Promise<void> {
        try {
            if (window.__STE_BAIBAI_BUSY__?.()) throw new Error('柏宝书正在整理记忆，请完成后再切换维护者');
            await request('/ste/runtime', { mode: mode.value, memoryOwner: mode.value === 'agent' ? 'native-agent' : owner.value === 'native-agent' ? 'none' : owner.value });
            await refresh();
        } catch (error) { toastr.error(errorMessage(error)); await refresh(); }
    }
    mode.addEventListener('change', change); owner.addEventListener('change', change);
    const { Popup, POPUP_TYPE } = await loadUpstream('/scripts/popup.js');
    const pluginControls = document.createElement('div'); pluginControls.className = 'flex-container flexFlowColumn';
    pluginControls.innerHTML = '<hr><b>柏宝书原版插件</b><small id="ste_baibai_installed"></small><small>摘要使用 STE 工具模型；当前支持非向量记忆。安装后重新打开聊天生效。</small><button type="button" class="menu_button" id="ste_baibai_choose">选择插件 ZIP</button><input type="file" id="ste_baibai_zip" accept=".zip"><button class="menu_button" id="ste_baibai_remove">移除插件</button>';
    pluginControls.querySelector<HTMLElement>('#ste_baibai_choose')!.addEventListener('click', () => pluginControls.querySelector<HTMLInputElement>('#ste_baibai_zip')!.click());
    panel.querySelector<HTMLElement>('.inline-drawer-content')!.append(pluginControls);
    const installed = await request<ExtensionsPayload>('/ste/extensions');
    const pluginStatus = pluginControls.querySelector<HTMLElement>('#ste_baibai_installed')!;
    pluginStatus.textContent = installed.baibai ? `已安装 ${installed.baibai.version}` : '尚未安装。使用安装说明中固定版本的 GitHub 源码 ZIP。';
    pluginControls.querySelector<HTMLButtonElement>('#ste_baibai_remove')!.disabled = !installed.baibai;
    pluginControls.querySelector<HTMLButtonElement>('#ste_baibai_remove')!.addEventListener('click', async () => {
        try {
            await window.__STE_TAVERN_FLUSH__?.();
            if (owner.value === 'baibai') await request('/ste/runtime', { memoryOwner: 'none' });
            await refresh();
            await request('/ste/extensions/remove'); location.reload();
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    const docsLink = document.createElement('a'); docsLink.textContent = '下载已验证的 1.2.7 原版 ZIP';
    docsLink.href = `https://github.com/baibai-git/ST-BaiBai-Book/archive/${installed.supported.commit}.zip`; docsLink.target = '_blank'; docsLink.rel = 'noopener'; pluginControls.append(docsLink);
    pluginControls.querySelector<HTMLInputElement>('#ste_baibai_zip')!.addEventListener('change', async event => {
        try {
            const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
            if (file.size > 25 * 1024 * 1024) throw new Error('插件 ZIP 需小于 25 MB');
            await window.__STE_TAVERN_FLUSH__?.();
            const result = await request<{ version: string }>('/ste/extensions/install', { bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
            pluginStatus.textContent = `已安装 ${result.version}，正在重新打开聊天…`;
            location.reload();
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    panel.querySelector<HTMLElement>('#ste_memory_open')!.addEventListener('click', async () => {
        try {
            const snapshot = await request<{ documents: MemoryDocument[] }>('/ste/memory');
            const container = document.createElement('div');
            container.style.textAlign = 'left';
            const select = document.createElement('select'); select.id = 'ste_memory_file';
            select.append(new Option('新建笔记', ''));
            const states: Record<string, string> = { active: '可用', invalidated: '来源已变化', conflict: '文件冲突' };
            for (const doc of snapshot.documents) select.append(new Option(`${doc.path} · ${states[doc.status] ?? doc.status} · ${doc.owner === 'manual' ? '手动' : '自动'}`, doc.path));
            const path = document.createElement('input'); path.id = 'ste_memory_path'; path.className = 'text_pole'; path.placeholder = '如 style.md 或 characters/林.md'; path.value = 'style.md';
            const body = document.createElement('textarea'); body.id = 'ste_memory_body'; body.className = 'text_pole'; body.rows = 16;
            const sources = document.createElement('pre'); sources.style.whiteSpace = 'pre-wrap';
            let expectedDigest: string | null = null;
            select.addEventListener('change', () => {
                const doc = snapshot.documents.find(item => item.path === select.value);
                path.value = doc?.path ?? ''; body.value = doc?.body ?? ''; expectedDigest = doc?.digest ?? null;
                sources.textContent = doc?.sourceRefs.map(ref => `来源消息：${ref.messageId} / ${ref.candidateId}`).join('\n') ?? '';
            });
            const note = document.createElement('p'); note.textContent = '手动保存后，这份笔记由你维护，Agent 会保留你的修改。';
            container.append(note, select, path, body, sources);
            const ok = await new Popup(container, POPUP_TYPE.CONFIRM, '', { wide: true, okButton: '保存笔记' }).show();
            if (ok) { await request('/ste/memory/save', { path: path.value, body: body.value, expectedDigest }); toastr.success('笔记已保存'); }
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    panel.querySelector<HTMLElement>('#ste_references_open')!.addEventListener('click', async () => {
        try {
            const status = await request<RuntimeStatusPayload>('/ste/runtime/status');
            const pre = document.createElement('pre'); pre.style.whiteSpace = 'pre-wrap'; pre.style.textAlign = 'left';
            pre.textContent = status.references?.map(ref => `${ref.label} (${ref.resourceId})\n${ref.text}`).join('\n\n') || '本轮尚无引用资料。';
            await new Popup(pre, POPUP_TYPE.TEXT, '', { wide: true }).show();
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    panel.querySelector<HTMLElement>('#ste_memory_retry')!.addEventListener('click', () => { void request('/ste/runtime/retry-memory').catch(error => toastr.error(errorMessage(error))); });
    panel.querySelector<HTMLElement>('#ste_world_versions')!.addEventListener('click', async () => {
        try {
            const container = document.createElement('div'); container.style.textAlign = 'left';
            const note = document.createElement('p'); note.textContent = '接受后只在当前故事分支生效。原条目保留；修改来源剧情会使对应版本失效。'; container.append(note);
            const list = document.createElement('div'); container.append(list);
            async function draw(): Promise<void> {
                const versions = await request<WorldbookVersionItem[]>('/ste/worldbook-versions'); list.replaceChildren();
                if (!versions.length) { list.textContent = '尚无世界书版本草稿。'; return; }
                const labels: Record<WorldbookVersionItem['status'], string> = { draft: '待接受', active: '当前生效', superseded: '历史版本', invalidated: '来源或原件已变化', rejected: '已拒绝' };
                for (const version of versions) {
                    const row = document.createElement('details'); row.open = version.status === 'draft';
                    const title = document.createElement('summary'); title.textContent = `${version.worldName} / ${version.entryName} v${version.version} · ${labels[version.status]}`;
                    const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap';
                    text.textContent = `原条目：\n${version.originalContent}\n\nv${version.version}：\n${version.content}\n\n原因：${version.reason}\n来源：${version.sourceRefs.map(ref => ref.messageId).join('、')}`;
                    row.append(title, text);
                    for (const [action, label] of [['accept', '接受此版本'], ['reject', '拒绝 / 撤回此版本']] as const) {
                        if (action === 'accept' && version.status !== 'draft' || action === 'reject' && !['draft', 'active'].includes(version.status)) continue;
                        const button = document.createElement('button'); button.className = 'menu_button'; button.textContent = label;
                        button.addEventListener('click', async () => { try { await request('/ste/worldbook-versions/' + action, { id: version.id }); await draw(); } catch (error) { toastr.error(errorMessage(error)); } }); row.append(button);
                    }
                    list.append(row);
                }
            }
            await draw(); await new Popup(container, POPUP_TYPE.TEXT, '', { wide: true }).show();
        } catch (error) { toastr.error(errorMessage(error)); }
    });
    panel.querySelector<HTMLElement>('#ste_context_reset')!.addEventListener('click', async () => {
        try { await request('/ste/runtime/reset-context'); await refresh(); toastr.info('下一轮将重新建立上下文周期，故事正文保留。'); }
        catch (error) { toastr.error(errorMessage(error)); }
    });
    st.eventSource.makeFirst(st.event_types.GENERATION_AFTER_COMMANDS, async (type: string, _options: unknown, dryRun: boolean) => {
        if (dryRun) return;
        if (!window.__STE_DRAFT_READY__()) throw new Error('请先恢复或丢弃聊天底部的草稿，再继续发送');
        generationType = type; responseTurn = null; worldHandled = false; worldEntries = []; worldPreparationError = undefined;
        await refresh();
    });
    st.eventSource.makeFirst(st.event_types.MESSAGE_RECEIVED, async (messageId: number, type: string) => {
        if (!responseTurn || type === 'first_message') return;
        const turnId = responseTurn; responseTurn = null;
        const message = st.chat[messageId];
        if (!message || message.is_user) return;
        window.__STE_STAMP_CHAT__(st.chat);
        const runtimeMeta = message.extra?.ste_runtime as { messageId?: string } | undefined;
        if (!runtimeMeta?.messageId) return;
        try { await request('/ste/runtime/confirm-candidate', { turnId, messageId: runtimeMeta.messageId,
            candidateId: `candidate:${turnId}`, content: message.mes }); }
        catch { return; } // Stopped/failed partial prose still saves, without a factual completion identity.
        message.extra!.ste_runtime = { ...runtimeMeta, turnId, candidateId: `candidate:${turnId}` };
        if (message.swipe_info?.[message.swipe_id ?? 0]) {
            const info = message.swipe_info[message.swipe_id ?? 0] as { extra?: Record<string, unknown> }; info.extra ??= {};
            info.extra.ste_runtime = { ...message.extra!.ste_runtime };
        }
    });
    st.eventSource.on(st.event_types.CHAT_CHANGED, () => refresh().catch(error => toastr.error(errorMessage(error))));
    await refresh();
    installStatusPolling(host, () => request<RuntimeStatusPayload>('/ste/runtime/status').then(renderStatus));
}
function installManagementControls(): void {
    const routes: [string, string, string][] = [
        ['#rm_button_create, #character_import_button, #external_import_button', 'library', '在 STE 资料库创建或导入角色'],
        ['#delete_button, #character_context_menu_delete, #bulkDeleteButton', 'library', '在 STE 资料库管理角色'],
        ['#export_button', 'character', '在 STE 角色详情导出角色卡'],
        ['#chat_import_button, .PastChat_cross', 'story', '在 STE 故事页导入或管理聊天'],
        ['#world_import_button', 'worldbook', '在 STE 世界书管理页导入'],
    ];
    const unavailable: [string, string][] = [
        ['#rm_button_group_chats', '当前支持单角色聊天和故事分支，群聊尚未接入。'],
        ['#add_background_button_top, #add_bg_button', '当前可选择内置背景；自定义背景上传尚未接入。'],
    ];
    for (const [selector, , title] of routes) for (const element of document.querySelectorAll<HTMLElement>(selector)) element.title = title;
    for (const [selector, title] of unavailable) for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        element.title = title; element.setAttribute('aria-disabled', 'true');
    }
    document.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        const target = event.target;
        const route = routes.find(([selector]) => target.closest(selector));
        const blocked = unavailable.find(([selector]) => target.closest(selector));
        if (!route && !blocked) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (blocked) { toastr.info(blocked[1]); return; }
        if (!route) return;
        void host.request('/ste/manage', { target: route[1] }).then(async response => {
            if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? '无法打开管理页');
        }).catch(error => toastr.error(errorMessage(error)));
    }, true);
}

window.__STE_TAVERN_READY__ = () => { void loadUpstream('/script.js').then(async st => {
    st.eventSource.makeFirst(st.event_types.OAI_PRESET_CHANGED_BEFORE, ({ presetName }: { presetName: string }) => {
        if (menuPresetRevisions[presetName]) host.selectPreset(presetName, menuPresetRevisions[presetName]);
    });
    window.__STE_TAVERN_STARTUP__('启动中：连接模型与玩法控件…');
    stModule = st; await installConnectionControls(); await installRuntimeControls(st);
    processEvents = installProcessEvents(host, st);
    window.__STE_TAVERN_STARTUP__('启动中：准备酒馆助手…');
    if (!installedHelper) await installHelperControls(await installHelperHost(host, st));
    window.__STE_TAVERN_STARTUP__('启动中：准备扩展管理控件…');
    await installExtensionControls(host, st); await installPackageControls(host); installManagementControls(); host.ready();
}).catch(error => { window.__STE_TAVERN_STARTUP__(errorMessage(error) || String(error), true); toastr.error(errorMessage(error)); console.error('Tavern startup failed:', error instanceof Error ? error.name : 'UnknownError'); }); };
// Blob module linking serves the user-installed browser build in WebViews as well as the browser.
// Imported ST modules still resolve to the original, single module instance in this iframe.
const extensionUrls = new Map<string, string>();
const helperUrls = new Map<string, string>();
window.__STE_EXTENSION_RESOURCE__ = (name, resource) => (name === 'third-party/ST-BaiBai-Book' ? extensionUrls : name === 'third-party/JS-Slash-Runner' ? helperUrls : null)?.get(String(resource).split(/[?#]/)[0]);
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
    return import(/* @vite-ignore */ new URL(path, location.href).href);
};
const packageResponse = await host.request('/ste/extensions/package');
if (!packageResponse.ok) throw new Error(((await packageResponse.json()) as { error?: { message?: string } }).error?.message ?? '插件安装包无法读取');
const installedPackage = await packageResponse.json() as InstalledExtensionPackage | null;
if (installedPackage) {
    const config = await (await host.request('/ste/runtime')).json() as RuntimeConfigPayload;
    window.__STE_MEMORY_OWNER__ = config.memoryOwner;
    for (const [path, text] of Object.entries(installedPackage.files)) {
        const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'text/markdown';
        extensionUrls.set(path, URL.createObjectURL(new Blob([path === 'dist/index.js' && installedPackage.module !== undefined ? installedPackage.module : text], { type })));
    }
    window.addEventListener('pagehide', () => { for (const url of extensionUrls.values()) URL.revokeObjectURL(url); }, { once: true });
}
const helperResponse = await host.request('/ste/extensions/helper/package');
if (!helperResponse.ok) throw new Error(((await helperResponse.json()) as { error?: { message?: string } }).error?.message ?? '酒馆助手安装包无法读取');
const installedHelper = await helperResponse.json() as InstalledExtensionPackage | null;
if (installedHelper) {
    for (const [path, text] of Object.entries(installedHelper.files).sort(([a], [b]) => (a === 'dist/index.js' ? 1 : 0) - (b === 'dist/index.js' ? 1 : 0))) {
        const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'text/plain';
        const linked = path === 'dist/index.js' ? text.replaceAll('../../../../../', new URL('/', location.href).href)
            .replace('../lib/jsoneditor.js', helperUrls.get('lib/jsoneditor.js') ?? '../lib/jsoneditor.js')
            .replace('/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js', helperUrls.get('lib/tailwindcss.min.js') ?? '/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js') : text;
        helperUrls.set(path, URL.createObjectURL(new Blob([linked], { type })));
    }
    window.addEventListener('pagehide', () => { for (const url of helperUrls.values()) URL.revokeObjectURL(url); }, { once: true });
}
window.__TAURITAVERN_MAIN_READY__ = Promise.resolve();
