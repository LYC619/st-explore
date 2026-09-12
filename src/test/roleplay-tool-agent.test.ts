import { afterEach, expect, it, vi } from 'vitest';
import { runToolAgent } from '@/lib/roleplay/tool-agent';
import type { ChatSession } from '@/types/chat';

afterEach(() => vi.unstubAllGlobals());
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

it('honors cancellation before any tool model request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(runToolAgent({ phase: 'context', profile, session, resources: [], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
