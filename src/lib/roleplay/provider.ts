import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { parse as parseYaml } from 'yaml';
import { isTauri } from '@/lib/runtime';
import { postProcessPrompt } from './prompt-post-processing';
import { reportDiagnostic } from '@/lib/diagnostics';

const COMPLETION_FIELDS = new Set([
  'messages', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty',
  'max_tokens', 'max_completion_tokens', 'stream', 'stream_options', 'stop', 'seed',
  'logit_bias', 'n', 'logprobs', 'top_logprobs', 'tools', 'tool_choice', 'parallel_tool_calls',
  'response_format', 'reasoning_effort', 'verbosity', 'prediction', 'service_tier',
  'modalities', 'audio', 'top_k', 'min_p', 'top_a', 'repetition_penalty',
]);

function yaml(value: unknown): unknown {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('自定义请求 YAML 必须是文本');
  try { return parseYaml(value, { maxAliasCount: 30 }); } catch { throw new Error('自定义请求 YAML 格式无效'); }
}

export function customHeaders(value: unknown): Record<string, string> {
  const data = yaml(value);
  if (data == null) return {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('自定义请求头 YAML 必须是键值对象');
  const result: Record<string, string> = {};
  for (const [key, field] of Object.entries(data)) {
    if (/authorization|api.?key|cookie|password|secret|token/i.test(key)) throw new Error('凭据请保存在 STE 连接配置中');
    if (typeof field !== 'string' && typeof field !== 'number' && typeof field !== 'boolean') throw new Error('自定义请求头值必须是文本或数字');
    result[key] = String(field);
  }
  return result;
}

/** The final provider envelope. Cache validation uses this same function as the transport. */
export function prepareCompletion(profile: APIConfig, request: Record<string, unknown>): {
  url: string; body: Record<string, unknown>; headers: Record<string, string>;
  promptProcessing?: { mode: string; names: Record<string, unknown>; sourceMessages: unknown[] };
} {
  const endpoint = new URL(profile.apiUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || !profile.model.trim()) {
    throw new Error('请配置有效的模型和完整的聊天 API 地址');
  }
  if (!Array.isArray(request.messages)) throw new Error('模型请求缺少消息数组');
  if (request.enable_web_search || request.request_images) throw new Error('当前连接尚未接入联网搜索或模型生图选项');
  const body: Record<string, unknown> = { model: profile.model };
  for (const [key, value] of Object.entries(request)) {
    if (COMPLETION_FIELDS.has(key) && value !== undefined) body[key] = value;
  }
  body.messages = postProcessPrompt(request.messages, request.custom_prompt_post_processing, request);
  // ST sends the requested probability count; Chat Completions uses a boolean + count.
  if (typeof request.logprobs === 'number' && request.logprobs > 0) {
    body.logprobs = true;
    body.top_logprobs = request.logprobs;
  }
  const include = yaml(request.custom_include_body);
  if (include != null) {
    if (typeof include !== 'object' || Array.isArray(include)) throw new Error('自定义请求体 YAML 必须是键值对象');
    for (const [key, value] of Object.entries(include)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('自定义请求体包含无效字段');
      body[key] = value;
    }
  }
  if (request.json_schema) {
    const schema = request.json_schema as { name?: unknown; strict?: unknown; value?: unknown };
    body.response_format = { type: 'json_schema', json_schema: { name: schema.name, strict: schema.strict ?? true, schema: schema.value } };
  }
  const exclude = yaml(request.custom_exclude_body);
  // Some older preset exports use {} for an empty list. Nonempty maps are still invalid.
  const emptyExclusion = exclude && typeof exclude === 'object' && !Array.isArray(exclude) && !Object.keys(exclude).length;
  if (exclude != null && !emptyExclusion) {
    if (!Array.isArray(exclude) || exclude.some(key => typeof key !== 'string')) throw new Error('排除字段 YAML 必须是字段名列表');
    for (const key of exclude) delete body[key];
  }
  // A profile reference is the only authoritative model selection.
  body.model = profile.model;
  if (!Array.isArray(body.messages)) throw new Error('自定义请求不能移除消息数组');
  const headers = { ...customHeaders(request.custom_include_headers), 'Content-Type': 'application/json',
    ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}) };
  const promptProcessing = typeof request.custom_prompt_post_processing === 'string' && request.custom_prompt_post_processing
    && !(include && typeof include === 'object' && Object.hasOwn(include, 'messages'))
    ? { mode: request.custom_prompt_post_processing,
      names: { user_name: request.user_name, char_name: request.char_name, group_names: request.group_names }, sourceMessages: structuredClone(request.messages) } : undefined;
  return { url: profile.apiUrl, body, headers, ...(promptProcessing ? { promptProcessing } : {}) };
}

/** Preserve the provider's actual Response, status, usage and SSE bytes. */
export async function sendCompletion(profile: APIConfig, request: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  return sendPreparedCompletion(prepareCompletion(profile, request), signal);
}

export type PreparedCompletion = ReturnType<typeof prepareCompletion>;

/** Raw shared platform transport. No request rewriting, retries or response consumption. */
export async function providerFetch(url:string,init:RequestInit):Promise<Response> {
  const transport = isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : fetch;
  return transport(url,init);
}

/** Send the exact envelope already checked by the Agent/cache boundary, without applying YAML twice. */
export async function sendPreparedCompletion(prepared: PreparedCompletion, signal?: AbortSignal): Promise<Response> {
  signal?.throwIfAborted();
  const started = Date.now();
  let host: string | undefined;
  try { host = new URL(prepared.url).hostname; } catch { /* Preserve transport validation. */ }
  const diagnostic = {event:'model' as const,operation:'request',host,model:typeof prepared.body.model === 'string' ? prepared.body.model : undefined,attempt:1};
  try {
    const response = await providerFetch(prepared.url, {
      method: 'POST', headers: prepared.headers, body: JSON.stringify(prepared.body), signal,
    });
    if (!response.ok) reportDiagnostic({...diagnostic,status:response.status,elapsedMs:Date.now()-started,
      category:response.status === 401 || response.status === 403 ? 'permission' : response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'service' : 'invalid_request'});
    return response;
  } catch (error) {
    if (!signal?.aborted) reportDiagnostic({...diagnostic,category:'network',elapsedMs:Date.now()-started});
    throw error;
  }
}
