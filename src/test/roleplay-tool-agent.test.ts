import { afterEach, expect, it, vi } from 'vitest';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { runToolAgent } from '@/lib/roleplay/tool-agent';
import type { ChatSession } from '@/types/chat';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const session: ChatSession = { id: 's', title: '书店', createdAt: 1, user: { name: '旅人' }, character: { name: '林' },
  messages: Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' as const : 'user' as const, content: i === 0 ? 'ONLY_IN_OLD_HISTORY' : `本轮消息${i}` })) };
const profile = { model: 'tools', apiUrl: 'https://tools.invalid/full-endpoint', apiKey: '' };
function calls(name: string, args: unknown, id = 'c') {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }), { headers: { 'Content-Type': 'application/json' } });
}

it('automatically searches then reads original lore and submits only verified excerpts to the writer', async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) return calls('search_sources', { query: '北门', kind: 'worldbook' });
    if (requests.length === 2) return calls('read_source', { id: 'world:1', offset: 0 });
    return calls('submit_context', { references: ['r1'], reminders: ['保持第三人称，不替旅人作决定。'] });
  }));
  const result = await runToolAgent({ phase: 'context', profile, session,
    resources: [{ id: 'world:1', kind: 'worldbook', label: '书店北门', keywords: ['北门'], content: '北门只能从里侧打开。' }] });
  expect(requests).toHaveLength(3);
  expect(JSON.stringify(requests[0])).not.toContain('ONLY_IN_OLD_HISTORY');
  expect(result.supplement).toContain('北门只能从里侧打开。');
  expect(result.supplement).toContain('叙事建议');
  expect(result.supplement).not.toContain('tool_calls');
  expect(result.references).toMatchObject([{ resourceId: 'world:1', text: '北门只能从里侧打开。' }]);
});

it('does not let a model invent unread sources or run endlessly', async () => {
  const fetcher = vi.fn(async () => calls('submit_context', { references: ['invented'], reminders: [] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(runToolAgent({ phase: 'context', profile, session, resources: [], maxRounds: 3 })).rejects.toThrow(/工具|资料/);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
});

it('requires reading an existing memory before proposing its replacement and preserves its version token', async () => {
  let n = 0;
  vi.stubGlobal('fetch', vi.fn(async () => ++n === 1 ? calls('read_source', { id: 'memory:state.md', offset: 0 })
    : calls('submit_memory', { changes: [{ path: 'state.md', body: '屋内。\n已发生：旅人进门。' }], worldbookVersions: [] })));
  const result = await runToolAgent({ phase: 'memory', profile, session,
    resources: [{ id: 'memory:state.md', kind: 'memory', label: 'state.md', content: '门外', digest: 'a'.repeat(64), owner: 'agent' }] });
  expect(result.changes).toEqual([{ path: 'state.md', body: '屋内。\n已发生：旅人进门。', expectedDigest: 'a'.repeat(64) }]);
});

it.each([
  `A${'龘'.repeat(1201)}${'🧭'.repeat(101)}终`,
  `A${'🧭'.repeat(1201)}${'龘'.repeat(101)}终`,
])('pages multibyte source text as exact contiguous original substrings within the token budget (case %#)', async content => {
  const resource = { id: 'world:unicode', kind: 'worldbook' as const, label: '原文', content };
  const excerpts: { offset: number; text: string; nextOffset: number | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const request = JSON.parse(options.body);
    const observation = request.messages.filter((message: { role: string }) => message.role === 'tool').at(-1);
    if (!observation) return calls('read_source', { id: resource.id, offset: 0 });
    const excerpt = JSON.parse(observation.content);
    excerpts.push(excerpt);
    return excerpt.nextOffset === null
      ? calls('submit_context', { references: [], reminders: [] })
      : calls('read_source', { id: resource.id, offset: excerpt.nextOffset });
  }));

  await runToolAgent({ phase: 'context', profile, session: { ...session, messages: [] }, resources: [resource] });

  expect(excerpts.length).toBeGreaterThan(1);
  let offset = 0;
  for (const excerpt of excerpts) {
    expect(excerpt.offset).toBe(offset);
    expect(excerpt.text).not.toContain('\uFFFD');
    expect(excerpt.text).toBe(content.slice(offset, offset + excerpt.text.length));
    expect(excerpt.text.length).toBeGreaterThan(0);
    expect(encode(excerpt.text).length).toBeLessThanOrEqual(1200);
    expect([...excerpt.text].every(char => !(char.length === 1 && /[\uD800-\uDFFF]/u.test(char)))).toBe(true);
    offset += excerpt.text.length;
    expect(excerpt.nextOffset).toBe(offset < content.length ? offset : null);
  }
  expect(excerpts.map(excerpt => excerpt.text).join('')).toBe(content);
  expect(resource.content).toBe(content);
});

it('honors cancellation before any tool model request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(runToolAgent({ phase: 'context', profile, session, resources: [], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['request', 'body'])('bounds a stalled tool %s even if transport ignores cancellation', async phase => {
  vi.useFakeTimers();
  let transportSignal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, options) => {
    transportSignal = options.signal;
    return phase === 'request' ? new Promise(() => {})
      : Promise.resolve(new Response(new ReadableStream({ start() {} })));
  }));
  const outcome = runToolAgent({ phase: 'context', profile, session, resources: [] })
    .then(() => 'succeeded', error => error);
  await vi.advanceTimersByTimeAsync(120_001);
  expect(await Promise.race([outcome, Promise.resolve('pending')])).toMatchObject({ name: 'TimeoutError' });
  expect(transportSignal?.aborted).toBe(true);
});

it('cancels an in-flight tool response and releases its deadline', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }))));
  const controller = new AbortController();
  const outcome = runToolAgent({ phase: 'context', profile, session, resources: [], signal: controller.signal })
    .then(() => 'succeeded', error => error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(await Promise.race([outcome, Promise.resolve('pending')])).toMatchObject({ name: 'AbortError' });
  expect(vi.getTimerCount()).toBe(0);
});
