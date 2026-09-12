import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBranchFromSession, buildStoryFromSession, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { createVault } from '@/lib/vault/vault-backend';
import { digest, sourceRefs, stableJson } from '@/lib/roleplay/fingerprint';
import { branchKey } from '@/lib/roleplay/paths';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { createWorldbookVersions } from '@/lib/roleplay/worldbook-versions';
import type { ArchiveStory } from '@/types/archive';
import { parseWorldBook, type WorldBookItem } from '@/types/worldbook';

afterEach(() => { vi.restoreAllMocks(); setActiveVault(null); });

const pathFor = (operationId: string, branchId: string | null = null, worldId = 'north', entryId: string | number = 7) =>
  `.ste-control/roleplay/${branchKey(branchId)}/worldbook-versions/${digest(stableJson([worldId, String(entryId)]))}/${digest(operationId)}.json`;

async function fixture() {
  const fs = createMemFs(), vault = createVault(fs);
  setActiveVault(vault);
  const stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const worldbooks = getCurrentRepo<WorldBookItem>('worldbooks');
  const story = buildStoryFromSession({ id: 'session', title: '北门', createdAt: 1,
    character: { name: '林' }, user: { name: '旅人' }, messages: [
      { id: 'u1', role: 'user', content: '查看城门' },
      { id: 'a1', role: 'assistant', content: '北门由林看守。' },
      { id: 'u2', role: 'user', content: '交接结束了吗' },
      { id: 'a2', role: 'assistant', content: '林已成为守门官。', rawData: { extra: { ste_runtime: { candidateId: 'candidate-a' } } } },
    ] });
  story.branches = [{ ...buildBranchFromSession(structuredClone(story.session), '平行故事'), id: 'main' }];
  await saveArchiveStory(story, stories);
  await worldbooks.put({ id: 'north', title: '城门设定', createdAt: 1, updatedAt: 1,
    worldbook: parseWorldBook({ entries: {
      7: { uid: 7, key: ['北门'], content: '北门尚无守门官。', constant: true, foreign: { keep: true } },
      8: { uid: 8, key: ['南门'], content: '南门临河。' },
    } }) });
  const store = createRuntimeStore(story.id).underStoryLock!;
  let current = true;
  const options = { storyId: story.id, branchId: null, store, stories, worldbooks, isCurrent: () => current };
  const versions = createWorldbookVersions(options);
  const refs = sourceRefs(story.session);
  const proposal = { operationId: 'turn-1', worldId: 'north', entryId: 7,
    content: '北门由林看守。', reason: '林已在剧情中接任。', sourceRefs: [refs[1]] };
  return { fs, vault, story, stories, worldbooks, store, options, versions, refs, proposal,
    setCurrent: (value: boolean) => { current = value; } };
}

describe('branch worldbook versions', () => {
  it('persists a readable v2 draft and acceptance beside the story without changing either original', async () => {
    const f = await fixture();
    const world = (await f.worldbooks.get('north'))!;
    const originalStory = await f.stories.get(f.story.id);
    const worldPath = (await f.vault.pathOf('worldbooks', 'north'))!;
    const originalText = await f.fs.readText(worldPath);
    const worldWrites = vi.spyOn(f.worldbooks, 'put'), storyWrites = vi.spyOn(f.stories, 'put');
    expect(await f.versions.effective('north', 7)).toBeNull();
    const draft = await f.versions.propose(f.proposal);
    expect(draft).toMatchObject({ worldId: 'north', entryId: '7', branchId: null, version: 2,
      content: f.proposal.content, sourceRefs: f.proposal.sourceRefs, accepted: false, status: 'draft',
      baseEntryDigest: digest(stableJson(world.worldbook.entries['7'])), baseVersionId: null });
    expect(await f.versions.effective('north', '7')).toBeNull();
    const directory = (await f.vault.pathOf('archiveStories', f.story.id))!;
    const path = pathFor(f.proposal.operationId);
    expect(await f.store.list()).toEqual([path]);
    expect(JSON.parse(await f.fs.readText(`${directory}/${path}`))).toMatchObject({ schema: 1, id: draft.id, entryId: '7', version: 2, accepted: false });
    const accepted = await f.versions.accept(draft.id);
    expect(accepted).toMatchObject({ id: draft.id, version: 2, accepted: true, status: 'active' });
    expect(await createWorldbookVersions(f.options).effective('north', 7)).toEqual(accepted);
    expect(await f.versions.list()).toEqual([accepted]);
    expect(await f.fs.readText(worldPath)).toBe(originalText);
    expect(await f.worldbooks.get('north')).toEqual(world);
    expect(await f.stories.get(f.story.id)).toEqual(originalStory);
    expect(worldWrites).not.toHaveBeenCalled();
    expect(storyWrites).not.toHaveBeenCalled();
  });

  it.each(['edit', 'candidate'] as const)('restores the earlier accepted version after a later source %s and can restore the later history', async change => {
    const f = await fixture();
    const early = await f.versions.propose(f.proposal);
    await f.versions.accept(early.id);
    const later = await f.versions.propose({ ...f.proposal, operationId: 'turn-2', content: '林已成为守门官。', sourceRefs: [f.refs[3]] });
    expect(later).toMatchObject({ version: 3, baseVersionId: early.id });
    await f.versions.accept(later.id);
    expect((await f.versions.list()).find(item => item.id === early.id)?.status).toBe('superseded');
    const writes = vi.spyOn(f.store, 'write');
    await updateArchiveStory(f.story.id, current => ({ session: { ...current.session,
      messages: current.session.messages.map(message => message.id !== 'a2' ? message : change === 'edit'
        ? { ...message, content: '交接尚未完成。' }
        : { ...message, rawData: { ...message.rawData, extra: { ste_runtime: { candidateId: 'candidate-b' } } } }),
    } }), f.stories);
    expect(await f.versions.effective('north', 7)).toMatchObject({ id: early.id, status: 'active' });
    expect((await f.versions.list()).find(item => item.id === later.id)).toMatchObject({ accepted: true, status: 'invalidated' });
    await updateArchiveStory(f.story.id, () => ({ session: structuredClone(f.story.session) }), f.stories);
    expect(await f.versions.effective('north', 7)).toMatchObject({ id: later.id, status: 'active' });
    expect(writes).not.toHaveBeenCalled();
  });

  it('rejects old references after an earlier history edit even when the referenced message is unchanged', async () => {
    const f = await fixture();
    const proposal = { ...f.proposal, sourceRefs: [f.refs[3]] };
    const draft = await f.versions.propose(proposal);
    await updateArchiveStory(f.story.id, current => ({ session: { ...current.session,
      messages: current.session.messages.map(message => message.id === 'a1' ? { ...message, content: '林离开了北门。' } : message),
    } }), f.stories);
    expect((await f.versions.list())[0].status).toBe('invalidated');
    await expect(f.versions.accept(draft.id)).rejects.toThrow(/来源/);
    await expect(f.versions.propose({ ...proposal, operationId: 'late' })).rejects.toThrow(/来源/);
    expect(await f.versions.effective('north', 7)).toBeNull();
    expect(await f.store.list()).toHaveLength(1);
  });

  it('keeps the mainline and a branch named main isolated, including repeated operation IDs', async () => {
    const f = await fixture();
    const branch = createWorldbookVersions({ ...f.options, branchId: 'main' });
    const mainDraft = await f.versions.propose(f.proposal);
    const branchDraft = await branch.propose({ ...f.proposal, content: '平行故事的北门由许看守。' });
    expect(branchDraft).toMatchObject({ version: 2, branchId: 'main', baseVersionId: null });
    expect(branchDraft.id).not.toBe(mainDraft.id);
    await f.versions.accept(mainDraft.id);
    expect(await branch.effective('north', 7)).toBeNull();
    await branch.accept(branchDraft.id);
    expect(await f.versions.effective('north', 7)).toMatchObject({ content: f.proposal.content });
    expect(await branch.effective('north', 7)).toMatchObject({ content: '平行故事的北门由许看守。' });
    expect(await f.store.list()).toEqual([pathFor('turn-1', 'main'), pathFor('turn-1')].sort());
    await expect(branch.accept(mainDraft.id)).rejects.toThrow(/不存在/);
    await expect(f.versions.reject(branchDraft.id)).rejects.toThrow(/不存在/);
  });

  it.each(['content', 'key'] as const)('rejects old drafts after the original entry %s changes and freezes a new base for fresh proposals', async field => {
    const f = await fixture();
    const accepted = await f.versions.propose(f.proposal);
    await f.versions.accept(accepted.id);
    const stale = await f.versions.propose({ ...f.proposal, operationId: 'old-base' });
    const original = (await f.worldbooks.get('north'))!;
    if (field === 'content') original.worldbook.entries['7'].content = '原件由用户改写。';
    else original.worldbook.entries['7'].key = ['新的关键词'];
    await f.worldbooks.put(original);
    await expect(f.versions.accept(stale.id)).rejects.toThrow(/原条目|原件/);
    expect(await f.versions.effective('north', 7)).toBeNull();
    expect((await f.versions.list()).every(item => item.status === 'invalidated')).toBe(true);
    const fresh = await f.versions.propose({ ...f.proposal, operationId: 'new-base' });
    expect(fresh).toMatchObject({ version: 4, baseVersionId: null, baseEntryDigest: digest(stableJson(original.worldbook.entries['7'])) });
    expect(await f.versions.accept(fresh.id)).toMatchObject({ status: 'active' });
    expect(await f.worldbooks.get('north')).toEqual(original);
  });

  it('does not let a stale draft replace a later accepted version, or reaccept an older version as active', async () => {
    const f = await fixture();
    const base = await f.versions.propose(f.proposal);
    await f.versions.accept(base.id);
    const stale = await f.versions.propose({ ...f.proposal, operationId: 'stale', content: '旧草稿' });
    const newer = await f.versions.propose({ ...f.proposal, operationId: 'newer', content: '新决定', sourceRefs: [f.refs[3]] });
    await f.versions.accept(newer.id);
    await expect(f.versions.accept(stale.id)).rejects.toThrow(/基础版本|已接受版本/);
    expect((await f.versions.list()).find(item => item.id === stale.id)?.status).toBe('invalidated');
    const writes = vi.spyOn(f.store, 'write');
    expect(await f.versions.accept(base.id)).toMatchObject({ status: 'superseded', accepted: true });
    expect(await f.versions.effective('north', 7)).toMatchObject({ id: newer.id, status: 'active' });
    expect(writes).not.toHaveBeenCalled();
  });

  it('serializes duplicate proposals across handles and returns retries without rewriting or accepting changed input', async () => {
    const f = await fixture();
    const other = createWorldbookVersions(f.options);
    const writes = vi.spyOn(f.store, 'write');
    const [one, two] = await Promise.all([f.versions.propose(f.proposal), other.propose({ ...f.proposal, entryId: '7' })]);
    expect(two).toEqual(one);
    expect(writes).toHaveBeenCalledTimes(1);
    const accepted = await f.versions.accept(one.id);
    expect(await other.propose(f.proposal)).toEqual(accepted);
    for (const changed of [{ content: '不同内容' }, { reason: '不同理由' }, { sourceRefs: [f.refs[3]] }, { entryId: 8 }]) {
      await expect(other.propose({ ...f.proposal, ...changed })).rejects.toThrow(/同一.*操作|不同/);
    }
    expect(writes).toHaveBeenCalledTimes(2);
    expect(await f.store.list()).toHaveLength(1);
  });

  it('allocates monotonic draft numbers and accepts at most one concurrently proposed replacement', async () => {
    const f = await fixture();
    const other = createWorldbookVersions(f.options);
    const [one, two] = await Promise.all([f.versions.propose(f.proposal), other.propose({ ...f.proposal, operationId: 'another' })]);
    expect([one.version, two.version].sort()).toEqual([2, 3]);
    const decisions = await Promise.allSettled([f.versions.accept(one.id), other.accept(two.id)]);
    expect(decisions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await f.versions.list()).filter(item => item.status === 'active')).toHaveLength(1);
  });

  it('persists rejection, leaves accepted content effective, and does not resurrect a rejected proposal', async () => {
    const f = await fixture();
    const active = await f.versions.propose(f.proposal);
    await f.versions.accept(active.id);
    const input = { ...f.proposal, operationId: 'rejected' };
    const draft = await f.versions.propose(input);
    expect(await f.versions.reject(draft.id)).toMatchObject({ accepted: false, status: 'rejected' });
    const writes = vi.spyOn(f.store, 'write');
    expect(await f.versions.reject(draft.id)).toMatchObject({ status: 'rejected' });
    expect(await createWorldbookVersions(f.options).propose(input)).toMatchObject({ id: draft.id, status: 'rejected' });
    await expect(f.versions.accept(draft.id)).rejects.toThrow(/拒绝/);
    expect(await f.versions.effective('north', 7)).toMatchObject({ id: active.id });
    expect(writes).not.toHaveBeenCalled();
  });

  it('rechecks sources inside the story queue after an earlier queued history edit', async () => {
    const f = await fixture();
    const draft = await f.versions.propose(f.proposal);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const edit = updateArchiveStory(f.story.id, async current => {
      started(); await gate;
      return { session: { ...current.session, messages: current.session.messages.slice(0, 1) } };
    }, f.stories);
    await entered;
    const rejected = expect(f.versions.accept(draft.id)).rejects.toThrow(/来源/);
    const late = expect(f.versions.propose({ ...f.proposal, operationId: 'queued' })).rejects.toThrow(/来源/);
    release(); await edit; await rejected; await late;
    expect(JSON.parse((await f.store.read(pathFor('turn-1')))!)).toMatchObject({ accepted: false });
    expect(await f.store.list()).toHaveLength(1);
  });

  it('stops a queued write after its scope changes and checks reads too', async () => {
    const f = await fixture();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const blocker = updateArchiveStory(f.story.id, async () => { started(); await gate; return undefined; }, f.stories);
    await entered;
    const rejected = expect(f.versions.propose(f.proposal)).rejects.toThrow(/切换|失效/);
    f.setCurrent(false); release(); await blocker; await rejected;
    await expect(f.versions.list()).rejects.toThrow(/切换|失效/);
    expect(await f.store.list()).toEqual([]);
  });

  it.each(['propose', 'accept'] as const)('rereads the original entry before a %s write if an earlier read was delayed', async operation => {
    const f = await fixture();
    const draft = operation === 'accept' ? await f.versions.propose(f.proposal) : null;
    const writes = vi.spyOn(f.store, 'write');
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const get = f.worldbooks.get.bind(f.worldbooks);
    vi.spyOn(f.worldbooks, 'get').mockImplementationOnce(async id => {
      const current = await get(id); started(); await gate; return current;
    });
    const rejected = expect(draft ? f.versions.accept(draft.id) : f.versions.propose(f.proposal)).rejects.toThrow(/原条目|原件/);
    await entered;
    const changed = (await get('north'))!;
    changed.worldbook.entries['7'].content = '用户在操作期间修改了原件。';
    await f.worldbooks.put(changed);
    release(); await rejected;
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(['broken JSON', 'invalid record'] as const)('reports %s without overwriting it through reads or retries', async corruption => {
    const f = await fixture();
    const draft = await f.versions.propose(f.proposal);
    const path = pathFor('turn-1');
    const damaged = corruption === 'broken JSON' ? '{' : JSON.stringify({ ...JSON.parse((await f.store.read(path))!), content: '未经校验的外部改写' });
    await f.store.write(path, damaged);
    const writes = vi.spyOn(f.store, 'write');
    await expect(f.versions.list()).rejects.toThrow(/损坏|格式|校验/);
    await expect(f.versions.effective('north', 7)).rejects.toThrow(/损坏|格式|校验/);
    await expect(f.versions.propose(f.proposal)).rejects.toThrow(/损坏|格式|校验/);
    await expect(f.versions.accept(draft.id)).rejects.toThrow(/损坏|格式|校验/);
    await expect(f.versions.reject(draft.id)).rejects.toThrow(/损坏|格式|校验/);
    expect(await f.store.read(path)).toBe(damaged);
    expect(writes).not.toHaveBeenCalled();
  });
});
