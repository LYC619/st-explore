import { afterEach, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession, updateCharacter } from '@/lib/archive-db';
import * as worldbookDb from '@/lib/worldbook-db';
import { saveRecordsToWorldbook } from '@/lib/record-to-worldbook';
import { DEFAULT_ENTRY, type WorldBookItem } from '@/types/worldbook';
import type { SummaryItem } from '@/types/summary';
import type { ArchiveCharacter } from '@/types/archive';

afterEach(() => { vi.restoreAllMocks(); setActiveVault(null); });
it.each(['existing', 'new'])('does not restore a character reference removed while a %s batch save is in flight', async mode => {
  const vault = createVault(createMemFs()); setActiveVault(vault);
  const card = buildCharacterFromCard({ name: '并发引用' }); card.assets = [{ kind: 'worldbook', assetId: 'base', relations: ['primary'] }]; await vault.repo('characters').put(card);
  const story = buildStoryFromSession({ id: 's', title: '故事', character: { name: 'c' }, user: { name: 'u' }, messages: [], createdAt: 1 }, card.id);
  await vault.repo('archiveStories').put(story);
  const record: SummaryItem = { id: 'r', kind: 'volume', title: '总结', content: '正文', bookId: story.id, bookTitle: story.title, floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 };
  await vault.repo('summaries').put(record);
  await vault.repo<WorldBookItem>('worldbooks').put({ id: 'base', title: '书', createdAt: 1, updatedAt: 1, worldbook: { entries: {} } });
  const save = worldbookDb.saveWorldBook;
  vi.spyOn(worldbookDb, 'saveWorldBook').mockImplementationOnce(async (item, expected) => {
    await updateCharacter(card.id, () => ({ assets: [] })); await save(item, expected);
  });
  await expect(saveRecordsToWorldbook({ characterId: card.id, targetId: mode === 'existing' ? 'base' : undefined, newBookId: 'new', newTitle: '新书', records: [record], operationId: 'race', duplicateMode: 'skip' })).rejects.toThrow(/引用|关联/);
  expect((await vault.repo<ArchiveCharacter>('characters').get(card.id))!.assets).toEqual([]);
});
it('appends disabled records with safe UIDs to one current derived book, deduplicates and explicitly updates', async () => {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  const card = buildCharacterFromCard({ name: '归档卡' }); card.assets = [{ kind: 'worldbook', assetId: 'base', relations: ['embedded'] }];
  await vault.repo('characters').put(card);
  const story = buildStoryFromSession({ id: 's', title: '故事', character: { name: 'c' }, user: { name: 'u' }, messages: [], createdAt: 1 }, card.id);
  await vault.repo('archiveStories').put(story);
  const records: SummaryItem[] = [1, 2, 3, 4].map(i => ({ id: `r${i}`, kind: i < 3 ? 'volume' : 'diary', title: '同标题', bookId: story.id, bookTitle: story.title,
    content: `成果${i}`, diaryOwner: i > 2 ? `人物${i}` : undefined, volumeNumber: i < 3 ? i : undefined, floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 }));
  for (const record of records) await vault.repo('summaries').put(record);
  const base: WorldBookItem = { id: 'base', title: '原书', worldbook: { entries: Object.fromEntries([0, 2, 50].map(uid => [String(uid), { ...DEFAULT_ENTRY, uid, content: '保留' }])) }, createdAt: 1, updatedAt: 1 };
  await vault.repo('worldbooks').put(base);
  const input = { characterId: card.id, targetId: base.id, records, operationId: 'op', duplicateMode: 'skip' as const };
  const first = await saveRecordsToWorldbook(input);
  const second = await saveRecordsToWorldbook(input);
  expect(second.targetId).toBe(first.targetId);
  expect((await vault.repo<WorldBookItem>('worldbooks').get('base'))!.worldbook).toEqual(base.worldbook);
  const book = (await vault.repo<WorldBookItem>('worldbooks').get(first.targetId))!;
  expect(Object.values(book.worldbook.entries)).toHaveLength(7);
  expect(Object.values(book.worldbook.entries).filter(entry => entry.steRecordSource).every(entry => !entry.enabled)).toBe(true);
  expect(new Set(Object.values(book.worldbook.entries).map(entry => entry.uid)).size).toBe(7);
  records[0] = { ...records[0], content: '修改后的成果', updatedAt: 2 }; await vault.repo('summaries').put(records[0]);
  await saveRecordsToWorldbook({ ...input, records, duplicateMode: 'update', operationId: 'op2' });
  setActiveVault(createVault(fs));
  const current = (await (await import('@/lib/repo')).getCurrentRepo<WorldBookItem>('worldbooks').get(first.targetId))!;
  expect(Object.values(current.worldbook.entries)).toHaveLength(7);
  expect(Object.values(current.worldbook.entries).some(entry => entry.content === '修改后的成果')).toBe(true);
  expect((await (await import('@/lib/repo')).getCurrentRepo<ArchiveCharacter>('characters').get(card.id))!.assets?.[0].assetId).toBe(first.targetId);
});
