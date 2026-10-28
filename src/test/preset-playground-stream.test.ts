import { afterEach, expect, it, vi } from 'vitest';
import { streamPresetPlayground } from '@/lib/preset-playground-stream';

const config = { apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture', model: 'fixture-model' };
const request = { messages: [{ role: 'user', content: 'fixture question' }], temperature: 0.4 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('sends the real provider envelope and consumes split SSE deltas', async () => {
  const encoder = new TextEncoder();
  const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你')); controller.enqueue(encoder.encode('好"}}]}\n\ndata: [DONE]\n\n')); controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetcher); const received = vi.fn();
  expect(await streamPresetPlayground(config, request, new AbortController().signal, received)).toBe('你好');
  expect(received).toHaveBeenCalledWith('你好');
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toMatchObject({ model: 'fixture-model', messages: request.messages, temperature: 0.4, stream: true });
});
it('reports an unfinished stream while preserving emitted text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"半段"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } })));
  const received = vi.fn();
  await expect(streamPresetPlayground(config, request, new AbortController().signal, received)).rejects.toThrow('未完整结束');
  expect(received).toHaveBeenCalledWith('半段');
});
it.each(['complete answer', ''])('finishes a terminal SSE response without waiting for the connection to close (%j)', async text => {
  vi.useFakeTimers();
  const cancelled = vi.fn(), parent = new AbortController(), received = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
      // Compatible servers may leave their SSE connection open after [DONE].
    },
    cancel: cancelled,
  }), { headers: { 'content-type': 'text/event-stream' } })));
  let result: { value: string } | { error: string } | undefined;
  const pending = streamPresetPlayground(config, request, parent.signal, received, { idleTimeoutMs: 100 })
    .then(value => { result = { value }; }, error => { result = { error: error.message }; });
  await vi.advanceTimersByTimeAsync(1);
  try {
    expect(result).toEqual(text ? { value: text } : { error: '回复未完整结束或模型返回空内容，可重试本轮。' });
    expect(cancelled).toHaveBeenCalledOnce();
    if (text) expect(received).toHaveBeenCalledWith(text);
  } finally { parent.abort(); await pending; }
});
it('accepts a non-streaming JSON reply when custom request settings disable streaming', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '完整回复' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher); const received = vi.fn();
  expect(await streamPresetPlayground(config, { ...request, custom_include_body: 'stream: false' }, new AbortController().signal, received)).toBe('完整回复');
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).stream).toBe(false);
  expect(received).toHaveBeenCalledOnce(); expect(received).toHaveBeenCalledWith('完整回复');
});
it('stops even when a transport ignores abort and never reports a late answer', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const controller = new AbortController(), received = vi.fn();
  const pending = streamPresetPlayground(config, request, controller.signal, received);
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const cancelled = vi.fn();
  resolve(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'content-type': 'application/json' } }));
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  expect(received).not.toHaveBeenCalled();
});

it('times out a transport that ignores cancellation before response headers arrive', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const received = vi.fn(), pending = streamPresetPlayground(config, request, new AbortController().signal, received, { idleTimeoutMs: 100 });
  const rejected = expect(pending).rejects.toThrow('未返回数据');
  await vi.advanceTimersByTimeAsync(101);
  await rejected;
  expect(received).not.toHaveBeenCalled();
});

it('reports reasoning, resets the idle timer on received data, and releases a stalled response', async () => {
  vi.useFakeTimers();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder(), cancelled = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { source = controller; }, cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } })));
  const reasoning = vi.fn(), received = vi.fn();
  const pending = streamPresetPlayground(config, request, new AbortController().signal, received, { idleTimeoutMs: 100, onReasoning: reasoning });
  const rejected = expect(pending).rejects.toThrow('未返回数据');
  await vi.advanceTimersByTimeAsync(80);
  source.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'));
  await vi.advanceTimersByTimeAsync(80);
  expect(reasoning).toHaveBeenCalledOnce(); expect(cancelled).not.toHaveBeenCalled();
  source.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
  await vi.advanceTimersByTimeAsync(80);
  expect(received).toHaveBeenCalledWith('partial'); expect(cancelled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(21);
  await rejected;
  expect(cancelled).toHaveBeenCalledOnce();
});
