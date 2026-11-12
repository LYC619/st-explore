// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLLMClient, LLMError, type FetchTransport } from '@/lib/llm';
const config = { apiUrl: 'https://synthetic.invalid/v1/chat/completions', apiKey: 'synthetic-secret-key', model: 'synthetic' };
const messages = [{ role: 'user' as const, content: 'Synthetic request' }];
const json = (content: string, finish = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { headers: { 'Content-Type': 'application/json' } });
const sse = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const capture = <T,>(promise: Promise<T>) => promise.then(value => ({ value, error: undefined }), error => ({ value: undefined, error: error as LLMError }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('unified bounded completion transport', () => {
    it('respects Retry-After and then succeeds without changing the body', async () => {
        vi.useFakeTimers();
        const transport = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } })).mockImplementationOnce(async () => json('ok'));
        const client = createLLMClient({ transport, random: () => 0 });
        const result = capture(client.complete(config, messages));
        await vi.advanceTimersByTimeAsync(1999);
        expect(transport).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect((await result).value?.text).toBe('ok');
        expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
    });
    it('uses at most three retries for service failures and reports four attempts', async () => {
        vi.useFakeTimers();
        const transport = vi.fn(async () => new Response('', { status: 503 }));
        const result = capture(createLLMClient({ transport, random: () => 0 }).complete(config, messages));
        await vi.advanceTimersByTimeAsync(7000);
        expect((await result).error).toMatchObject({ category: 'service', attempts: 4, status: 503 });
        expect(transport).toHaveBeenCalledTimes(4);
    });
    it.each([504, 524])('limits gateway %s to one retry', async (status) => {
        vi.useFakeTimers();
        const transport = vi.fn(async () => new Response('', { status }));
        const result = capture(createLLMClient({ transport, random: () => 0 }).complete(config, messages));
        await vi.advanceTimersByTimeAsync(1000);
        expect((await result).error?.attempts).toBe(2);
        expect(transport).toHaveBeenCalledTimes(2);
    });
    it('does not retry authentication failures or repeat the remote error text', async () => {
        const transport = vi.fn(async () => new Response('Bearer synthetic-secret-key', { status: 401 }));
        const { error } = await capture(createLLMClient({ transport }).complete(config, messages));
        expect(error).toMatchObject({ category: 'permission', attempts: 1, status: 401 });
        expect(error?.message).not.toContain('synthetic-secret-key');
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('times out waiting for the first body byte even when headers arrived', async () => {
        vi.useFakeTimers();
        const transport = vi.fn(async () => new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } }));
        const result = capture(createLLMClient({ transport }).complete(config, messages, { onChunk: () => { }, firstByteMs: 100 }));
        await vi.advanceTimersByTimeAsync(100);
        expect((await result).error).toMatchObject({ category: 'timeout', attempts: 1 });
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('stops an idle stream and returns private partial text without retrying', async () => {
        vi.useFakeTimers();
        const chunks: string[] = [];
        const transport = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(delta('partial synthetic content'))); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
        const result = capture(createLLMClient({ transport }).complete(config, messages, { onChunk: c => chunks.push(c), idleMs: 20 }));
        await vi.advanceTimersByTimeAsync(20);
        const { error } = await result;
        expect(error).toMatchObject({ category: 'interrupted', attempts: 1 });
        expect(error?.partialText).toBe('partial synthetic content');
        expect(JSON.stringify(error)).not.toContain('partial synthetic content');
        expect(chunks).toEqual(['partial synthetic content']);
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('cancels during backoff without exposing the abort reason or sending again', async () => {
        vi.useFakeTimers();
        const transport = vi.fn(async () => new Response('', { status: 503 }));
        const controller = new AbortController();
        const result = capture(createLLMClient({ transport }).complete(config, messages, { signal: controller.signal }));
        await vi.advanceTimersByTimeAsync(0);
        controller.abort('synthetic-secret-key');
        const { error } = await result;
        expect(error).toMatchObject({ category: 'cancelled', name: 'AbortError' });
        expect(error?.message).not.toContain('synthetic-secret-key');
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('treats early stream EOF as interruption and keeps its partial output', async () => {
        const transport = vi.fn(async () => sse(delta('partial')));
        const { error } = await capture(createLLMClient({ transport }).complete(config, messages, { onChunk: () => { } }));
        expect(error?.category).toBe('interrupted');
        expect(error?.partialText).toBe('partial');
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it.each([
        [{ error: { code: 'content_filter', message: 'synthetic-private-response' } }, 'blocked'],
        [{ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }, 'empty'],
        [{ choices: [{ message: { content: null, refusal: 'synthetic-private-response' } }] }, 'blocked'],
    ])('reports embedded errors, empty replies and explicit refusals without retrying', async (body, category) => {
        const transport = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
        const { error } = await capture(createLLMClient({ transport }).complete(config, messages));
        expect(error?.category).toBe(category);
        expect(error?.message).not.toContain('synthetic-private-response');
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('returns truncated body separately from its visible warning marker', async () => {
        const transport = vi.fn(async () => json('partial body', 'length'));
        await expect(createLLMClient({ transport }).complete(config, messages)).resolves.toMatchObject({ text: 'partial body', truncated: true, attempts: 1 });
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('skips malformed SSE lines but refuses a stream with no parseable payload', async () => {
        const client = createLLMClient({ transport: async () => sse('data: broken\n\n' + delta('ok') + done) });
        await expect(client.complete(config, messages, { onChunk: () => { } })).resolves.toMatchObject({ text: 'ok', malformedLines: 1 });
        await expect(createLLMClient({ transport: async () => sse('data: broken\n\n' + done) }).complete(config, messages, { onChunk: () => { } })).rejects.toMatchObject({ category: 'parse' });
    });
    it('bounds non-streaming requests even when a transport ignores cancellation', async () => {
        vi.useFakeTimers();
        const transport = vi.fn(() => new Promise<Response>(() => { }));
        const result = capture(createLLMClient({ transport }).complete(config, messages, { totalMs: 30 }));
        await vi.advanceTimersByTimeAsync(30);
        expect((await result).error?.category).toBe('timeout');
        expect(transport).toHaveBeenCalledTimes(1);
    });
    it('probes once and loads model lists without an empty Authorization header', async () => {
        const failure = vi.fn(async () => new Response('', { status: 503 }));
        await expect(createLLMClient({ transport: failure }).complete(config, messages, { purpose: 'probe' })).rejects.toMatchObject({ attempts: 1 });
        expect(failure).toHaveBeenCalledTimes(1);
        const transport = vi.fn<FetchTransport>(async () => new Response(JSON.stringify({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }, { id: null }] })));
        await expect(createLLMClient({ transport }).models(config.apiUrl, '')).resolves.toEqual(['a', 'z']);
        expect(transport.mock.calls[0][0]).toBe('https://synthetic.invalid/v1/models');
        expect(new Headers(transport.mock.calls[0][1].headers).has('Authorization')).toBe(false);
    });
    it('decodes Unicode split across network chunks and releases the reader at DONE', async () => {
        const cancel = vi.fn();
        const bytes = new TextEncoder().encode(delta('合成回复🙂') + 'data: {"choices":[{"finish_reason":"length"}]}\n\n' + done);
        const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes)
                controller.enqueue(Uint8Array.of(byte)); }, cancel });
        await expect(createLLMClient({ transport: async () => new Response(stream) }).complete(config, messages, { onChunk: () => { } })).resolves.toMatchObject({ text: '合成回复🙂', truncated: true });
        expect(cancel).toHaveBeenCalledOnce();
        expect(stream.locked).toBe(false);
    });
    it('classifies an in-stream safety error after output and keeps partial text local', async () => {
        const transport = vi.fn(async () => sse(delta('partial') + 'data: {"error":{"code":"content_filter","message":"synthetic-secret-key"}}\n\n'));
        const { error } = await capture(createLLMClient({ transport }).complete(config, messages, { onChunk: () => { } }));
        expect(error).toMatchObject({ category: 'blocked', partialText: 'partial' });
        expect(error?.message).not.toContain(config.apiKey);
        expect(transport).toHaveBeenCalledOnce();
    });
    it('cancels a live request without treating the abort reason as a failure', async () => {
        const controller = new AbortController();
        const transport = vi.fn(async () => new Response(new ReadableStream()));
        const result = capture(createLLMClient({ transport }).complete(config, messages, { signal: controller.signal, onChunk: () => { } }));
        controller.abort(config.apiKey);
        expect((await result).error).toMatchObject({ category: 'cancelled' });
        expect(transport).toHaveBeenCalledOnce();
    });
    it('returns an excessive server cooldown instead of retrying early', async () => {
        const transport = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '601' } }));
        await expect(createLLMClient({ transport }).complete(config, messages)).rejects.toMatchObject({ category: 'rate_limit', attempts: 1, retryAfterMs: 601000 });
        expect(transport).toHaveBeenCalledOnce();
    });
    it('bounds model-list requests with the short probe timeout and no retries', async () => {
        vi.useFakeTimers();
        const transport = vi.fn(() => new Promise<Response>(() => { }));
        const result = capture(createLLMClient({ transport }).models(config.apiUrl, config.apiKey));
        await vi.advanceTimersByTimeAsync(30000);
        expect((await result).error).toMatchObject({ category: 'timeout', attempts: 1 });
        expect(transport).toHaveBeenCalledOnce();
    });
});
