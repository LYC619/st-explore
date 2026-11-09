import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { getVaultEpoch, setActiveVault } from '@/lib/vault/active';
import { editSummary } from '@/lib/summary-db';
import type { SummaryItem } from '@/types/summary';

afterEach(() => setActiveVault(null));
it('keeps a newer edit, a deleted record, and another vault safe from a stale detail editor', async () => {
  const vault = createVault(createMemFs()); setActiveVault(vault);
  const item: SummaryItem = { id: 'fixture', bookId: null, bookTitle: '', kind: 'volume', title: 'Synthetic', content: 'Original', floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 };
  const repo = vault.repo<SummaryItem>('summaries'); await repo.put(item);
  const baseline = (await repo.get(item.id))!, epoch = getVaultEpoch();
  const patch = { title: 'Draft', content: 'Draft' };
  await repo.put({ ...baseline, content: 'Newer' });
  await expect(editSummary(baseline, patch, epoch)).rejects.toThrow('记录已修改');
  expect((await repo.get(item.id))?.content).toBe('Newer');
  await repo.remove(item.id);
  await expect(editSummary(baseline, patch, epoch)).rejects.toThrow('删除');
  expect(await repo.get(item.id)).toBeUndefined();
  const other = createVault(createMemFs()); setActiveVault(other); await other.repo('summaries').put(item);
  await expect(editSummary(baseline, patch, epoch)).rejects.toThrow('文件库已切换');
  expect((await other.repo<SummaryItem>('summaries').get(item.id))?.content).toBe('Original');
});
