import { expect, it, vi } from 'vitest';
import { monitorCompletion } from '@/lib/roleplay/completion-monitor';

it('observes complete streamed tool output without changing bytes consumed by preset extensions', async () => {
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'game_content', arguments: '{"content":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"完成"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  const text = events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n';
  const finished = vi.fn();
  expect(await monitorCompletion(new Response(text), { stream: true, onFinish: finished }).text()).toBe(text);
  expect(finished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'succeeded', content: '', finishReason: 'tool_calls',
    toolCalls: [{ name: 'game_content', arguments: '{"content":"完成"}' }] }));
});

it('accepts nonstreaming tool results but rejects incomplete tool arguments or missing terminal status', async () => {
  for (const [args, finishReason, status] of [['{}', 'tool_calls', 'succeeded'], ['{', 'tool_calls', 'failed'], ['{}', null, 'failed'], ['{}', 'content_filter', 'failed']] as const) {
    const finished = vi.fn();
    const text = JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'example', arguments: args } }] }, finish_reason: finishReason }] });
    expect(await monitorCompletion(new Response(text), { stream: false, onFinish: finished }).text()).toBe(text);
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status }));
  }
});

it('passes exact SSE bytes and reports success/actual cache usage before releasing the completion marker', async () => {
  const text = 'data: {"choices":[{"delta":{"content":"屋内"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":40,"prompt_tokens_details":{"cached_tokens":32}}}\n\ndata: [DONE]\n\n';
  const onFinish = vi.fn();
  const monitored = monitorCompletion(new Response(text, { headers: { 'Content-Type': 'text/event-stream' } }), { onFinish });
  expect(await monitored.text()).toBe(text);
  expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', content: '屋内', usage: { prompt_tokens: 40, prompt_tokens_details: { cached_tokens: 32 } } }));
  expect(onFinish).toHaveBeenCalledOnce();
});

it('does not treat an unexpectedly closed or cancelled stream as a factual reply', async () => {
  const onFinish = vi.fn();
  await monitorCompletion(new Response('data: {"choices":[{"delta":{"content":"没写完"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), { onFinish }).text();
  expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  const controller = new AbortController(), onCancel = vi.fn();
  const response = monitorCompletion(new Response(new ReadableStream()), { signal: controller.signal, onFinish: onCancel });
  const reading = response.text(); controller.abort();
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
});

it('recognizes a completed nonstreaming reply and rejects provider filtering errors', async () => {
  const success = vi.fn(), failure = vi.fn();
  await monitorCompletion(new Response(JSON.stringify({ choices: [{ message: { content: '已完成' }, finish_reason: 'stop' }] })), { onFinish: success }).text();
  await monitorCompletion(new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })), { onFinish: failure }).text();
  expect(success).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  expect(failure).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
});

it('revokes provisional success when stopped while the completion receipt is still being saved', async () => {
  let unlock!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const controller = new AbortController();
  const states: string[] = [];
  const response = monitorCompletion(new Response('data: {"choices":[{"delta":{"content":"尚未释放的完整回复"}}]}\n\ndata: [DONE]\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } }), {
    signal: controller.signal, onFinish: async outcome => { states.push(outcome.status); if (outcome.status === 'succeeded') { reached(); await gate; } },
  });
  const reading = response.text();
  await entered; controller.abort(); unlock();
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  expect(states.at(-1)).toBe('cancelled');
});

it('does not prefetch and adopt a terminal block before the renderer requests it', async () => {
  const encoder = new TextEncoder();
  const chunks = ['data: {"choices":[{"delta":{"content":"已显示的半截"}}]}\n\n', 'data: [DONE]\n\n'];
  const upstream = new ReadableStream<Uint8Array>({
    pull(output) { output.enqueue(encoder.encode(chunks.shift()!)); if (!chunks.length) output.close(); },
  });
  const controller = new AbortController(), onFinish = vi.fn();
  const response = monitorCompletion(new Response(upstream, { headers: { 'Content-Type': 'text/event-stream' } }), {
    signal: controller.signal, onFinish,
  });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('已显示的半截');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(onFinish).not.toHaveBeenCalled();
  controller.abort();
  await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  expect(onFinish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'cancelled', content: '已显示的半截' }));
});
