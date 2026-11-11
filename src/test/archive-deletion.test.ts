import { afterEach, describe, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession, deleteArchiveStory, deleteCharacter } from '@/lib/archive-db';
import type { SummaryItem } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import { listRetainedOperations, restoreRetainedOperation } from '@/lib/vault/file-maintenance';

afterEach(() => setActiveVault(null));

async function fixture() {
  const fs = createMemFs(), vault = createVault(fs);
  setActiveVault(vault);
  const character = buildCharacterFromCard({ name: '角色' });
  const story = buildStoryFromSession({ id: 'session', title: '故事', messages: [], character: { name: '角色' }, user: { name: '我' }, createdAt: 1 }, character.id);
  const summary: SummaryItem = { id: 'sum', bookId: story.id, bookTitle: story.title, kind: 'diary', title: '日记', content: '不能丢失', floorStart: 0, floorEnd: 2, autoSaved: true, createdAt: 1, updatedAt: 1 };
  const tree: StoryTree = { id: 'tree', bookId: story.id, bookTitle: story.title, title: '树', nodes: [], createdAt: 1, updatedAt: 1 };
  await vault.repo('characters').put(character);
  await vault.repo('archiveStories').put(story);
  await vault.repo('summaries').put(summary);
  await vault.repo('stories').put(tree);
  return { fs, vault, character, story, summary, tree };
}

describe('用户删除的关联保留', () => {
  it('角色整组删除中途失败，所有故事与记录仍保留原归属', async () => {
    const f = await fixture();
    const rename = f.fs.rename; let count = 0;
    f.fs.rename = async (from, to) => {
      if (to.includes('/files/') && ++count === 3) throw new Error('磁盘故障');
      return rename(from, to);
    };
    await expect(deleteCharacter(f.character.id, { deleteFiles: true })).rejects.toThrow('磁盘故障');
    const reopened = createVault(f.fs);
    expect(await reopened.repo('characters').get(f.character.id)).toBeDefined();
    expect(await reopened.repo('archiveStories').get(f.story.id)).toMatchObject({ characterId: f.character.id });
    expect(await reopened.repo('summaries').get('sum')).toMatchObject({ bookId: f.story.id });
  });
  it('删除角色连同故事、日记和树进入同一回收记录，恢复后归属完整', async () => {
    const f = await fixture();
    await deleteCharacter(f.character.id, { deleteFiles: false });
    const reopened = createVault(f.fs);
    expect(await reopened.repo('characters').get(f.character.id)).toBeUndefined();
    const saved = await reopened.repo<import('@/types/archive').ArchiveStory>('archiveStories').get(f.story.id);
    expect(saved).toBeUndefined();
    expect(await reopened.repo('summaries').get('sum')).toBeUndefined();
    expect(await f.vault.repo('archiveStories').get(f.story.id)).toBeUndefined();
    expect(await f.vault.repo('summaries').get('sum')).toBeUndefined();
    expect(await reopened.repo('stories').get('tree')).toBeUndefined();
    const retained = await listRetainedOperations(reopened);
    expect(retained).toHaveLength(1);
    setActiveVault(reopened);
    await restoreRetainedOperation(reopened, retained[0].operationId);
    expect(await reopened.repo('archiveStories').get(f.story.id)).toMatchObject({ characterId: f.character.id });
    expect(await reopened.repo('summaries').get('sum')).toMatchObject({ bookId: f.story.id });
    const restored = createVault(f.fs);
    expect(await restored.repo('characters').get(f.character.id)).toBeDefined();
    expect(await restored.repo('archiveStories').get(f.story.id)).toMatchObject({ characterId: f.character.id });
    expect(await restored.repo('summaries').get('sum')).toMatchObject({ bookId: f.story.id, content: '不能丢失' });
    expect(await restored.repo('stories').get('tree')).toMatchObject({ bookId: f.story.id });
  });

  it('删除故事将日记和树转为永久未绑定记录，重启不丢失', async () => {
    const f = await fixture();
    await deleteArchiveStory(f.story.id, { deleteFiles: true });
    const reopened = createVault(f.fs);
    expect(await reopened.repo('archiveStories').get(f.story.id)).toBeUndefined();
    expect(await reopened.repo('summaries').get('sum')).toMatchObject({ bookId: null, bookTitle: '故事', content: '不能丢失', autoSaved: false });
    expect(await reopened.repo('stories').get('tree')).toMatchObject({ bookId: null, title: '树' });
  });

  it('下属记录写入失败时停止删除故事', async () => {
    const f = await fixture();
    const rename = f.fs.rename;
    f.fs.rename = async (from, to) => {
      if (to.startsWith('临时/记录/')) throw new Error('磁盘已满');
      return rename(from, to);
    };
    await expect(deleteArchiveStory(f.story.id, { deleteFiles: true })).rejects.toThrow('磁盘已满');
    expect(await f.vault.repo('archiveStories').get(f.story.id)).toBeDefined();
    expect(await f.vault.repo('summaries').get('sum')).toMatchObject({ bookId: f.story.id });
  });
});
