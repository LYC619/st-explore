// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anthropicAdapter,
  createLLMClient,
  detectProviderProtocol,
  geminiAdapter,
  LLMError,
  openaiAdapter,
  resolveProviderAdapter,
  type FetchTransport,
} from '@/lib/llm';
import { prepareCompletion } from '@/lib/roleplay/provider';
import { isApiProfileConfigured } from '@/components/ai-tools/api-profiles';

const messages = [
  { role: 'system' as const, content: '你是本地测试助手' },
  { role: 'user' as const, content: '合成测试问题' },
];

const sampleSchema = {
  name: 'story_summary',
  strict: true,
  schema: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
};

const capture = <T,>(promise: Promise<T>) =>
  promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error: error as LLMError }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProviderAdapter protocol detection & resolution', () => {
  it('auto-detects OpenAI, Anthropic, Gemini, and honors explicit protocol override', () => {
    expect(detectProviderProtocol({ apiUrl: 'https://api.openai.com/v1/chat/completions' })).toBe('openai');
    expect(detectProviderProtocol({ apiUrl: 'http://127.0.0.1:11434/v1/chat/completions' })).toBe('openai');
    expect(detectProviderProtocol({ apiUrl: 'https://api.anthropic.com/v1/messages' })).toBe('anthropic');
    expect(detectProviderProtocol({ apiUrl: 'https://proxy.invalid/v1/messages' })).toBe('anthropic');
    expect(detectProviderProtocol({ apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models' })).toBe('gemini');
    expect(detectProviderProtocol({ apiUrl: 'https://proxy.invalid/v1beta/models/gemini-2.5-flash:generateContent' })).toBe('gemini');
    expect(resolveProviderAdapter({ apiUrl: 'https://proxy.invalid/custom', protocol: 'anthropic' })).toBe(anthropicAdapter);
    expect(resolveProviderAdapter({ apiUrl: 'https://proxy.invalid/custom', protocol: 'gemini' })).toBe(geminiAdapter);
    expect(resolveProviderAdapter({ apiUrl: 'https://proxy.invalid/custom', protocol: 'openai' })).toBe(openaiAdapter);
  });

  it('requires API key for official OpenAI/Anthropic/Gemini hosts while allowing keyless local Ollama', () => {
    expect(isApiProfileConfigured({ id: '1', name: 'Ollama', apiUrl: 'http://127.0.0.1:11434/v1/chat/completions', apiKey: '', model: 'llama3' })).toBe(true);
    expect(isApiProfileConfigured({ id: '2', name: 'Anthropic', apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: '', model: 'claude-sonnet-4-5' })).toBe(false);
    expect(isApiProfileConfigured({ id: '3', name: 'Gemini', apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: '', model: 'gemini-2.5-flash' })).toBe(false);
    expect(isApiProfileConfigured({ id: '4', name: 'Anthropic Keyed', apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'sk-ant-synthetic', model: 'claude-sonnet-4-5' })).toBe(true);
  });
});

describe('OpenAI & Ollama adapter contract', () => {
  it('supports keyless Ollama requests and structured JSON schema output', async () => {
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"雨夜"}' }, finish_reason: 'stop' }] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createLLMClient({ transport });
    const result = await client.complete(
      { apiUrl: 'http://127.0.0.1:11434/v1/chat/completions', apiKey: '', model: 'qwen2.5' },
      messages,
      { responseSchema: sampleSchema },
    );
    expect(result).toMatchObject({ text: '{"title":"雨夜"}', truncated: false, attempts: 1 });
    const [, init] = transport.mock.calls[0];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(init.body)).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'story_summary', strict: true, schema: sampleSchema.schema },
    });
  });
});

describe('Anthropic Messages native adapter contract', () => {
  const config = {
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk-ant-synthetic-secret',
    model: 'claude-sonnet-4-5',
  };

  it('sends native headers, extracts system prompt, supports structured output, and parses JSON reply', async () => {
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '{"title":"合成标题"}' }],
        stop_reason: 'end_turn',
      }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await createLLMClient({ transport }).complete(config, messages, {
      params: { temperature: 0.3, max_tokens: 512 },
      responseSchema: sampleSchema,
    });
    expect(result).toMatchObject({ text: '{"title":"合成标题"}', truncated: false, attempts: 1 });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(config.apiUrl);
    const headers = new Headers(init.headers);
    expect(headers.get('x-api-key')).toBe(config.apiKey);
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.has('Authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({
      model: config.model,
      max_tokens: 512,
      system: '你是本地测试助手',
      messages: [{ role: 'user', content: '合成测试问题' }],
      temperature: 0.3,
      output_config: { format: { type: 'json_schema', schema: sampleSchema.schema } },
    });
  });

  it('parses Anthropic native SSE stream and reports max_tokens truncation', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"第一段"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"第二段"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const chunks: string[] = [];
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const result = await createLLMClient({ transport }).complete(config, messages, {
      onChunk: chunk => chunks.push(chunk),
    });
    expect(chunks).toEqual(['第一段', '第二段']);
    expect(result).toMatchObject({ text: '第一段第二段', truncated: true, attempts: 1 });
  });

  it('handles Anthropic retry, timeout, empty reply, refusal, and auth error without leaking secrets', async () => {
    vi.useFakeTimers();
    const retryTransport = vi.fn<FetchTransport>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), { status: 529 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: '重试成功' }], stop_reason: 'end_turn' }), { headers: { 'Content-Type': 'application/json' } }));
    const retried = capture(createLLMClient({ transport: retryTransport, random: () => 0 }).complete(config, messages));
    await vi.advanceTimersByTimeAsync(1500);
    expect((await retried).value).toMatchObject({ text: '重试成功', attempts: 2 });

    const timeoutTransport = vi.fn<FetchTransport>(() => new Promise(() => {}));
    const timedOut = capture(createLLMClient({ transport: timeoutTransport }).complete(config, messages, { totalMs: 50 }));
    await vi.advanceTimersByTimeAsync(60);
    expect((await timedOut).error).toMatchObject({ category: 'timeout', attempts: 1 });

    const emptyTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: '   ' }], stop_reason: 'end_turn' }), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(createLLMClient({ transport: emptyTransport }).complete(config, messages)).rejects.toMatchObject({ category: 'empty', attempts: 1 });

    const refusalTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(createLLMClient({ transport: refusalTransport }).complete(config, messages)).rejects.toMatchObject({ category: 'blocked', attempts: 1 });

    const authTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: config.apiKey } }), { status: 401 }),
    );
    const authResult = await capture(createLLMClient({ transport: authTransport }).complete(config, messages));
    expect(authResult.error).toMatchObject({ category: 'permission', status: 401, attempts: 1 });
    expect(authResult.error?.message).not.toContain(config.apiKey);
  });

  it('lists Anthropic models using x-api-key and anthropic-version headers', async () => {
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-haiku-4-5' }] }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const list = await createLLMClient({ transport }).models(config.apiUrl, config.apiKey);
    expect(list).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-5']);
    expect(transport.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models');
    expect(new Headers(transport.mock.calls[0][1].headers).get('x-api-key')).toBe(config.apiKey);
  });
});

describe('Google Gemini native adapter contract', () => {
  const config = {
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    apiKey: 'AIza-synthetic-secret-key',
    model: 'gemini-2.5-flash',
  };

  it('sends x-goog-api-key header (never query key), maps roles/systemInstruction/schema, and parses JSON reply', async () => {
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"title":"星光"}' }] }, finishReason: 'STOP' }],
      }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const result = await createLLMClient({ transport }).complete(config, [
      ...messages,
      { role: 'assistant', content: '上一轮回答' },
      { role: 'user', content: '下一轮提问' },
    ], {
      params: { temperature: 0.4, top_p: 0.9, max_tokens: 256 },
      responseSchema: sampleSchema,
    });
    expect(result).toMatchObject({ text: '{"title":"星光"}', truncated: false, attempts: 1 });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(url).not.toContain(config.apiKey);
    expect(url).not.toContain('key=');
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe(config.apiKey);
    expect(JSON.parse(String(init.body))).toEqual({
      systemInstruction: { parts: [{ text: '你是本地测试助手' }] },
      contents: [
        { role: 'user', parts: [{ text: '合成测试问题' }] },
        { role: 'model', parts: [{ text: '上一轮回答' }] },
        { role: 'user', parts: [{ text: '下一轮提问' }] },
      ],
      generationConfig: {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        responseSchema: sampleSchema.schema,
      },
    });
  });

  it('streams Gemini SSE via :streamGenerateContent?alt=sse and detects MAX_TOKENS truncation', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"半句"}]}}]}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":"收尾"}]},"finishReason":"MAX_TOKENS"}]}',
      '',
    ].join('\n');
    const chunks: string[] = [];
    const transport = vi.fn<FetchTransport>(async () =>
      new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const result = await createLLMClient({ transport }).complete(config, messages, {
      onChunk: chunk => chunks.push(chunk),
    });
    expect(transport.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(chunks).toEqual(['半句', '收尾']);
    expect(result).toMatchObject({ text: '半句收尾', truncated: true, attempts: 1 });
  });

  it('handles Gemini retry, timeout, empty reply, safety block, and models catalog without leaking secrets', async () => {
    vi.useFakeTimers();
    const retryTransport = vi.fn<FetchTransport>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '恢复' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } }));
    const retried = capture(createLLMClient({ transport: retryTransport, random: () => 0 }).complete(config, messages));
    await vi.advanceTimersByTimeAsync(1100);
    expect((await retried).value).toMatchObject({ text: '恢复', attempts: 2 });

    const timeoutTransport = vi.fn<FetchTransport>(() => new Promise(() => {}));
    const timedOut = capture(createLLMClient({ transport: timeoutTransport }).complete(config, messages, { totalMs: 40 }));
    await vi.advanceTimersByTimeAsync(50);
    expect((await timedOut).error).toMatchObject({ category: 'timeout', attempts: 1 });

    const emptyTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(createLLMClient({ transport: emptyTransport }).complete(config, messages)).rejects.toMatchObject({ category: 'empty', attempts: 1 });

    const blockedTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(createLLMClient({ transport: blockedTransport }).complete(config, messages)).rejects.toMatchObject({ category: 'blocked', attempts: 1 });

    const embeddedErrorTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: config.apiKey } }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const errRes = await capture(createLLMClient({ transport: embeddedErrorTransport }).complete(config, messages));
    expect(errRes.error).toMatchObject({ category: 'permission', attempts: 1 });
    expect(errRes.error?.message).not.toContain(config.apiKey);

    const modelsTransport = vi.fn<FetchTransport>(async () =>
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }] }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const list = await createLLMClient({ transport: modelsTransport }).models(config.apiUrl, config.apiKey);
    expect(list).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(modelsTransport.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(new Headers(modelsTransport.mock.calls[0][1].headers).get('x-goog-api-key')).toBe(config.apiKey);
  });
});

describe('roleplay prepareCompletion multi-protocol envelope integration', () => {
  it('prepares native Anthropic and Gemini envelopes through the shared ProviderAdapter', () => {
    const ant = prepareCompletion(
      { apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'ant-key', model: 'claude-sonnet-4-5' },
      { messages, temperature: 0.5, max_tokens: 300, stream: true, json_schema: { name: 's', value: sampleSchema.schema } },
    );
    expect(ant.headers['x-api-key']).toBe('ant-key');
    expect(ant.headers['anthropic-version']).toBe('2023-06-01');
    expect(ant.body).toMatchObject({ model: 'claude-sonnet-4-5', max_tokens: 300, system: '你是本地测试助手', stream: true });

    const gem = prepareCompletion(
      { apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: 'gem-key', model: 'gemini-2.5-flash' },
      { messages, temperature: 0.5, max_tokens: 300, stream: true, json_schema: { name: 's', value: sampleSchema.schema } },
    );
    expect(gem.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
    expect(gem.url).not.toContain('gem-key');
    expect(gem.headers['x-goog-api-key']).toBe('gem-key');
    expect(gem.body).toMatchObject({
      systemInstruction: { parts: [{ text: '你是本地测试助手' }] },
      generationConfig: { temperature: 0.5, maxOutputTokens: 300, responseMimeType: 'application/json' },
    });
  });
});
