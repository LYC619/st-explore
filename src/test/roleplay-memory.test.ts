import { afterEach, expect, it } from 'vitest';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { createMemoryRepository } from '@/lib/roleplay/memory';
import { sourceRefs } from '@/lib/roleplay/fingerprint';

afterEach(() => setActiveVault(null));
async function fixture() {
  setActiveVault(createVault(createMemFs()));
  const story = buildStoryFromSession({ id: 's', title: '雨夜', createdAt: 1, user: { name: '我' }, character: { name: '林' }, messages: [
    { id: 'u1', role: 'user', content: '开门' }, { id: 'a1', role: 'assistant', content: '林打开北门。' },
    { id: 'u2', role: 'user', content: '进屋' }, { id: 'a2', role: 'assistant', content: '两人坐在屋里。' },
  ] });
  await saveArchiveStory(story);
  const store = createRuntimeStore(story.id).underStoryLock!;
  const memory = createMemoryRepository({ storyId: story.id, branchId: null, store });
  return { story, store, memory, refs: sourceRefs(story.session) };
}
it('commits readable sourced memory once and does not rewrite it on an idempotent retry', async () => {
  const f = await fixture();
  const change = { path: 'state.md', body: '时间：雨夜\n地点：屋内\n在场：旅人、林', expectedDigest: null };
  await f.memory.commit({ operationId: 'turn-1', sourceRefs: [f.refs[3]], changes: [change] });
  const file = await f.store.read('memory/main/state.md');
  expect(file).toContain('sourceRefs:');
  expect(file).toContain('屋内');
  await f.memory.commit({ operationId: 'turn-1', sourceRefs: [f.refs[3]], changes: [change] });
  expect(await f.store.read('memory/main/state.md')).toBe(file);
  expect((await f.memory.list()).documents[0]).toMatchObject({ path: 'state.md', status: 'active', revision: 1 });
});
it('invalidates dependent later facts after an earlier edit while retaining manual notes', async () => {
  const f = await fixture();
  await f.memory.commit({ operationId: 'auto', sourceRefs: [f.refs[3]], changes: [{ path: 'state.md', body: '屋内', expectedDigest: null }] });
  await f.memory.commit({ operationId: 'manual', sourceRefs: [], manual: true, changes: [{ path: 'style.md', body: '第三人称，少用比喻', expectedDigest: null }] });
  await updateArchiveStory(f.story.id, current => ({ session: { ...current.session,
    messages: current.session.messages.map(m => m.id === 'a1' ? { ...m, content: '林没有开门。' } : m) } }));
  const result = await f.memory.list();
  expect(result.documents.find(d => d.path === 'state.md')?.status).toBe('invalidated');
  expect(result.documents.find(d => d.path === 'style.md')).toMatchObject({ owner: 'manual', status: 'active' });
  await expect(f.memory.commit({ operationId: 'late', sourceRefs: [f.refs[3]], changes: [{ path: 'events/late.md', body: '迟到', expectedDigest: null }] })).rejects.toThrow(/来源/);
});
it('does not overwrite an external memory edit using a stale model proposal', async () => {
  const f = await fixture();
  await f.memory.commit({ operationId: 'first', sourceRefs: [f.refs[1]], changes: [{ path: 'state.md', body: '门口', expectedDigest: null }] });
  const document = (await f.memory.list()).documents[0];
  const original = await f.store.read('memory/main/state.md');
  await f.store.write('memory/main/state.md', original + '\n用户补充：门是红色。');
  await expect(f.memory.commit({ operationId: 'stale', sourceRefs: [f.refs[3]], changes: [{ path: 'state.md', body: '屋内', expectedDigest: document.digest }] })).rejects.toThrow(/修改/);
  expect(await f.store.read('memory/main/state.md')).toContain('用户补充');
});
it('recovers a prepared partial write, but preserves conflicting manual changes and excludes the whole transaction', async () => {
  const f = await fixture();
  const write = f.store.write.bind(f.store);
  let fail = true;
  f.store.write = async (path, text) => {
    if (fail && path === 'memory/main/events/entry.md') throw new Error('断电');
    return write(path, text);
  };
  await expect(f.memory.commit({ operationId: 'partial', sourceRefs: [f.refs[3]], changes: [
    { path: 'state.md', body: '屋内', expectedDigest: null }, { path: 'events/entry.md', body: '进屋', expectedDigest: null },
  ] })).rejects.toThrow('断电');
  fail = false;
  expect((await f.memory.list()).documents.filter(d => d.status === 'active')).toHaveLength(2);
  const state = (await f.memory.list()).documents.find(d => d.path === 'state.md')!;
  fail = true;
  await expect(f.memory.commit({ operationId: 'conflict', sourceRefs: [f.refs[3]], changes: [
    { path: 'state.md', body: '新状态', expectedDigest: state.digest }, { path: 'events/entry.md', body: '新事件', expectedDigest: (await f.memory.list()).documents.find(d => d.path === 'events/entry.md')!.digest },
  ] })).rejects.toThrow('断电');
  fail = false;
  await write('memory/main/state.md', '用户在断电后重新写下的笔记');
  const recovered = await f.memory.list();
  expect(recovered.conflicts).toContain('conflict');
  expect(recovered.documents.filter(d => d.status === 'active')).toHaveLength(0);
  expect(await f.store.read('memory/main/state.md')).toBe('用户在断电后重新写下的笔记');
});

it('rolls back an interrupted write whose source was deleted, leaving existing manual notes alone', async () => {
  const f = await fixture();
  await f.store.write('memory/main/style.md', '用户写下的文风约定');
  const write = f.store.write.bind(f.store);
  f.store.write = async (path, text) => {
    if (path === 'memory/main/events/late.md') throw new Error('写入中断');
    return write(path, text);
  };
  await expect(f.memory.commit({ operationId: 'old-history', sourceRefs: [f.refs[3]], changes: [
    { path: 'state.md', body: '尚未完成', expectedDigest: null }, { path: 'events/late.md', body: '尚未完成', expectedDigest: null },
  ] })).rejects.toThrow('写入中断');
  f.store.write = write;
  await updateArchiveStory(f.story.id, current => ({ session: { ...current.session, messages: current.session.messages.slice(0, 2) } }));
  expect((await f.memory.list()).documents).toMatchObject([{ path: 'style.md', owner: 'manual', status: 'active' }]);
  expect(await f.store.read('memory/main/state.md')).toBeNull();
});

it('protects external edits even after a new agent has reread the changed file', async () => {
  const f = await fixture();
  await f.memory.commit({ operationId: 'first', sourceRefs: [f.refs[1]], changes: [{ path: 'state.md', body: '门口', expectedDigest: null }] });
  await f.store.write('memory/main/state.md', (await f.store.read('memory/main/state.md')) + '\n用户补充：保留这行。');
  const state = (await f.memory.list()).documents[0];
  expect(state.owner).toBe('manual');
  await expect(f.memory.commit({ operationId: 'next', sourceRefs: [f.refs[3]], changes: [{ path: state.path, body: '屋内', expectedDigest: state.digest }] })).rejects.toThrow(/手动/);
});
