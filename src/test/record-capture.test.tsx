import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
import { captureRecord } from '@/lib/record-capture';
import type { SummaryItem } from '@/types/summary';

afterEach(() => setActiveVault(null));
it('captures a stable saved source once, separates coverage from its floor, and preserves diary perspective', async () => {
  const vault = createVault(createMemFs()); setActiveVault(vault);
  const story = buildStoryFromSession({ id: 's', title: '原故事', character: { name: '多人卡' }, user: { name: 'u' }, createdAt: 1,
    messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `正文${i}` })) });
  await vault.repo('archiveStories').put(story);
  const input = { recordId: 'capture-one', storyId: story.id, branchId: null, messageId: 'm11', kind: 'diary' as const,
    content: '修剪后的日记', title: '日记', diaryOwner: '乔伊', range: { start: 0, end: 9 } };
  const result = await captureRecord(input); await captureRecord(input);
  expect(result).toMatchObject({ floorStart: 0, floorEnd: 9, diaryOwner: '乔伊', source: { messageId: 'm11', floor: 11 }, bookId: story.id });
  expect(await vault.repo<SummaryItem>('summaries').list()).toHaveLength(1);
  await expect(captureRecord({ ...input, recordId: 'bad', messageId: 'missing' })).rejects.toThrow(/来源/);
  await expect(captureRecord({ ...input, recordId: 'bad', branchId: 'missing' })).rejects.toThrow(/分支/);
  const noRange = await captureRecord({ ...input, recordId: 'capture-two', range: undefined });
  expect(noRange.rangeDetached).toBe(true);
  const pasted = await captureRecord({ ...input, recordId: 'capture-three', messageId: undefined, range: undefined });
  expect(pasted.rangeDetached).toBe(false);
  expect(pasted).toMatchObject({ floorStart: 0, floorEnd: 11 });
});
