import type { RemoveOptions } from '@/lib/repo';
import type { StoryTree } from '@/types/story-tree';
import { createRepo, getCurrentRepo } from '@/lib/repo';
import { withArchiveStoryLock } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';

const repo = createRepo<StoryTree>('stories');
const writes = new KeyedSerialQueue();
export function withStoryTreeLock<T>(id: string, action: () => Promise<T>): Promise<T> { return writes.enqueue(id, action); }

export async function getAllStoryTrees(): Promise<StoryTree[]> {
  return repo.list();
}

export async function saveStoryTree(item: StoryTree): Promise<void> {
  const store = getCurrentRepo<StoryTree>('stories'), epoch = getVaultEpoch();
  const snapshot = structuredClone(item);
  const write = () => withStoryTreeLock(snapshot.id, async () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，故事树保存已停止');
    const current = await store.get(snapshot.id);
    if (current && current.bookId !== snapshot.bookId) throw new Error('故事树归属已变化，请重新打开');
    await store.put(snapshot);
  });
  return snapshot.bookId ? withArchiveStoryLock(snapshot.bookId, write) : write();
}

export async function deleteStoryTree(id: string, options?: RemoveOptions): Promise<void> {
  const store = getCurrentRepo<StoryTree>('stories'), epoch = getVaultEpoch();
  const original = await store.get(id);
  const remove = () => withStoryTreeLock(id, async () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，故事树删除已停止');
    const current = await store.get(id);
    if (current && current.bookId !== original?.bookId) throw new Error('故事树归属已变化，请重新选择删除目标');
    await store.remove(id, options);
  });
  return original?.bookId ? withArchiveStoryLock(original.bookId, remove) : remove();
}
