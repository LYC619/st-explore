import { afterEach, expect, it, vi } from 'vitest';
import { streamPresetPlayground } from '@/lib/preset-playground-stream';

const config = { apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture', model: 'fixture-model' };
const request = { messages: [{ role: 'user', content: 'fixture question' }], temperature: 0.4 };
afterEach(() => vi.unstubAllGlobals());
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
