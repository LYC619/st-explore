// Synthetic-only comparison of the installed ST /generate custom route and STE provider.
// No server, private preset, user context, or credentials are loaded/executed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { createServer } from 'vite';
const dir = '.cache/feedback1109/st-reference';
const source = await readFile(`${dir}/chat-completions.js`, 'utf8');
const converters = await readFile(`${dir}/prompt-converters.js`, 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
const context = vm.createContext({ crypto, console: { info() {}, debug() {}, warn() {}, error() {} },
  getConfigValue: (_key, fallback) => fallback, tryParse: JSON.parse });
vm.runInContext(converters.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '') + '\nglobalThis.convert = postProcessPrompt; globalThis.names = getPromptNames;', context);
let route, captured;
Object.assign(context, {
  router: { post: (_path, fn) => { route = fn; } },
  CHAT_COMPLETION_SOURCES: { CUSTOM: 'custom' }, TEXT_COMPLETION_MODELS: [],
  SECRET_KEYS: { CUSTOM: 'fixture' }, readSecret: () => 'fixture-key',
  mergeObjectWithYaml: (obj, text) => { if (text) Object.assign(obj, parse(text)); },
  excludeKeysByYaml: (obj, text) => { for (const key of (text ? parse(text) : []) ?? []) delete obj[key]; },
  embedOpenRouterMedia: () => {}, flattenSchema: x => x,
  AbortController, OPENAI_REASONING_EFFORT_MODELS: [], OPENAI_VERBOSITY_MODELS: /^fixture-never$/,
  fetch: async (url, config) => { captured = { url, body: JSON.parse(config.body) }; return { ok: true, json: async () => ({ choices: [] }) }; },
});
const start = source.indexOf("router.post('/generate',");
if (start < 0) throw Error('Reference route missing');
const end = source.indexOf('\n});', start) + 4;
vm.runInContext(source.slice(start, end), context);
const vite = await createServer({ configFile: false, resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true } });
try {
  const { prepareCompletion } = await vite.ssrLoadModule('/src/lib/roleplay/provider.ts');
  const base = { chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:1/v1', model: 'fixture-model', stream: false,
    temperature: 0.7, max_tokens: 256, user_name: 'Observer', char_name: 'Guide', group_names: [],
    messages: [{ role: 'system', content: 'Summarize the fictional expedition.' }, { role: 'user', content: 'The expedition arrived at a lighthouse.' }, { role: 'assistant', content: 'They recorded the weather.' }, { role: 'user', content: '生成总结' }] };
  const cases = [{ id: 'plain', patch: {} }, { id: 'strict', patch: { custom_prompt_post_processing: 'strict' } },
    { id: 'yaml', patch: { custom_include_body: 'top_k: 40', custom_exclude_body: '- temperature' } },
    { id: 'schema', patch: { json_schema: { name: 'summary', value: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } } } },
    { id: 'logprobs', patch: { logprobs: 5 } }];
  const results = [];
  for (const fixture of cases) {
    const request = { ...structuredClone(base), ...fixture.patch }; captured = undefined;
    await route({ body: structuredClone(request), user: { directories: {} }, socket: { removeAllListeners() {}, on() {} } }, { send() {}, status() { return this; } });
    if (!captured) throw Error(`Synthetic route failed: ${fixture.id}`);
    const ste = prepareCompletion({ apiUrl: base.custom_url + '/chat/completions', model: base.model, apiKey: 'fixture-key' }, request);
    const body = JSON.parse(JSON.stringify(ste.body));
    results.push({ id: fixture.id, equal: isDeepStrictEqual(captured.body, body), differingFields: [...new Set([...Object.keys(captured.body), ...Object.keys(body)])].filter(k => !isDeepStrictEqual(captured.body[k], body[k])) });
  }
  await mkdir('.cache/feedback1109', { recursive: true });
  const evidence = { syntheticOnly: true, realRequests: 0, referenceBackendSha256: sha(source), referenceConvertersSha256: sha(converters), results,
    limitations: ['isolated backend route, not complete frontend or extensions', 'media embedding and schema flattening excluded from fixtures', 'no real preset/model/session replay', 'cannot attribute user refusal from these fixtures'] };
  await writeFile('.cache/feedback1109/summary-transport.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await vite.close(); }
