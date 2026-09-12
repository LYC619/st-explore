// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildStoryFromSession, getBranchLine, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { closeDB } from '@/lib/idb';
import { setActiveVault } from '@/lib/vault/active';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { parseFrontmatter } from '@/lib/vault/frontmatter';
import { ensureBranchRuntime } from '@/lib/roleplay/branch-inheritance';
import { chatKey, createRoleplayCatalog } from '@/lib/roleplay/catalog';
import { sourceRefs } from '@/lib/roleplay/fingerprint';
import { encodeLiveChat } from '@/lib/roleplay/live-chat';
import { createMemoryRepository } from '@/lib/roleplay/memory';
import { branchKey } from '@/lib/roleplay/paths';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { createWorldbookVersions } from '@/lib/roleplay/worldbook-versions';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import { parseWorldBook, type WorldBookItem } from '@/types/worldbook';

beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); setActiveVault(null); closeDB(); vi.unstubAllGlobals(); });

const controlRoot = (branchId: string | null) => `.ste-control/roleplay/${branchKey(branchId)}`;
const memoryRoot = (branchId: string | null) => `memory/${branchKey(branchId)}`;

async function fixture(backend: 'desktop' | 'web' = 'desktop') {
  const fs = createMemFs(), vault = createVault(fs);
  setActiveVault(backend === 'desktop' ? vault : null);
  const stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const characters = getCurrentRepo<ArchiveCharacter>('characters');
  const worldbooks = getCurrentRepo<WorldBookItem>('worldbooks');
  const story = buildStoryFromSession({ id: 's', title: '雨夜', createdAt: 1,
    user: { name: '旅人' }, character: { name: '林' }, messages: [
      { id: 'u1', role: 'user', content: '开门' }, { id: 'a1', role: 'assistant', content: '林打开北门。' },
      { id: 'u2', role: 'user', content: '进屋' }, { id: 'a2', role: 'assistant', content: '两人坐在屋里。' },
      { id: 'u3', role: 'user', content: '出海' }, { id: 'a3', role: 'assistant', content: '未来剧情：已经抵达海岛。' },
    ] });
  await saveArchiveStory(story, stories);
  await worldbooks.put({ id: 'north', title: '北门', createdAt: 1, updatedAt: 1,
    worldbook: parseWorldBook({ entries: { 7: { uid: 7, key: ['北门'], content: '北门无人看守。' } } }) });
  const store = createRuntimeStore(story.id).underStoryLock!;
  const refs = sourceRefs(story.session);
  const common = { storyId: story.id, store, stories, worldbooks };
  const memory = createMemoryRepository({ ...common, branchId: null, repo: stories });
  for (const [index, body] of [[1, '地点：北门'], [3, '地点：屋内'], [5, '未来剧情：地点是海岛']] as const) {
    const previous = await memory.read('state.md');
    await memory.commit({ operationId: `state-${index}`, sourceRefs: [refs[index]], changes: [
      { path: 'state.md', body, expectedDigest: previous?.digest ?? null },
    ] });
  }
  await store.write('memory/main/notes.md', '用户笔记：采用第三人称。\r\n保持这一行。');
  await store.write(`${controlRoot(null)}/settings.json`, JSON.stringify({ mode: 'agent', memoryOwner: 'native-agent', unrelated: 'do not inherit' }));
  for (const path of ['context/latest.json', 'generations/old.json', 'maintenance/old.json', 'helpers.json']) {
    await store.write(`${controlRoot(null)}/${path}`, '{"mustNotCopy":true}');
  }
  const versions = createWorldbookVersions({ ...common, branchId: null });
  const accepted = [];
  for (const [index, content] of [[1, '林负责看守北门。'], [3, '林正在屋内。'], [5, '未来剧情：林已出海。']] as const) {
    const proposal = await versions.propose({ operationId: `world-${index}`, worldId: 'north', entryId: 7,
      content, reason: '剧情中的变化', sourceRefs: [refs[index]] });
    accepted.push(await versions.accept(proposal.id));
  }
  await versions.propose({ operationId: 'unaccepted', worldId: 'north', entryId: 7,
    content: '未接受的设定', reason: '待确认', sourceRefs: [refs[3]] });
  const catalog = await createRoleplayCatalog({ ...common, characters, branchId: null });
  let next = 0;
  async function fork(length: number, parentBranchId: string | null = null) {
    const current = (await stories.get(story.id))!;
    const session = getBranchLine(current, parentBranchId)!.session;
    const payload = encodeLiveChat(session).slice(0, length + 1);
    payload[0].chat_metadata = { ...payload[0].chat_metadata, main_chat: chatKey(story.id, parentBranchId) };
    return catalog.resolveForSave(catalog.initial.avatar, `分支 ${++next}`, payload);
  }
  async function allFiles(prefix: string) {
    return Object.fromEntries(await Promise.all((await store.list(prefix)).map(async path => [path, await store.read(path)])));
  }
  return { ...common, fs, vault, story, refs, memory, versions, accepted, catalog, fork, allFiles };
}

describe('source-valid branch runtime inheritance', () => {
  it.each(['desktop', 'web'] as const)('inherits past memory, manual notes, accepted versions and ownership without changing the %s parent', async backend => {
    const f = await fixture(backend), child = await f.fork(4), branchId = child.branchId!;
    const parentMemory = await f.allFiles(memoryRoot(null)), parentControl = await f.allFiles(controlRoot(null));
    const result = await ensureBranchRuntime({ ...f, branchId, store: createRuntimeStore(f.storyId) });
    expect(result).toMatchObject({ status: 'complete', preserved: [] });
    const text = (await f.store.read(`${memoryRoot(branchId)}/state.md`))!;
    expect(parseFrontmatter(text)).toMatchObject({ fields: { revision: 2, owner: 'agent' }, body: '地点：屋内' });
    expect(await f.store.read(`${memoryRoot(branchId)}/notes.md`)).toBe(parentMemory['memory/main/notes.md']);
    expect(JSON.parse((await f.store.read(`${controlRoot(branchId)}/settings.json`))!))
      .toEqual({ mode: 'agent', memoryOwner: 'native-agent' });
    const versions = createWorldbookVersions({ ...f, branchId });
    const inherited = (await versions.list()).sort((a, b) => a.version - b.version);
    expect(inherited.map(version => [version.version, version.status])).toEqual([[2, 'superseded'], [3, 'active']]);
    expect(inherited.every(version => version.branchId === branchId && version.accepted)).toBe(true);
    expect(inherited[0].id).not.toBe(f.accepted[0].id);
    expect(inherited[1].baseVersionId).toBe(inherited[0].id);
    expect(inherited[0].baseVersionId).toBeNull();
    const copied = { ...await f.allFiles(memoryRoot(branchId)), ...await f.allFiles(controlRoot(branchId)) };
    expect(JSON.stringify(copied)).not.toMatch(/未来剧情|mustNotCopy|未接受的设定/);
    expect(await f.allFiles(memoryRoot(null))).toEqual(parentMemory);
    expect(await f.allFiles(controlRoot(null))).toEqual(parentControl);
    const writes = vi.spyOn(f.store, 'write');
    await ensureBranchRuntime({ ...f, branchId });
    expect(writes).not.toHaveBeenCalled();
  });

  it('keeps older committed history for a second fork before the first fork point', async () => {
    const f = await fixture(), parent = await f.fork(4), child = await f.fork(2, parent.branchId);
    await ensureBranchRuntime({ ...f, branchId: child.branchId });
    expect(parseFrontmatter((await f.store.read(`${memoryRoot(parent.branchId)}/state.md`))!).body).toBe('地点：屋内');
    expect(parseFrontmatter((await f.store.read(`${memoryRoot(child.branchId)}/state.md`))!).body).toBe('地点：北门');
    expect((await createWorldbookVersions({ ...f, branchId: child.branchId }).list()).map(item => item.version)).toEqual([2]);
  });

  it('uses the captured fork boundary even when the child later contains more of the parent history', async () => {
    const f = await fixture(), child = await f.fork(2);
    await updateArchiveStory(f.storyId, current => ({ branches: current.branches!.map(branch => branch.id === child.branchId
      ? { ...branch, session: { ...branch.session, messages: structuredClone(current.session.messages) } } : branch) }), f.stories);
    await f.catalog.rename(f.catalog.initial.avatar, f.catalog.initial.key, '父线后来改了名字');
    await ensureBranchRuntime({ ...f, branchId: child.branchId });
    expect(parseFrontmatter((await f.store.read(`${memoryRoot(child.branchId)}/state.md`))!).body).toBe('地点：北门');
    expect((await createWorldbookVersions({ ...f, branchId: child.branchId }).list()).map(item => item.version)).toEqual([2]);
  });

  it('does not recover prepared parent journals or propagate their partially written facts', async () => {
    const f = await fixture(), child = await f.fork(4);
    const write = f.store.write.bind(f.store);
    const previous = await f.memory.read('state.md');
    f.store.write = async (path, text) => {
      if (path === 'memory/main/events/unfinished.md') throw new Error('中断父记忆');
      await write(path, text);
    };
    await expect(f.memory.commit({ operationId: 'unfinished', sourceRefs: [f.refs[3]], changes: [
      { path: 'state.md', body: '尚未提交的状态', expectedDigest: previous!.digest },
      { path: 'events/unfinished.md', body: '尚未提交', expectedDigest: null },
    ] })).rejects.toThrow('中断父记忆');
    f.store.write = write;
    const before = await f.allFiles(controlRoot(null));
    await ensureBranchRuntime({ ...f, branchId: child.branchId });
    expect(parseFrontmatter((await f.store.read(`${memoryRoot(child.branchId)}/state.md`))!).body).toBe('地点：屋内');
    expect(await f.allFiles(controlRoot(null))).toEqual(before);
    expect(await f.store.read('memory/main/events/unfinished.md')).toBeNull();
    expect(await f.store.read('memory/main/state.md')).toContain('尚未提交的状态');
  });

  it('resumes a frozen prepared plan after interruption and preserves later edits to either side', async () => {
    const f = await fixture(), child = await f.fork(4), branchId = child.branchId!;
    const write = f.store.write.bind(f.store), statePath = `${memoryRoot(branchId)}/state.md`;
    f.store.write = async (path, text) => { if (path === statePath) throw new Error('断电'); await write(path, text); };
    await expect(ensureBranchRuntime({ ...f, branchId })).rejects.toThrow('断电');
    const planPath = `${controlRoot(branchId)}/inheritance.json`;
    expect(JSON.parse((await f.store.read(planPath))!).status).toBe('prepared');
    f.store.write = write;
    await write('memory/main/state.md', '父线后来的新状态');
    await write('memory/main/notes.md', '父线后来的新笔记');
    await write(`${memoryRoot(branchId)}/notes.md`, '子线用户手改');
    const result = await ensureBranchRuntime({ ...f, branchId });
    expect(result.preserved).toContain(`${memoryRoot(branchId)}/notes.md`);
    expect(parseFrontmatter((await f.store.read(statePath))!).body).toBe('地点：屋内');
    expect(await f.store.read(`${memoryRoot(branchId)}/notes.md`)).toBe('子线用户手改');
    expect(await f.store.read('memory/main/state.md')).toBe('父线后来的新状态');
    expect(JSON.parse((await f.store.read(planPath))!).status).toBe('complete');
    const writes = vi.spyOn(f.store, 'write');
    await ensureBranchRuntime({ ...f, branchId });
    expect(writes).not.toHaveBeenCalled();
  });

  it('preserves a preexisting target file and recognizes later manual changes to copied agent documents', async () => {
    const f = await fixture(), child = await f.fork(4), branchId = child.branchId!;
    await f.store.write(`${memoryRoot(branchId)}/notes.md`, '这份分支笔记已经存在');
    const result = await ensureBranchRuntime({ ...f, branchId });
    expect(result.preserved).toContain(`${memoryRoot(branchId)}/notes.md`);
    expect(await f.store.read(`${memoryRoot(branchId)}/notes.md`)).toBe('这份分支笔记已经存在');
    const path = `${memoryRoot(branchId)}/state.md`;
    await f.store.write(path, (await f.store.read(path)) + '\n用户保留的修改');
    const memory = createMemoryRepository({ ...f, branchId, repo: f.stories });
    const changed = await memory.read('state.md');
    expect(changed?.owner).toBe('manual');
    await expect(memory.commit({ operationId: 'child-update', sourceRefs: [f.refs[3]], changes: [
      { path: 'state.md', body: '不该覆盖用户修改', expectedDigest: changed!.digest },
    ] })).rejects.toThrow(/手动/);
  });

  it('ignores unmarked old branches and excludes sources invalidated within the child', async () => {
    const f = await fixture(), marked = await f.fork(4), legacy = await f.fork(2);
    await updateArchiveStory(f.storyId, current => ({ branches: current.branches!.map(branch => {
      const next = structuredClone(branch);
      if (branch.id === legacy.branchId) delete next.session.rawMetadata!.ste_catalog.runtimeParent;
      else next.session.messages[0].content = '用户重写了更早的剧情';
      return next;
    }) }), f.stories);
    const writes = vi.spyOn(f.store, 'write');
    expect(await ensureBranchRuntime({ ...f, branchId: legacy.branchId })).toMatchObject({ status: 'not-needed' });
    expect(writes).not.toHaveBeenCalled();
    await ensureBranchRuntime({ ...f, branchId: marked.branchId });
    expect(await f.store.read(`${memoryRoot(marked.branchId)}/state.md`)).toBeNull();
    expect(await f.store.read(`${memoryRoot(marked.branchId)}/notes.md`)).toContain('用户笔记');
    expect(await createWorldbookVersions({ ...f, branchId: marked.branchId }).list()).toEqual([]);
  });

  it('checks the captured session before writes queued behind a story read', async () => {
    const f = await fixture(), child = await f.fork(4);
    let current = true, release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const get = f.stories.get.bind(f.stories);
    vi.spyOn(f.stories, 'get').mockImplementationOnce(async id => { const story = await get(id); entered(); await gate; return story; });
    const writes = vi.spyOn(f.store, 'write');
    const operation = ensureBranchRuntime({ ...f, branchId: child.branchId, isCurrent: () => current });
    const rejected = expect(operation).rejects.toThrow(/切换|停止/);
    await waiting; current = false; release(); await rejected;
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(['file', 'completion'] as const)('reconciles a lost %s write response without rewriting published content', async failure => {
    const f = await fixture(), child = await f.fork(4), branchId = child.branchId!;
    const write = f.store.write.bind(f.store), planPath = `${controlRoot(branchId)}/inheritance.json`;
    const statePath = `${memoryRoot(branchId)}/state.md`;
    let lost = false;
    f.store.write = async (path, text) => {
      await write(path, text);
      if (!lost && (failure === 'file' ? path === statePath : path === planPath && JSON.parse(text).status === 'complete')) {
        lost = true;
        throw new Error('写入成功但响应丢失');
      }
    };
    await expect(ensureBranchRuntime({ ...f, branchId })).rejects.toThrow('写入成功但响应丢失');
    const published = await f.store.read(statePath);
    f.store.write = write;
    const writes = vi.spyOn(f.store, 'write');
    expect(await ensureBranchRuntime({ ...f, branchId })).toMatchObject({ status: 'complete', preserved: [] });
    expect(await f.store.read(statePath)).toBe(published);
    expect(writes.mock.calls.some(([path]) => path === statePath)).toBe(false);
    if (failure === 'completion') expect(writes).not.toHaveBeenCalled();
  });

  it('never replaces a hand-edited prepared plan and stops after a vault switch before publishing files', async () => {
    const f = await fixture(), child = await f.fork(4), branchId = child.branchId!;
    const write = f.store.write.bind(f.store), planPath = `${controlRoot(branchId)}/inheritance.json`;
    let current = true;
    f.store.write = async (path, text) => { await write(path, text); if (path === planPath) current = false; };
    await expect(ensureBranchRuntime({ ...f, branchId, isCurrent: () => current })).rejects.toThrow(/切换|停止/);
    expect(await f.store.list(memoryRoot(branchId))).toEqual([]);
    f.store.write = write;
    const altered = JSON.parse((await f.store.read(planPath))!);
    altered.files[0].text = '用户修改了计划内容';
    const manual = JSON.stringify(altered);
    await write(planPath, manual);
    const writes = vi.spyOn(f.store, 'write');
    await expect(ensureBranchRuntime({ ...f, branchId })).rejects.toThrow(/计划.*修改|格式无效/);
    expect(await f.store.read(planPath)).toBe(manual);
    expect(writes).not.toHaveBeenCalled();
  });

  it('preserves source-side manual edits and keeps their ownership after inheritance', async () => {
    const f = await fixture(), child = await f.fork(6), branchId = child.branchId!;
    const path = 'memory/main/state.md';
    const manual = (await f.store.read(path)) + '\r\n用户在源文件中改写的说明';
    await f.store.write(path, manual);
    await ensureBranchRuntime({ ...f, branchId });
    expect(await f.store.read(`${memoryRoot(branchId)}/state.md`)).toBe(manual);
    const memory = createMemoryRepository({ ...f, branchId, repo: f.stories });
    expect(await memory.read('state.md')).toMatchObject({ owner: 'manual', status: 'active' });
    expect(await f.store.read(path)).toBe(manual);
  });

  it('excludes versions whose original entry changed and retains gaps in accepted version numbering', async () => {
    const f = await fixture();
    const world = (await f.worldbooks.get('north'))!;
    world.worldbook.entries['8'] = { ...world.worldbook.entries['7'], uid: 8, content: '南门无人。' };
    await f.worldbooks.put(world);
    const initial = { operationId: 'south-base', worldId: 'north', entryId: 8, content: '南门有守卫。', reason: '剧情', sourceRefs: [f.refs[1]] };
    const base = await f.versions.propose(initial); await f.versions.accept(base.id);
    await f.versions.propose({ ...initial, operationId: 'south-draft', content: '未接受' });
    const next = await f.versions.propose({ ...initial, operationId: 'south-new', content: '南门换岗。', sourceRefs: [f.refs[3]] });
    await f.versions.accept(next.id);
    const child = await f.fork(4), branchId = child.branchId!;
    world.worldbook.entries['7'].content = '用户改写了北门原件。';
    await f.worldbooks.put(world);
    await ensureBranchRuntime({ ...f, branchId });
    const inherited = await createWorldbookVersions({ ...f, branchId }).list();
    expect(inherited.map(version => [version.entryId, version.version])).toEqual([['8', 4], ['8', 2]]);
    expect(inherited[0].baseVersionId).toBe(inherited[1].id);
    expect(await f.worldbooks.get('north')).toEqual(world);
  });

  it('preserves existing target lore instead of publishing a duplicate version number under another operation', async () => {
    const f = await fixture(), child = await f.fork(4), branchId = child.branchId!;
    const versions = createWorldbookVersions({ ...f, branchId });
    const own = await versions.propose({ operationId: 'child-owned', worldId: 'north', entryId: 7,
      content: '用户已在子线设置自己的版本。', reason: '子线专用', sourceRefs: [f.refs[1]] });
    await versions.accept(own.id);
    const original = await f.store.read(own.path);
    const result = await ensureBranchRuntime({ ...f, branchId });
    expect(result.preserved.length).toBeGreaterThan(0);
    expect(await versions.list()).toMatchObject([{ operationId: 'child-owned', version: 2, status: 'active' }]);
    expect(await f.store.read(own.path)).toBe(original);
  });
});
