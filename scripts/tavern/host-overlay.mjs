import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readAsset, safeRelativePath, sha256, sourceAssetEntries } from './source.mjs';
import { prepareCacheDirectory } from './cache.mjs';

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Upstream host seam changed: ${before}`);
  return text.replace(before, after);
}

/** Generate a reviewed integration layer. The pinned source is never edited. */
export async function createHostAssets(source, cacheRelative = 'host') {
  const originals = sourceAssetEntries(source);
  const additions = [];
  const overlays = [];
  const cacheRoot = await prepareCacheDirectory(source.projectRoot, cacheRelative);

  async function generated(url, bytes) {
    const relative = url.slice(1);
    if (!safeRelativePath(relative)) throw new Error(`Unsafe generated host asset: ${url}`);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const target = path.join(cacheRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { url, root: cacheRoot, path: relative, sha256: sha256(buffer), size: buffer.length };
  }
  async function override(url, transform) {
    const original = originals.get(url);
    if (!original) throw new Error(`Missing pinned host seam: ${url}`);
    const text = (await readAsset(original)).toString('utf8');
    overlays.push({ asset: await generated(url, await transform(text)), expectedSha256: original.sha256 });
  }
  await override('/tauri-main.js', () => readFile(path.join(source.projectRoot, 'src/tavern/host-bootstrap.js')));
  for (const name of ['draft-recovery.js', 'recovery-export.js', 'regex-assets.js', 'helper-client.js', 'helper-messages.js', 'helper-host.js', 'helper-controls.js', 'package-controls.js']) additions.push(await generated('/ste/' + name, await readFile(path.join(source.projectRoot, 'src/tavern/' + name))));
  additions.push(await generated('/ste/helper-lodash.js', await readFile(path.join(source.projectRoot, 'node_modules/lodash/lodash.min.js'))));
  await override('/scripts/tauritavern/agent/agent-generation-router.js', () =>
    '// STE runs its tool Agent at the final transport boundary. The writer uses the ordinary ST path.\n'
    + 'export async function getAgentGenerationOptions() { return {}; }\n');
  await override('/init.js', text => replaceOnce(text,
    'await setupDevThirdPartyExtensionServiceWorker();',
    '// STE owns the origin service worker; upstream development proxy is not installed.'));
  await override('/scripts/world-info.js', text => replaceOnce(replaceOnce(replaceOnce(text,
    'export async function getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData) {',
    'export async function getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData) {\n    if (globalThis.__STE_AGENT_MODE__) return globalThis.__STE_WORLD_PROMPT__(await getSortedEntries());'),
    'await eventSource.emit(event_types.WORLDINFO_UPDATED, name, data);',
    'const steSaved = await response.json();\n    if (typeof steSaved?._ste_revision === "string") data._ste_revision = steSaved._ste_revision;\n    await eventSource.emit(event_types.WORLDINFO_UPDATED, name, data);'),
    'entries = prepareWorldInfoEntries(entries, parseDecorators, getStringHash);',
    'entries = await globalThis.__STE_EFFECTIVE_WORLDS__(entries);\n        entries = prepareWorldInfoEntries(entries, parseDecorators, getStringHash);'));
  await override('/scripts/openai.js', text => replaceOnce(text,
    'chatCompletion.setTokenBudget(userSettings.openai_max_context, userSettings.openai_max_tokens);',
    'chatCompletion.setTokenBudget(Math.max(1, userSettings.openai_max_context - (globalThis.__STE_AGENT_MODE__ ? (globalThis.__STE_CONTEXT_RESERVE__ || 2600) : 0)), userSettings.openai_max_tokens);'));
  await override('/scripts/extensions/runtime/resource-paths.js', text => replaceOnce(text,
    'return `/scripts/extensions/${name}/${normalizedPath}`;',
    'return globalThis.__STE_EXTENSION_RESOURCE__?.(name, normalizedPath) ?? `/scripts/extensions/${name}/${normalizedPath}`;'));
  await override('/scripts/extensions/regex/engine.js', text => replaceOnce(replaceOnce(replaceOnce(text,
    'return extension_settings.regex ?? [];',
    'return globalThis.__STE_REGEX_LANE__?.("globalScripts", extension_settings.regex ?? []) ?? extension_settings.regex ?? [];'),
    'return Array.isArray(scopedScripts) ? scopedScripts : [];',
    'return globalThis.__STE_REGEX_LANE__?.("embeddedScripts", Array.isArray(scopedScripts) ? scopedScripts : []) ?? (Array.isArray(scopedScripts) ? scopedScripts : []);'),
    'export async function saveScriptsByType(scripts, scriptType) {',
    'export async function saveScriptsByType(scripts, scriptType) {\n    if (globalThis.__STE_SAVE_REGEX_LANE__) scripts = await globalThis.__STE_SAVE_REGEX_LANE__(scripts, scriptType);'));
  await override('/scripts/tauri/regex/native-regex-transform.js', text => replaceOnce(text,
    'export function isNativeRegexBackendAvailable() {\n    return isTauri();\n}',
    'export function isNativeRegexBackendAvailable() {\n    return false; // STE uses the original JavaScript regex engine on all supported shells.\n}'));
  await override('/scripts/extensions/regex/index.js', text => {
    text = replaceOnce(text, 'async function loadRegexScripts() {', 'export async function loadRegexScripts() {');
    text = replaceOnce(text, '    if (scriptType === SCRIPT_TYPES.SCOPED) {',
      '    if (scriptType === SCRIPT_TYPES.GLOBAL) await saveScriptsByType(array, SCRIPT_TYPES.GLOBAL);\n\n    if (scriptType === SCRIPT_TYPES.SCOPED) {');
    const globalSave = 'case SCRIPT_TYPES.GLOBAL:\n                // will be handled by saveSettingsDebounced\n                break;';
    if (text.split(globalSave).length !== 3) throw new Error('Upstream regex global save seams changed');
    text = text.replaceAll(globalSave, 'case SCRIPT_TYPES.GLOBAL:\n                await saveScriptsByType(array, SCRIPT_TYPES.GLOBAL);\n                break;');
    text = replaceOnce(text, 'extension_settings.regex = newGlobalScripts;', 'await saveScriptsByType(newGlobalScripts, SCRIPT_TYPES.GLOBAL);');
    text = replaceOnce(text, 'async function moveRegexScript(script, toType, fromType = null, saveSettings = true) {',
      'async function moveRegexScript(script, toType, fromType = null, saveSettings = true) {\n    if (script.id?.startsWith("ste-regex-asset-")) { toastr.error("关联正则的作用域由 STE 资产引用决定，请在资产管理中调整"); return; }');
    return text;
  });
  await override('/scripts/welcome-screen.js', text => replaceOnce(replaceOnce(text,
    'chatElement.append(fragment.firstChild);',
    'if (getCurrentChatId() !== undefined) return;\n        chatElement.append(fragment.firstChild);'),
    'await unshallowPermanentAssistant();\n    sendAssistantMessage();',
    'if (getCurrentChatId() !== undefined) return;\n    await unshallowPermanentAssistant();\n    if (getCurrentChatId() !== undefined) return;\n    sendAssistantMessage();'));
  await override('/script.js', input => {
    let text = input;
    text = replaceOnce(text, 'throw new Error(result.statusText);',
      'throw new Error(errorData?.error?.message || result.statusText || "聊天保存失败");');
    text = replaceOnce(text,
      'toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Chat could not be saved`);',
      'toastr.error(error.message, "聊天尚未保存，请使用顶部的重试或导出");');
    text = replaceOnce(text, 'chat_metadata = chatHeader?.chat_metadata ?? {};',
      'chat_metadata = chatHeader?.chat_metadata ?? {};\n            allowNewChat ||= chat_metadata.ste_pending_initial_greeting === true;\n            delete chat_metadata.ste_pending_initial_greeting;');
    for (const declaration of [
      'export async function selectCharacterById(id, { switchMenu = true } = {}) {',
      'export async function openCharacterChat(file_name) {',
      'export async function doNewChat({ deleteCurrentChat = false } = {}) {',
    ]) text = replaceOnce(text, declaration, declaration + '\n    await globalThis.__STE_BEFORE_CHAT_SWITCH__();');
    return replaceOnce(replaceOnce(replaceOnce(replaceOnce(replaceOnce(replaceOnce(replaceOnce(text,
    'const payload = [chatHeader, ...trimmedChat];',
    'globalThis.__STE_STAMP_CHAT__(trimmedChat);\n    const payload = [chatHeader, ...trimmedChat];'),
    'await eventSource.emit(event_types.APP_READY);',
    'await eventSource.emit(event_types.APP_READY);\n        globalThis.__STE_TAVERN_READY__();'),
    'targetMessage.extra = structuredClone(targetSwipeInfo?.extra) ?? {};',
    'const steIdentity = targetMessage.extra?.ste_runtime;\n    targetMessage.extra = structuredClone(targetSwipeInfo?.extra) ?? {};\n    if (steIdentity) targetMessage.extra.ste_runtime = { ...targetMessage.extra.ste_runtime, messageId: steIdentity.messageId, role: steIdentity.role };'),
    'chat.splice(Number(this_edit_mes_id) + 1, 0, clone);',
    'globalThis.__STE_NEW_MESSAGE_ID__(clone);\n            chat.splice(Number(this_edit_mes_id) + 1, 0, clone);'),
    'async function messageEditDone(div)', 'export async function messageEditDone(div)'),
    'export function flushDebouncedChatSave() {',
    'export function hasUnsavedChat() { return !!chatSaveTimeout || pendingChatSaveTasks > 0 || !!globalThis.__STE_SAVE_FAILED__; }\n\nexport function flushDebouncedChatSave() {'),
    "$('#avatar_url_pole').val(characters[chid].avatar);",
    "$('#avatar_url_pole').val(characters[chid].avatar);\n    globalThis.__STE_OPEN_CARD_EDITOR__(characters[chid]);");
  });

  const entries = new Map(source.manifest.files.map(entry => [entry.path, entry]));
  async function originalDefault(relative) {
    const entry = entries.get(`default/content/${relative}`);
    if (!entry) throw new Error(`Default resource is not pinned: ${relative}`);
    return readAsset({ root: source.vendorRoot, ...entry });
  }
  const index = JSON.parse((await originalDefault('index.json')).toString());
  const defaults = { settings: {}, presets: {}, backgrounds: [], avatars: [] };
  const presetTypes = new Set(['openai_preset', 'textgen_preset', 'instruct', 'context', 'sysprompt', 'reasoning', 'theme', 'moving_ui', 'quick_replies']);
  for (const item of index) {
    if (item.type === 'settings') defaults.settings = JSON.parse((await originalDefault(item.filename)).toString());
    if (presetTypes.has(item.type)) {
      const data = JSON.parse((await originalDefault(item.filename)).toString());
      const name = path.basename(item.filename, '.json');
      (defaults.presets[item.type] ??= []).push({ name, data: { ...data, name: data.name ?? name } });
    }
    if (['background', 'avatar', 'stylesheet'].includes(item.type)) {
      const name = path.basename(item.filename);
      const url = item.type === 'background' ? `/backgrounds/${name}` : item.type === 'avatar' ? `/User Avatars/${name}` : '/css/user.css';
      const asset = await generated(url, await originalDefault(item.filename));
      if (originals.has(url)) overlays.push({ asset, expectedSha256: originals.get(url).sha256 });
      else additions.push(asset);
      if (item.type === 'background') defaults.backgrounds.push(name);
      if (item.type === 'avatar') defaults.avatars.push(name);
    }
  }
  additions.push(await generated('/ste/tavern-defaults.json', JSON.stringify(defaults)));
  return { additions, overlays };
}
