import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transpileTavernModule } from './host-overlay.mjs';

const source = (await transpileTavernModule(fileURLToPath(new URL('../../src/tavern/regex-assets.ts', import.meta.url)))).toString('utf8');
const executable = source
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/export /g, '')
  .replace("const regex = await loadUpstream('/scripts/extensions/regex/index.js');", 'const regex = { loadRegexScripts: async () => {} };');

test('explicit branch frontends execute with the original character allowlist still closed', async () => {
  const window = {}, document = { querySelector: () => null }, toastr = { warning: () => {} };
  const script = { id: 'front', scriptName: 'front', findRegex: '$', replaceString: 'html', trimStrings: [], placement: [2] };
  let snapshot = { globalScripts: [], embeddedScripts: [], suppressedEmbeddedIds: [], missingAssetIds: [], frontend: { rules: [{ lane: 'embeddedScripts', script }] } };
  const refresh = new Function('window', 'document', 'toastr', 'getSnapshot', executable + ';return installRegexAssets({request:async()=>({ok:true,json:async()=>getSnapshot()})});')(window, document, toastr, () => snapshot);
  await refresh(); assert.deepEqual(window.__STE_ALLOWED_FRONTEND_REGEX__(), [script]);
  assert.deepEqual(window.__STE_REGEX_REQUIRING_CONSENT__([script, { id: 'original' }]), [{ id: 'original' }]);
  assert.deepEqual(window.__STE_REGEX_LANE__('embeddedScripts', [{ id: 'original' }]), [{ id: 'original' }, script]);
  snapshot = { ...snapshot, frontend: null }; await refresh(); assert.deepEqual(window.__STE_ALLOWED_FRONTEND_REGEX__(), []);
});
test('refresh keeps variables already written by a running frontend script', async () => {
  let scripts = [{ id: 'ste-frontend:main:script', data: { count: 7 } }];
  const window = { TavernHelper: { getScriptTrees: () => scripts, replaceScriptTrees: next => { scripts = next; } } };
  const document = { querySelector: () => null }, toastr = { warning: () => {} };
  const snapshot = { globalScripts: [], embeddedScripts: [], suppressedEmbeddedIds: [], missingAssetIds: [], frontendScripts: [{ id: 'ste-frontend:main:script', data: {} }] };
  const refresh = new Function('window', 'document', 'toastr', 'snapshot', executable + ';return installRegexAssets({request:async()=>({ok:true,json:async()=>snapshot})});')(window, document, toastr, snapshot);
  await refresh(); assert.deepEqual(scripts[0].data, { count: 7 });
  snapshot.frontendScripts = [{ id: 'ste-frontend:branch:script', data: { count: 2 } }];
  await refresh(); assert.deepEqual(scripts, [{ id: 'ste-frontend:branch:script', data: { count: 2 } }]);
});
test('legacy frontend replacements containing capture tokens run through the upstream engine', async () => {
  const window = {}, document = { querySelector: () => null }, toastr = { warning: () => {} };
  const script = { id: 'legacy', scriptName: 'legacy', findRegex: '(hello)', replaceString: '<div>$1</div>', placement: [2] };
  const snapshot = { globalScripts: [], embeddedScripts: [], suppressedEmbeddedIds: [], missingAssetIds: [], frontend: { rules: [{ lane: 'embeddedScripts', script }] } };
  const refresh = new Function('window', 'document', 'toastr', 'snapshot', executable + ';return installRegexAssets({request:async()=>({ok:true,json:async()=>snapshot})});')(window, document, toastr, snapshot);
  await refresh();
  // Execute the pinned engine's actual replacement/filter functions. Only its
  // unrelated settings/macro/regex-cache dependencies are supplied here.
  const engine = await readFile(new URL('../../vendor/tauritavern/src/scripts/extensions/regex/engine.js', import.meta.url), 'utf8');
  const run = new Function('canRunRegexScript', 'resolveRegexString', 'RegexProvider', 'substituteParams', engine.slice(engine.indexOf('export function runRegexScript')).replace('export function', 'function') + ';return runRegexScript;')(() => true, s => s.findRegex, { instance: { get: s => new RegExp(s) } }, s => s);
  for (const rule of [window.__STE_REGEX_LANE__('embeddedScripts', [])[0], window.__STE_ALLOWED_FRONTEND_REGEX__()[0]]) assert.equal(run(rule, 'hello'), '<div>hello</div>');
  assert.equal(script.trimStrings, undefined, 'runtime defaults must not rewrite saved source rules');
});
