// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildStoryFromSession, saveArchiveStory, deleteArchiveStory, withArchiveStoryLock } from '@/lib/archive-db';
import { closeDB } from '@/lib/idb';
import { getCurrentRepo } from '@/lib/repo';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { branchKey } from '@/lib/roleplay/paths';
import { sourceRefs } from '@/lib/roleplay/fingerprint';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/vault/frontmatter';
import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import * as maintenance from '@/lib/story-maintenance';
import { beginStoryGeneration } from '@/lib/story-activity';
import { createWorldbookVersions } from '@/lib/roleplay/worldbook-versions';
import { parseWorldBook, type WorldBookItem } from '@/types/worldbook';
import { captureBranchRuntimeParent } from '@/lib/roleplay/branch-inheritance';
import { createMemoryRepository } from '@/lib/roleplay/memory';
import { deleteSummary } from '@/lib/summary-db';
import { deleteStoryTree } from '@/lib/story-tree-db';

beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); setActiveVault(null); });
afterEach(() => { setActiveVault(null); closeDB(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function seed() {
  const source: ArchiveStory = { ...buildStoryFromSession({ id: 'session', character: { name: '角色' }, user: { name: '我' }, title: '原故事', createdAt: 1, messages: [
    { id: 'm1', role: 'assistant', content: '原文', rawData: { extra: { ste_runtime: { messageId: 'm1', candidateId: 'candidate1', turnId: 'turn1' } } } },
  ] }), id: 'source', sourcePath: 'C:/SillyTavern/chat.jsonl', writebacks: [{ at: 1, floors: 1 }],
  favorites: ['m1'], markers: [{ messageId: 'm1', messageIndex: 0, createdAt: 1, title: '一' }], lastFloor: 0, rating: 8, status: '进行中',
  branches: [{ id: 'branch1', name: '分支', session: { id: 'bs', character: { name: '角色' }, user: { name: '我' }, title: '分支', messages: [{ id: 'bm1', role: 'user', content: '岔路' }], createdAt: 1 }, markers: [], createdAt: 1, updatedAt: 1 }] };
  const target = { ...buildStoryFromSession({ id: 'target-session', character: { name: '角色' }, user: { name: '我' }, title: '目标故事', messages: [], createdAt: 1 }), id: 'target' };
  await saveArchiveStory(source); await saveArchiveStory(target);
  const summary: SummaryItem = { id: 'summary1', bookId: source.id, bookTitle: source.title, branchId: 'branch1', kind: 'diary', title: '日记', content: '日记正文', floorStart: 8, floorEnd: 15, createdAt: 1, updatedAt: 1, autoSaved: true, source: { messageId: 'bm1', floor: 0, capturedAt: 1 }, genParams: { model: 'model', priorSummaryIds: ['summary2'] } };
  await getCurrentRepo<SummaryItem>('summaries').put(summary);
  await getCurrentRepo<SummaryItem>('summaries').put({ ...summary, id: 'summary2', kind: 'volume', branchId: undefined, source: { messageId: 'm1', floor: 0, capturedAt: 1 } });
  await getCurrentRepo<StoryTree>('stories').put({ id: 'tree1', bookId: source.id, bookTitle: source.title, title: '树', branchId: 'branch1', createdAt: 1, updatedAt: 1, autoSaved: true,
    nodes: [{ id: 'n1', parentId: null, title: '根', content: '', hint: '', tags: [], pinned: false, archived: false, order: 0 }, { id: 'n2', parentId: 'n1', title: '叶', content: '', hint: '', tags: [], pinned: false, archived: false, order: 1 }] });
  const runtime = createRuntimeStore(source.id);
  await runtime.write('memory/main/state.md', serializeFrontmatter({ schema: 1, revision: 1, owner: 'agent', status: 'active', sourceRefs: sourceRefs(source.session) }, '记忆正文'));
  await runtime.write(`memory/${branchKey('branch1')}/state.md`, '分支记忆');
  await runtime.write('.ste-control/roleplay/main/settings.json', JSON.stringify({ mode: 'agent', memoryOwner: 'ste' }));
  await runtime.write('.ste-control/roleplay/main/turns/pending.json', '{"turnId":"pending","status":"prepared"}');
  await runtime.write('.ste-control/roleplay/main/memory-journal/completed.json', '{"schema":1,"status":"committed"}');
  return { source, target, summary };
}

it.each(['browser', 'vault'])('moves a record durably without borrowing the destination floor numbers (%s)', async mode => {
  const fs = createMemFs(); if (mode === 'vault') setActiveVault(createVault(fs));
  const { source, target, summary } = await seed();
  expect(typeof maintenance.moveSummaryToStory).toBe('function');
  const moved = await maintenance.moveSummaryToStory(summary.id, target.id);
  expect(moved).toMatchObject({ ...summary, updatedAt: expect.any(Number), bookId: target.id, bookTitle: target.title, branchId: undefined, autoSaved: false, rangeDetached: true,
    provenance: { bookId: source.id, bookTitle: source.title, branchId: 'branch1', branchTitle: '分支', floorStart: 8, floorEnd: 15 } });
  if (mode === 'vault') setActiveVault(createVault(fs)); else closeDB();
  const saved = await getCurrentRepo<SummaryItem>('summaries').get(summary.id);
  expect(saved).toEqual(moved);
  const again = await maintenance.moveSummaryToStory(summary.id, source.id);
  expect(again.provenance).toEqual(moved.provenance);
  expect(again.rangeDetached).toBe(true);
});

it.each(['browser', 'vault'])('moves a tree within one character with stable node IDs and no stale vault copy (%s)', async mode => {
  const fs = createMemFs(); if (mode === 'vault') setActiveVault(createVault(fs));
  const { source, target } = await seed();
  await saveArchiveStory({ ...source, characterId: 'same' }); await saveArchiveStory({ ...target, characterId: 'same' });
  const before = (await getCurrentRepo<StoryTree>('stories').get('tree1'))!;
  const moved = await maintenance.moveStoryTreeToStory('tree1', target.id, undefined, { characterId: 'same' });
  expect(moved).toMatchObject({ bookId: target.id, bookTitle: target.title, branchId: undefined, autoSaved: false,
    provenance: { bookId: source.id, branchId: 'branch1' } });
  expect(moved.nodes).toEqual(before.nodes);
  if (mode === 'vault') setActiveVault(createVault(fs)); else closeDB();
  expect(await getCurrentRepo<StoryTree>('stories').list()).toEqual([moved]);
  const { saveStoryTree } = await import('@/lib/story-tree-db');
  await expect(saveStoryTree(before)).rejects.toThrow(/归属|移动/);
});

it('rechecks same-character restrictions for both records and trees without changing them on failure', async () => {
  const { source, target, summary } = await seed();
  await saveArchiveStory({ ...source, characterId: 'one' }); await saveArchiveStory({ ...target, characterId: 'two' });
  await expect(maintenance.moveSummaryToStory(summary.id, target.id, undefined, { characterId: 'one' })).rejects.toThrow(/角色/);
  await expect(maintenance.moveStoryTreeToStory('tree1', target.id, undefined, { characterId: 'one' })).rejects.toThrow(/角色/);
  expect((await getCurrentRepo<SummaryItem>('summaries').get(summary.id))!.bookId).toBe(source.id);
  expect((await getCurrentRepo<StoryTree>('stories').get('tree1'))!.bookId).toBe(source.id);
});

it.each(['browser', 'vault'])('copies complete saved state independently with remapped references and memory (%s)', async mode => {
  const fs = createMemFs(); if (mode === 'vault') setActiveVault(createVault(fs));
  const { source } = await seed();
  expect(typeof maintenance.duplicateArchiveStory).toBe('function');
  const copy = await maintenance.duplicateArchiveStory(source.id);
  expect(copy.id).not.toBe(source.id); expect(copy.title).toBe('原故事（副本）');
  expect(copy.session.title).toBe(copy.title);
  expect(copy.sourcePath).toBeUndefined(); expect(copy.writebacks).toBeUndefined();
  expect(copy.rating).toBe(8); expect(copy.status).toBe('进行中');
  const sums = (await getCurrentRepo<SummaryItem>('summaries').list()).filter(x => x.bookId === copy.id);
  expect(sums).toHaveLength(2);
  expect(sums.every(x => x.autoSaved === false)).toBe(true);
  expect(sums.find(x => x.kind === 'diary')!.genParams!.priorSummaryIds).toEqual([sums.find(x => x.kind === 'volume')!.id]);
  expect(sums.find(x => x.kind === 'diary')!.branchId).toBe(copy.branches![0].id);
  expect(sums.find(x => x.kind === 'diary')!.source!.messageId).toBe(copy.branches![0].session.messages[0].id);
  expect(copy.favorites).toEqual([copy.session.messages[0].id]);
  expect(copy.markers[0].messageId).toBe(copy.session.messages[0].id);
  expect(copy.session.messages[0].id).not.toBe('m1');
  const trees = (await getCurrentRepo<StoryTree>('stories').list()).filter(x => x.bookId === copy.id);
  expect(trees).toHaveLength(1); expect(trees[0].nodes[1].parentId).toBe(trees[0].nodes[0].id);
  if (mode === 'vault') setActiveVault(createVault(fs)); else closeDB();
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').get(copy.id)).toEqual(copy);
  const runtime = createRuntimeStore(copy.id);
  expect(await runtime.list()).toEqual(expect.arrayContaining(['memory/main/state.md', `memory/${branchKey(copy.branches![0].id)}/state.md`]));
  expect((await runtime.list()).some(path => /turns|journal/.test(path))).toBe(false);
  expect(parseFrontmatter((await runtime.read('memory/main/state.md'))!).fields.sourceRefs).toEqual(sourceRefs(copy.session));
  await runtime.write('memory/main/state.md', '改副本');
  expect(await createRuntimeStore(source.id).read('memory/main/state.md')).toContain('记忆正文');
});

it('rejects generation and stale or missing targets without changing saved content', async () => {
  const { source, summary } = await seed();
  const release = beginStoryGeneration(source.id);
  await expect(maintenance.duplicateArchiveStory(source.id)).rejects.toThrow(/生成/); release();
  await expect(maintenance.moveSummaryToStory(summary.id, 'missing')).rejects.toThrow(/故事/);
  await expect(maintenance.moveSummaryToStory(summary.id, 'target', 'missing')).rejects.toThrow(/分支/);
  expect(await getCurrentRepo<SummaryItem>('summaries').get(summary.id)).toEqual(summary);
});

it('leaves no visible copy after a staging write fails', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs)); const { source } = await seed();
  const write = fs.writeText.bind(fs); fs.writeText = async (path, text) => { if (path.startsWith('.ste-control/story-packages/') && path.includes('/memory/')) throw new Error('disk full'); await write(path, text); };
  await expect(maintenance.duplicateArchiveStory(source.id)).rejects.toThrow(/disk full/);
  setActiveVault(createVault(fs));
  expect((await getCurrentRepo<ArchiveStory>('archiveStories').list()).map(x => x.id).sort()).toEqual(['source', 'target']);
  expect(await getCurrentRepo<SummaryItem>('summaries').get('summary1')).toBeDefined();
});

it('does not rewrite prose that happens to equal an identifier when copying', async () => {
  const { source, summary } = await seed();
  source.session.messages[0].content = 'm1';
  source.session.messages[0].rawData!.mes = 'candidate1';
  source.session.messages[0].rawData!.foreign = { id: 'm1', content: 'm1' };
  source.session.rawMetadata = { ste_catalog: { avatar: 'ste~story~source', fileName: '旧名称', aliases: ['旧名称'] } };
  await saveArchiveStory(source);
  await getCurrentRepo<SummaryItem>('summaries').put({ ...summary, content: 'summary2', title: 'source' });
  const copy = await maintenance.duplicateArchiveStory(source.id);
  expect(copy.session.messages[0].content).toBe('m1');
  expect(copy.session.messages[0].rawData!.mes).toBe('candidate1');
  expect(copy.session.messages[0].rawData!.foreign).toEqual({ id: 'm1', content: 'm1' });
  expect(copy.session.rawMetadata?.ste_catalog).toEqual({});
  const sums = (await getCurrentRepo<SummaryItem>('summaries').list()).filter(item => item.bookId === copy.id);
  expect(sums.find(item => item.kind === 'diary')).toMatchObject({ title: 'source', content: 'summary2' });
});

it.each(['browser', 'vault'])('copies readable worldbook version chains without changing shared assets or prose (%s)', async mode => {
  if (mode === 'vault') setActiveVault(createVault(createMemFs()));
  const { source } = await seed();
  const worldbooks = getCurrentRepo<WorldBookItem>('worldbooks');
  const stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const world: WorldBookItem = { id: 'm1', title: '世界书', createdAt: 1, updatedAt: 1,
    worldbook: parseWorldBook({ entries: { 1: { uid: 1, key: ['门'], content: '原文' } } }) };
  await worldbooks.put(world);
  const versions = createWorldbookVersions({ storyId: source.id, branchId: null, store: createRuntimeStore(source.id), stories, worldbooks });
  const proposal = { operationId: 'op1', worldId: world.id, entryId: 1, content: 'm1', reason: 'candidate1', sourceRefs: sourceRefs(source.session) };
  const first = await versions.propose(proposal); await versions.accept(first.id);
  const second = await versions.propose({ ...proposal, operationId: 'op2' }); await versions.accept(second.id);
  const copy = await maintenance.duplicateArchiveStory(source.id);
  const copied = createWorldbookVersions({ storyId: copy.id, branchId: null, store: createRuntimeStore(copy.id), stories, worldbooks });
  const chain = await copied.list();
  expect(chain).toHaveLength(2);
  expect(chain.every(item => item.id !== first.id && item.id !== second.id)).toBe(true);
  expect(await copied.effective(world.id, 1)).toMatchObject({ content: 'm1', reason: 'candidate1', status: 'active', worldId: 'm1', sourceRefs: sourceRefs(copy.session) });
  expect(await worldbooks.get(world.id)).toEqual(world);
  expect(await versions.effective(world.id, 1)).toMatchObject({ id: second.id });
});

it('cleans staged files after publication fails and leaves source data intact', async () => {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  const { source } = await seed();
  vi.spyOn(vault, 'publishStoryDirectory').mockRejectedValue(new Error('publish failed'));
  await expect(maintenance.duplicateArchiveStory(source.id)).rejects.toThrow('publish failed');
  const collect = async (directory: string): Promise<string[]> => {
    const result: string[] = [];
    for (const entry of await fs.list(directory)) {
      const path = directory + '/' + entry.name;
      result.push(...(entry.isDir ? await collect(path) : [path]));
    }
    return result;
  };
  expect(await collect('.ste-control/story-packages')).toEqual([]);
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').get(source.id)).toEqual(source);
});

it('removes browser runtime storage atomically while keeping detached records', async () => {
  const { source, target } = await seed();
  await createRuntimeStore(target.id).write('memory/main/state.md', '目标记忆');
  await deleteArchiveStory(source.id, { deleteFiles: false });
  closeDB();
  expect(await getCurrentRepo<ArchiveStory>('archiveStories').get(source.id)).toBeUndefined();
  expect(await createRuntimeStore(source.id).underStoryLock!.list()).toEqual([]);
  expect(await getCurrentRepo<SummaryItem>('summaries').get('summary1')).toMatchObject({ bookId: null, autoSaved: false });
  expect(await createRuntimeStore(target.id).read('memory/main/state.md')).toBe('目标记忆');
});

it('materializes unopened branch memory before making an independent copy', async () => {
  const { source } = await seed();
  const store = createRuntimeStore(source.id);
  await store.remove('.ste-control/roleplay/main/memory-journal/completed.json');
  await store.write('.ste-control/roleplay/main/settings.json', JSON.stringify({ mode: 'agent', memoryOwner: 'native-agent' }));
  const memory = createMemoryRepository({ storyId: source.id, branchId: null, store });
  await memory.commit({ operationId: 'mem-op', sourceRefs: sourceRefs(source.session), changes: [{ path: 'history.md', body: '分支应继承的记忆', expectedDigest: null }] });
  const branch = source.branches![0];
  branch.session = structuredClone(source.session);
  branch.session.rawMetadata = { ste_catalog: { runtimeParent: captureBranchRuntimeParent(source.id, branch.id, null, source.session, branch.session) } };
  await saveArchiveStory(source);
  const copy = await maintenance.duplicateArchiveStory(source.id);
  const copiedMemory = createMemoryRepository({ storyId: copy.id, branchId: copy.branches![0].id, store: createRuntimeStore(copy.id) });
  expect(await copiedMemory.read('history.md')).toMatchObject({ body: '分支应继承的记忆', status: 'active' });
  expect(copy.branches![0].session.rawMetadata?.ste_catalog?.runtimeParent).toBeUndefined();
});

it('rejects copying partially committed memory without publishing a copy', async () => {
  const { source } = await seed();
  await createRuntimeStore(source.id).write('.ste-control/roleplay/main/memory-journal/pending.json', '{"schema":1,"status":"prepared"}');
  await expect(maintenance.duplicateArchiveStory(source.id)).rejects.toThrow(/恢复/);
  expect((await getCurrentRepo<ArchiveStory>('archiveStories').list()).map(item => item.id).sort()).toEqual(['source', 'target']);
});

it.each(['summary', 'tree'])('serializes %s deletion with story snapshot and detachment operations', async kind => {
  const { source } = await seed();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const snapshot = withArchiveStoryLock(source.id, () => barrier);
  let removed = false;
  const deletion = (kind === 'summary' ? deleteSummary('summary1', { deleteFiles: false }) : deleteStoryTree('tree1', { deleteFiles: false }))
    .then(() => { removed = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(removed).toBe(false);
  } finally { release(); await snapshot; await deletion; }
  expect(removed).toBe(true);
});
