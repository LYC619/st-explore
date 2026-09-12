import { afterEach, expect, it, vi } from 'vitest';
import { createAgentRuntime } from '@/lib/roleplay/agent-runtime';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import type { ArchiveStory } from '@/types/archive';
import { prepareCompletion } from '@/lib/roleplay/provider';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';

afterEach(() => { setActiveVault(null); vi.unstubAllGlobals(); });
async function fixture() {
  setActiveVault(createVault(createMemFs()));
  const story = buildStoryFromSession({ id: 's', title: '故事', createdAt: 1, user: { name: '我' }, character: { name: '林' },
    messages: [{ id: 'u', role: 'user', content: '开门' }] });
  await saveArchiveStory(story);
  const store = createRuntimeStore(story.id);
  const runtime = createAgentRuntime({ storyId: story.id, branchId: null, store,
    stories: getCurrentRepo<ArchiveStory>('archiveStories'), toolProfile: () => ({ model: 'tool', apiUrl: 'https://tool.invalid', apiKey: '' }),
    worldResources: async () => [], isCurrent: () => true });
  await runtime.configure({ mode: 'agent', memoryOwner: 'native-agent' });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body);
    const name = request.tools.at(-1).function.name;
    const args = name === 'submit_context' ? { references: [], reminders: [] }
      : { changes: [{ path: 'state.md', body: '事实：门已打开。\n地点：书店。' }], worldbookVersions: [] };
    return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }));
  }));
  const prepared = prepareCompletion({ model: 'main', apiUrl: 'https://main.invalid', apiKey: '' }, { messages: [{ role: 'user', content: '开门' }] });
  return { story, store, runtime, prepared };
}

it('runs memory only after a successful matched candidate is actually persisted and keeps the next turn behind that barrier', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'succeeded', content: '门已打开。' });
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '门已打开。',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } }] };
  const commit = { storyId: f.story.id, branchId: null, previous: f.story.session, session };
  await f.runtime.afterCommit(commit);
  await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toBeNull();
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.afterCommit(commit);
  await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toContain('门已打开');
  expect(f.runtime.status().phase).toBe('idle');
});

it('never writes factual memory for a cancelled or no-longer-adopted candidate', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'cancelled', content: '半截' });
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '半截',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } }] };
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.afterCommit({ storyId: f.story.id, branchId: null, previous: f.story.session, session });
  await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toBeNull();
});

it('enforces one automatic memory owner per branch', async () => {
  const f = await fixture();
  await expect(f.runtime.configure({ mode: 'agent', memoryOwner: 'baibai' })).rejects.toThrow(/维护/);
  await f.runtime.configure({ mode: 'classic', memoryOwner: 'baibai' });
  expect(await f.runtime.configuration()).toEqual({ mode: 'classic', memoryOwner: 'baibai' });
});

it('does not adopt edited text carrying a prior completion identity', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'succeeded', content: '门已打开。' });
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '门从未打开。',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } }] };
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.resume(true); await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toBeNull();
});

it('limits recovered maintenance to the completed candidate even when a cancelled tail is saved later', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'succeeded', content: '门已打开。' });
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '门已打开。',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } },
    { id: 'u2', role: 'user' as const, content: '这个后续请求不是已完成剧情' }, { id: 'partial', role: 'assistant' as const, content: '取消尾部不得出现在维护输入' }] };
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.resume(true); await f.runtime.flush();
  const maintenance = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)))
    .find(request => request.tools.at(-1).function.name === 'submit_memory');
  expect(maintenance).toBeDefined();
  expect(JSON.stringify(maintenance)).not.toContain('取消尾部不得');
  expect(JSON.stringify(maintenance)).not.toContain('这个后续请求');
});

it('keeps a valid canonical receipt usable after rejecting a second registration', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'succeeded', content: '  门已打开。  ' });
  await f.runtime.confirmCandidate(turn.turnId, { messageId: 'a', candidateId: 'a:main', content: '门已打开。' });
  await expect(f.runtime.confirmCandidate(turn.turnId, { messageId: 'a', candidateId: 'a:main', content: '后来编辑' })).rejects.toThrow(/已登记/);
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '门已打开。',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } }] };
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.afterCommit({ storyId: f.story.id, branchId: null, previous: f.story.session, session });
  await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toContain('门已打开');
  expect(f.runtime.status().phase).toBe('idle');
});

it('accepts the original renderer canonical text once, then refuses a later edit or cancelled completion', async () => {
  const f = await fixture();
  const turn = await f.runtime.prepare(f.prepared, f.story.session, []);
  await f.runtime.finish(turn.turnId, { status: 'succeeded', content: '  门已打开。  ' });
  await f.runtime.confirmCandidate(turn.turnId, { messageId: 'a', candidateId: 'a:main', content: '门已打开。' });
  await expect(f.runtime.confirmCandidate(turn.turnId, { messageId: 'a', candidateId: 'a:main', content: '后来编辑' })).rejects.toThrow(/已登记/);
  await f.runtime.finish(turn.turnId, { status: 'cancelled', content: '  门已打开。  ' });
  const session = { ...f.story.session, messages: [...f.story.session.messages, { id: 'a', role: 'assistant' as const, content: '门已打开。',
    rawData: { extra: { ste_runtime: { turnId: turn.turnId, candidateId: 'a:main' } } } }] };
  await updateArchiveStory(f.story.id, () => ({ session }));
  await f.runtime.afterCommit({ storyId: f.story.id, branchId: null, previous: f.story.session, session });
  await f.runtime.resume(true); await f.runtime.flush();
  expect(await f.store.read('memory/main/state.md')).toBeNull();
  expect((await f.runtime.ledger.read(turn.turnId)).status).toBe('cancelled');
});
