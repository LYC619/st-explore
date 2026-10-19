import type { RemoveOptions } from '@/lib/repo';
import type { WorldBookItem } from '@/types/worldbook';
import { createRepo, getCurrentRepo, pruneAutoSaved } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';

const repo = createRepo<WorldBookItem>('worldbooks');
const writes = new KeyedSerialQueue();

export async function getAllWorldBooks(): Promise<WorldBookItem[]> {
  return repo.list();
}

export async function getWorldBook(id: string): Promise<WorldBookItem | undefined> {
  return repo.get(id);
}

export async function saveWorldBook(item: WorldBookItem, expected?: WorldBookItem): Promise<void> {
  const target = getCurrentRepo<WorldBookItem>('worldbooks'), epoch = getVaultEpoch();
  return writes.enqueue(`${epoch}/${item.id}`, async () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，世界书保存已停止');
    if (expected) {
      const current = await target.get(item.id);
      if (!current || JSON.stringify(current.worldbook) !== JSON.stringify(expected.worldbook)) throw new Error('世界书已在其他位置修改；当前草稿未覆盖库内内容');
      if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，世界书保存已停止');
    }
    await target.put(item);
  });
}

export async function deleteWorldBook(id: string, options?: RemoveOptions): Promise<void> {
  return repo.remove(id, options);
}

/**
 * 只保留最近 `keep` 份「自动保留」(autoSaved) 的世界书，超出的按 updatedAt 由旧到新删除。
 * 用户手动保存(autoSaved 非 true)的不受影响。返回被删除的 id 数组。
 */
export async function pruneAutoSavedWorldBooks(keep = 5): Promise<string[]> {
  return pruneAutoSaved(repo, keep);
}
