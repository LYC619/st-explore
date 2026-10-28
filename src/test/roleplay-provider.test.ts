// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sendCompletion } from '@/lib/roleplay/provider';

let server: Server;
let url: string;
let received: { path?: string; authorization?: string; body: Record<string, unknown> };
beforeAll(async () => {
  server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk.toString();
    received = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(text) };
    if (request.url === '/fail') {
      response.writeHead(429, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: '限流，请稍后再试' } }));
    } else if (received.body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"雨夜"}}]}\n\n');
      response.end('data: {"choices":[],"usage":{"prompt_tokens":23,"prompt_tokens_details":{"cached_tokens":16}}}\n\ndata: [DONE]\n\n');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '请进' }, finish_reason: 'stop' }] }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); });

describe('shared profile completion transport', () => {
  it('accepts a legacy empty exclusion object as no exclusions', async () => {
    await sendCompletion({ apiUrl: url, apiKey: '', model: 'chosen' }, { messages: [], temperature: 0.7, custom_exclude_body: '{}' });
    expect(received.body.temperature).toBe(0.7);
    await expect(sendCompletion({ apiUrl: url, apiKey: '', model: 'chosen' }, { messages: [], custom_exclude_body: 'temperature: true' })).rejects.toThrow('字段名列表');
  });
  it('uses the exact configured endpoint and profile identity while preserving ST messages and sampling', async () => {
    const messages = [{ role: 'system', content: '扮演' }, { role: 'user', content: '开门' }];
    const response = await sendCompletion({ apiUrl: `${url}/custom/completion?version=1`, apiKey: 'fixture-key', model: 'profile-model' }, {
      model: 'stale-model', messages, temperature: 0.6, max_tokens: 120,
      custom_url: 'https://wrong.invalid', proxy_password: 'must-not-leak', chat_completion_source: 'custom', user_name: '旅人', type: 'normal',
    });
    expect(response.ok).toBe(true);
    expect(received.path).toBe('/custom/completion?version=1');
    expect(received.authorization).toBe('Bearer fixture-key');
    expect(received.body).toEqual({ model: 'profile-model', messages, temperature: 0.6, max_tokens: 120 });
  });

  it('preserves tool messages and tool arguments without placing tool traces in any separate credentials store', async () => {
    const messages = [{ role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_memory', arguments: '{"query":"雨夜"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: '事件原文' }];
    await sendCompletion({ apiUrl: `${url}/tools`, apiKey: '', model: 'tool-model' }, { messages, tools: [{ type: 'function', function: { name: 'read_memory', parameters: { type: 'object' } } }], tool_choice: 'auto' });
    expect(received.body.messages).toEqual(messages);
    expect(received.body.tool_choice).toBe('auto');
    expect(received.authorization).toBeUndefined();
  });

  it('passes the actual SSE and provider usage through to the original ST streaming processor', async () => {
    const response = await sendCompletion({ apiUrl: `${url}/stream`, apiKey: '', model: 'model' }, {
      messages: [{ role: 'user', content: '开门' }], stream: true, stream_options: { include_usage: true },
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream).toContain('雨夜');
    expect(stream).toContain('"cached_tokens":16');
    expect(stream).toContain('[DONE]');
  });

  it('preserves HTTP failure status and honors cancellation before starting a request', async () => {
    const profile = { apiUrl: `${url}/fail`, apiKey: '', model: 'model' };
    const response = await sendCompletion(profile, { messages: [] });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { message: '限流，请稍后再试' } });
    const controller = new AbortController(); controller.abort();
    await expect(sendCompletion(profile, { messages: [] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('applies custom YAML body changes before sending the actual provider request', async () => {
    await sendCompletion({ apiUrl: url + '/custom', apiKey: '', model: 'chosen' }, {
      messages: [{ role: 'user', content: '开门' }], temperature: 0.7, max_tokens: 50,
      custom_include_body: 'top_k: 40\nprovider_option:\n  enabled: true\nmodel: ignored',
      custom_exclude_body: '- temperature',
    });
    expect(received.body).toEqual({ model: 'chosen', messages: [{ role: 'user', content: '开门' }], max_tokens: 50,
      top_k: 40, provider_option: { enabled: true } });
  });

  it('rejects unsupported configured transformations instead of silently sending a different prompt', async () => {
    const profile = { apiUrl: url + '/custom', apiKey: '', model: 'chosen' };
    await sendCompletion(profile, { messages: [], custom_prompt_post_processing: 'strict' });
    expect(received.body.messages).toEqual([{ role: 'user', content: "Let's get started." }]);
    await expect(sendCompletion(profile, { messages: [], custom_include_body: '[broken' })).rejects.toThrow('YAML');
    await expect(sendCompletion(profile, { messages: [], custom_include_headers: 'Authorization: other-key' })).rejects.toThrow('连接配置');
  });
});
