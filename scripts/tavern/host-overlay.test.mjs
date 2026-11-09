import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPinnedSource, readAsset, sourceAssetEntries } from './source.mjs';
import { composeAssets } from './build.mjs';
import { createHostAssets } from './host-overlay.mjs';

const source = await loadPinnedSource();
const original = sourceAssetEntries(source);
const { additions, overlays } = await createHostAssets(source, 'host-test');
const assets = composeAssets(original, additions, overlays);

test('literal HTML preserves JavaScript dollar tokens while ordinary regex capture replacement remains active', async () => {
  const engine = (await readAsset(assets.get('/scripts/extensions/regex/engine.js'))).toString();
  const run = new Function('canRunRegexScript', 'resolveRegexString', 'RegexProvider', 'substituteParams',
    engine.slice(engine.indexOf('export function runRegexScript')).replace('export function', 'function') + ';return runRegexScript;')
    (() => true, s => s.findRegex, { instance: { get: s => new RegExp(s) } }, s => s);
  const script = { findRegex: '(hello)', replaceString: '<script>const text = "$1/$2";</script>', trimStrings: [], steLiteralReplacement: true };
  assert.equal(run(script, 'hello'), script.replaceString);
  assert.equal(run({ ...script, steLiteralReplacement: false, replaceString: '<div>$1</div>' }, 'hello'), '<div>hello</div>');
});

test('host bootstrap replaces only a hash-verified upstream URL, leaving pinned originals unchanged', async () => {
  const entry = overlays.find(entry => entry.asset.url === '/tauri-main.js');
  assert.ok(entry, 'STE host bootstrap is present');
  assert.equal(entry.expectedSha256, original.get('/tauri-main.js').sha256);
  assert.match((await readAsset(assets.get('/tauri-main.js'))).toString(), /__STE_TAVERN_HOSTS__/);
  assert.doesNotMatch((await readAsset(original.get('/tauri-main.js'))).toString(), /__STE_TAVERN_HOSTS__/);
});

test('canonical chat objects get stable IDs before upstream serializes the save payload', async () => {
  const sourceText = (await readAsset(assets.get('/script.js'))).toString();
  const stampAt = sourceText.indexOf('globalThis.__STE_STAMP_CHAT__(trimmedChat)');
  const payloadAt = sourceText.indexOf('const payload = [chatHeader, ...trimmedChat]');
  assert.ok(stampAt >= 0 && stampAt < payloadAt);
  assert.match(sourceText, /export async function Generate\(/);
  assert.match(sourceText, /export class StreamingProcessor|class StreamingProcessor/);
  assert.match((await readAsset(assets.get('/scripts/tauritavern/agent/agent-generation-router.js'))).toString(),
    /getAgentGenerationOptions\(\) \{ return \{\}; \}/);
});

test('STE bootstrap never installs the upstream root service worker', async () => {
  const sourceText = (await readAsset(assets.get('/init.js'))).toString();
  assert.doesNotMatch(sourceText, /await setupDevThirdPartyExtensionServiceWorker\(\);/);
  assert.match(sourceText, /await importWithRetry\('\.\/script\.js'\)/);
});

test('an early module load failure reaches the STE shell instead of leaving it loading forever', async () => {
  const sourceText = (await readAsset(assets.get('/init.js'))).toString();
  const notices = [];
  const host = { startup: (...args) => notices.push(args) };
  const win = { parent: { __STE_TAVERN_HOSTS__: new Map([['test', host]]) } };
  const error = new Error('Cannot load local library');
  const executable = sourceText.replace(/await import\(buildSpecifier\(i\)\)/g, 'await rejectImport()');
  await new Function('window', 'globalThis', 'location', 'URLSearchParams', 'console', 'setTimeout', 'rejectImport',
    executable.replace('initializeApplication();', 'return initializeApplication();'))
    (win, win, { search: '?host=test' }, URLSearchParams, { error() {}, warn() {} }, callback => callback(), () => Promise.reject(error));
  assert.ok(notices.some(([message, failed]) => failed && message.includes(error.message)), 'module failure is reported to the registered host');
});

function samplerStartupFixture(sourceText, loadApiSelectedSamplers) {
  // Execute the full upstream settings initializer, with inert DOM controls.
  const start = sourceText.indexOf('export async function loadTextGenSettings(');
  const end = sourceText.indexOf('\n/**', start);
  assert.ok(start >= 0 && end > start);
  const controls = { val() { return this; }, trigger() { return this; } };
  let presetsLoaded = 0;
  const globals = {
    loadApiSelectedSamplers,
    convertPresets: () => { presetsLoaded++; return []; },
    textgenerationwebui_presets: [], textgenerationwebui_preset_names: [],
    textgenerationwebui_settings: { server_urls: {} }, SERVER_INPUTS: {}, setting_names: [],
    $: () => controls, showSamplerControls() {}, BIAS_CACHE: new Map(), BIAS_KEY: 'fixture',
    displayLogitBias() {}, registerDebugFunction() {},
  };
  const load = new Function(...Object.keys(globals), sourceText.slice(start, end).replace('export ', '') + ';return loadTextGenSettings;')(...Object.values(globals));
  return { load: main_api => load({}, { main_api }), presetsLoaded: () => presetsLoaded };
}

test('Chat Completions initializes while its unrelated Text Completions cache is blocked', async () => {
  const text = (await readAsset(assets.get('/scripts/textgen-settings.js'))).toString();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const fixture = samplerStartupFixture(text, () => blocked);
  const loading = fixture.load('openai');
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(fixture.presetsLoaded(), 1, 'unrelated cache must not block the actual chat startup'); }
  finally { release(); await loading; }
});

test('Text Completions still waits for its own sampler preferences before initializing', async () => {
  const text = (await readAsset(assets.get('/scripts/textgen-settings.js'))).toString();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const fixture = samplerStartupFixture(text, () => blocked);
  const loading = fixture.load('textgenerationwebui');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.presetsLoaded(), 0);
  release(); await loading;
  assert.equal(fixture.presetsLoaded(), 1);
});

async function startupFlushFixture({ ready = false, chat = undefined, dirty = false } = {}) {
  const text = (await readAsset(assets.get('/tauri-main.js'))).toString();
  const start = text.indexOf('window.__STE_TAVERN_FLUSH__ = async () => {');
  const end = text.indexOf('window.__STE_BEFORE_CHAT_SWITCH__', start);
  assert.ok(start >= 0 && end > start);
  let writes = 0, flushes = 0;
  const st = {
    getCurrentChatId: () => chat, hasUnsavedChat: () => dirty,
    stopGeneration() {}, waitForGenerationIdle: async () => {}, flushDebouncedChatSave: async () => {},
    saveChatConditional: async () => { writes++; }, cancelPendingSettingsSave() {}, saveSettings: async () => ready,
  };
  const win = { __STE_TAVERN_DIRTY__: () => dirty };
  const node = { length: 0, closest() { return this; }, find() { return this; } };
  new Function('window', 'importSt', 'stModule', '$', 'flushBaiBai', 'host',
    text.slice(start, end).replace("import('./script.js')", 'importSt()'))
    (win, async () => st, ready ? st : undefined, () => node, async () => {}, { flush: async () => { flushes++; } });
  return { flush: win.__STE_TAVERN_FLUSH__, writes: () => writes, flushes: () => flushes };
}

test('closing a clean, uninitialized chat drains host writes without saving unready ST settings', async () => {
  const fixture = await startupFlushFixture();
  await fixture.flush();
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.flushes(), 1);
});

test('an initialized chat still saves, and a partial startup with edits or a loaded chat cannot skip saving', async () => {
  const ready = await startupFlushFixture({ ready: true });
  await ready.flush(); assert.equal(ready.writes(), 1); assert.equal(ready.flushes(), 1);
  for (const state of [{ dirty: true }, { chat: 'synthetic' }]) {
    const fixture = await startupFlushFixture(state);
    await assert.rejects(fixture.flush(), /酒馆设置尚未保存/);
    assert.equal(fixture.writes(), 1); assert.equal(fixture.flushes(), 0);
  }
});

test('supplies real default settings/presets and default media through explicit generated assets', async () => {
  const asset = assets.get('/ste/tavern-defaults.json');
  assert.ok(asset);
  const defaults = JSON.parse((await readAsset(asset)).toString());
  const upstream = JSON.parse(await readFile(path.join(source.vendorRoot, 'default/content/settings.json'), 'utf8'));
  assert.deepEqual(defaults.settings, upstream);
  assert.ok(defaults.presets.openai_preset.length > 0);
  assert.ok(defaults.presets.instruct.length > 0);
  assert.ok(assets.has('/User Avatars/user-default.png'));
  assert.ok(assets.has('/backgrounds/tavern day.jpg'));
  assert.ok(!assets.has('/sw.js'));
});

test('host output cannot escape the project cache', async () => {
  await assert.rejects(createHostAssets(source, '../outside'), /Unsafe Tavern cache/);
});
