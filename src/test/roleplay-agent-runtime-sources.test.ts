import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRuntime } from '@/lib/roleplay/agent-runtime';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { prepareCompletion } from '@/lib/roleplay/provider';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { sourceRefs } from '@/lib/roleplay/fingerprint';

afterEach(() => { setActiveVault(null); vi.unstubAllGlobals(); });

async function fixture() {
  setActiveVault(createVault(createMemFs()));
  const story = buildStoryFromSession({ id: 's', title: '故事', createdAt: 1, user: { name: '我' }, character: { name: '林' },
    messages: [{ id: 'u', role: 'user', content: '开门' }] });
  await saveArchiveStory(story);
  const runtime = createAgentRuntime({ storyId: story.id, branchId: null, store: createRuntimeStore(story.id),
    stories: getCurrentRepo<ArchiveStory>('archiveStories'), toolProfile: () => ({ model: 'tool', apiUrl: 'https://tool.invalid', apiKey: '' }),
    worldResources: async () => [], isCurrent: () => true });
  await runtime.configure({ mode: 'agent', memoryOwner: 'native-agent' });
  const memoryRequests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    let name = request.tools.at(-1).function.name;
    let args: unknown = { references: [], reminders: [] };
    if (name === 'submit_memory') {
      memoryRequests.push(JSON.stringify(request));
      const input = JSON.parse(request.messages[1].content);
      if (input.availableIndex.includes('memory:state.md') && !request.messages.some((message: { role: string }) => message.role === 'tool')) {
        name = 'read_source'; args = { id: 'memory:state.md', offset: 0 };
      } else {
        args = { changes: [{ path: 'state.md', body: input.recentMessages.at(-1).content }], worldbookVersions: [] };
      }
    }
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call', type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] } }] }));
  }));
  const prepared = prepareCompletion({ model: 'main', apiUrl: 'https://main.invalid', apiKey: '' }, { messages: [{ role: 'user', content: '开门' }] });
  async function completed(id: string, content: string): Promise<ChatSession> {
    const turn = await runtime.prepare(prepared, story.session, []);
    await runtime.finish(turn.turnId, { status: 'succeeded', content });
    return { ...story.session, messages: [...story.session.messages, { id, role: 'assistant', content,
      rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: `candidate:${turn.turnId}` } } } }] };
  }
  async function adopt(session: ChatSession) {
    await updateArchiveStory(story.id, () => ({ session }));
    await runtime.afterCommit({ storyId: story.id, branchId: null, previous: story.session, session });
    await runtime.flush();
  }
  return { story, runtime, completed, adopt, memoryRequests };
}

it('rebuilds an existing memory after its original source message is deleted', async () => {
  const f = await fixture();
  await f.adopt(await f.completed('a1', '旧剧情：门已打开。'));
  await updateArchiveStory(f.story.id, () => ({ session: f.story.session }));
  expect((await f.runtime.memory.read('state.md'))?.status).toBe('invalidated');

  f.memoryRequests.length = 0;
  await f.adopt(await f.completed('a2', '新剧情：门仍然紧闭。'));

  expect(await f.runtime.memory.read('state.md')).toMatchObject({ body: '新剧情：门仍然紧闭。', status: 'active', revision: 2,
    sourceRefs: [expect.objectContaining({ messageId: 'a2' })] });
  expect(f.memoryRequests.join('\n')).toContain('旧剧情：门已打开。');
  expect(f.runtime.status().phase).toBe('idle');
});

it.each([false, true])('excludes memory sourced after the recovered reply even when invalidated=%s', async invalidated => {
  const f = await fixture();
  const completed = await f.completed('a1', '本轮已完成剧情');
  const later: ChatSession = { ...completed, messages: [...completed.messages,
    { id: 'later', role: 'assistant', content: '后续回复' }] };
  await updateArchiveStory(f.story.id, () => ({ session: later }));
  await f.runtime.memory.commit({ operationId: 'future-memory', sourceRefs: [sourceRefs(later).at(-1)!],
    changes: [{ path: 'future.md', body: 'FUTURE_MEMORY_MUST_NOT_LEAK', expectedDigest: null }] });
  if (invalidated) {
    await updateArchiveStory(f.story.id, () => ({ session: { ...later, messages: later.messages.map(message =>
      message.id === 'later' ? { ...message, content: '已修改后续回复' } : message) } }));
  }

  await f.runtime.resume(true); await f.runtime.flush();

  expect(f.memoryRequests).not.toHaveLength(0);
  expect(f.memoryRequests.join('\n')).not.toContain('future.md');
  expect(f.memoryRequests.join('\n')).not.toContain('FUTURE_MEMORY_MUST_NOT_LEAK');
  expect((await f.runtime.memory.read('state.md'))?.body).toBe('本轮已完成剧情');
});
