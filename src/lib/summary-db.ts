import type { SummaryItem, SummaryTemplate } from '@/types/summary';
import { createRepo, getCurrentRepo, pruneAutoSaved, type RemoveOptions } from '@/lib/repo';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { withArchiveStoryLock } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';

// ---------- summaries ----------

const summaryRepo = createRepo<SummaryItem>('summaries');
const writes = new KeyedSerialQueue();
export function withSummaryLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  return writes.enqueue(id, action);
}

export async function getAllSummaries(): Promise<SummaryItem[]> {
  return summaryRepo.list();
}

export async function saveSummary(item: SummaryItem): Promise<void> {
  const repo = getCurrentRepo<SummaryItem>('summaries'), epoch = getVaultEpoch();
  const snapshot = structuredClone(item);
  const write = () => withSummaryLock(item.id, async () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，记录保存已停止');
    const current = await repo.get(item.id);
    if (current && current.bookId !== snapshot.bookId) throw new Error('记录已移动，请重新打开后编辑');
    await repo.put(snapshot);
  });
  return item.bookId ? withArchiveStoryLock(item.bookId, write) : write();
}

export async function deleteSummary(id: string, options?: RemoveOptions): Promise<void> {
  const repo = getCurrentRepo<SummaryItem>('summaries'), epoch = getVaultEpoch();
  const original = await repo.get(id);
  const remove = () => withSummaryLock(id, async () => {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，记录删除已停止');
    const current = await repo.get(id);
    if (current && current.bookId !== original?.bookId) throw new Error('记录已移动，请重新选择删除目标');
    await repo.remove(id, options);
  });
  return original?.bookId ? withArchiveStoryLock(original.bookId, remove) : remove();
}

/**
 * 只保留最近 `keep` 份「自动落库」(autoSaved) 的总结，超出的按 updatedAt 由旧到新删除。
 * 用户手动保存(autoSaved 非 true)的不受影响。返回被删除的 id 数组。
 * keep 默认 10（生成成本高，比 presets/cards 的 5 多留）。
 */
export async function pruneAutoSavedSummaries(keep = 10): Promise<string[]> {
  return pruneAutoSaved(summaryRepo, keep);
}

// ---------- summaryTemplates（自定义提示词模板；内置模板是常量见 summary-templates.ts） ----------

const templateRepo = createRepo<SummaryTemplate>('summaryTemplates');

export async function getAllSummaryTemplates(): Promise<SummaryTemplate[]> {
  return templateRepo.list();
}

export async function getSummaryTemplate(id: string): Promise<SummaryTemplate | undefined> {
  return templateRepo.get(id);
}

export async function saveSummaryTemplate(item: SummaryTemplate): Promise<void> {
  return templateRepo.put(item);
}

export async function deleteSummaryTemplate(id: string, options?: RemoveOptions): Promise<void> {
  return templateRepo.remove(id, options);
}
