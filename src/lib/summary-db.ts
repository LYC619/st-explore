import type { SummaryItem, SummaryTemplate } from '@/types/summary';
import { createRepo, getCurrentRepo, type RemoveOptions } from '@/lib/repo';
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

export type SummaryEditPatch = Pick<SummaryItem, 'title' | 'content' | 'volumeNumber' | 'volumeCategory' | 'diaryOwner'>
  & Partial<Pick<SummaryItem, 'floorStart' | 'floorEnd' | 'rangeDetached'>>;

/** Explicit detail-editor save: never recreate a deleted/moved record or overwrite another editor. */
export async function editSummary(expected: SummaryItem, patch: SummaryEditPatch, expectedEpoch: number): Promise<void> {
  const repo = getCurrentRepo<SummaryItem>('summaries');
  const baseline = JSON.stringify(expected), edits = structuredClone(patch);
  if (!edits.title.trim() || !edits.content.trim()) throw new Error('标题和正文不能为空');
  if (edits.volumeNumber !== undefined && (!Number.isSafeInteger(edits.volumeNumber) || edits.volumeNumber < 1)) {
    throw new Error('卷号必须是正整数');
  }
  if (edits.floorStart !== undefined || edits.floorEnd !== undefined) {
    const start = edits.floorStart ?? expected.floorStart;
    const end = edits.floorEnd ?? expected.floorEnd;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
      throw new Error('起始楼层需为非负整数，且结束楼层不能小于起始楼层');
    }
  }
  const write = () => withSummaryLock(expected.id, async () => {
    if (getVaultEpoch() !== expectedEpoch) throw new Error('文件库已切换，请重新打开记录');
    const current = await repo.get(expected.id);
    if (getVaultEpoch() !== expectedEpoch) throw new Error('文件库已切换，请重新打开记录');
    if (!current || JSON.stringify(current) !== baseline) throw new Error('记录已修改、移动或删除，请关闭后重新打开');
    await repo.put({ ...current, ...edits, title: edits.title.trim(), autoSaved: false, updatedAt: Date.now() });
  });
  return expected.bookId ? withArchiveStoryLock(expected.bookId, write) : write();
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
 * 历史兼容存根：已取消自动按数量静默清理旧总结的危险行为，所有已生成记录永久保留直至用户主动删除。
 */
export async function pruneAutoSavedSummaries(_keep = 10): Promise<string[]> {
  return [];
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
