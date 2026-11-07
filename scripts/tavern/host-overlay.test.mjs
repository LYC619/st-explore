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
