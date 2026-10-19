import { getCharacter, updateCharacter } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { getAllWorldBooks, saveWorldBook } from '@/lib/worldbook-db';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import { appendEntries } from '@/lib/worldbook-entry-copy';
import { switchAssetRef } from '@/lib/asset-cow';
import { getVaultEpoch } from '@/lib/vault/active';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { DEFAULT_ENTRY, type WorldBook, type WorldBookItem, type WorldBookEntry } from '@/types/worldbook';
import type { SummaryItem } from '@/types/summary';
import type { ArchiveStory } from '@/types/archive';

interface RecordSource { id: string; updatedAt: number; operationId: string }
export type DuplicateRecordMode = 'skip' | 'update' | 'copy';
export interface RecordsToWorldbookInput {
  characterId: string; targetId?: string; newBookId?: string; newTitle?: string; records: SummaryItem[];
  operationId: string; duplicateMode: DuplicateRecordMode;
}
const writes = new KeyedSerialQueue();
export function recordEntryTitle(record: SummaryItem): string {
  return [record.volumeNumber ? `第 ${record.volumeNumber} 卷` : '', record.kind === 'diary' ? record.diaryOwner || record.genParams?.diaryOwner || '日记' : '', record.title].filter(Boolean).join(' · ');
}
export function mergeRecordsIntoWorldbook(book: WorldBook, records: SummaryItem[], mode: DuplicateRecordMode, operationId: string): WorldBook {
  let result = structuredClone(book);
  for (const record of records) {
    const existing = Object.entries(result.entries).filter(([, entry]) => (entry.steRecordSource as RecordSource | undefined)?.id === record.id);
    if (existing.some(([, entry]) => (entry.steRecordSource as RecordSource).operationId === operationId)) continue;
    if (existing.length && mode === 'skip') continue;
    const content = { comment: recordEntryTitle(record), content: record.content,
      steRecordSource: { id: record.id, updatedAt: record.updatedAt, operationId } };
    if (existing.length && mode === 'update') {
      const [key, entry] = existing[0]; result.entries[key] = { ...entry, ...content };
    } else {
      result = appendEntries(result, [{ ...DEFAULT_ENTRY, uid: 0, ...content, key: [], keysecondary: [], enabled: false, constant: false } as WorldBookEntry]);
    }
  }
  return result;
}

export async function saveRecordsToWorldbook(input: RecordsToWorldbookInput): Promise<{ targetId: string; title: string }> {
  const epoch = getVaultEpoch(), summaries = getCurrentRepo<SummaryItem>('summaries'), stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const check = () => { if (getVaultEpoch() !== epoch) throw new Error('资料库已切换，加入世界书已停止'); };
  if (!input.records.length) throw new Error('请先选择记录');
  return writes.enqueue(`${epoch}/${input.characterId}`, async () => {
    check(); const character = await getCharacter(input.characterId); check(); if (!character) throw new Error('角色不存在');
    const validateRecords = async () => {
      for (const record of input.records) {
        const current = await summaries.get(record.id); check();
        if (!current || current.bookId !== record.bookId || current.updatedAt !== record.updatedAt || current.content !== record.content) throw new Error(`记录已变化，请重新选择：${record.title}`);
        const story = current.bookId ? await stories.get(current.bookId) : undefined;
        if (!story || story.characterId !== input.characterId) throw new Error('记录已移出当前角色');
      }
      check();
    };
    await validateRecords();
    if (input.targetId) {
      const books = await getAllWorldBooks(); check();
      const base = books.find(book => book.id === input.targetId);
      const associated = character.assets?.some(ref => ref.kind === 'worldbook' && (ref.assetId === input.targetId
        || books.some(book => book.id === ref.assetId && book.derived?.derivedFrom === input.targetId && book.derived?.characterId === character.id)));
      if (!base || !associated) throw new Error('目标世界书不再关联当前角色');
      let expected: WorldBookItem | undefined;
      const result = await saveAssetWithCow<WorldBookItem>({ kind: 'worldbook', baseId: input.targetId,
        characterId: character.id, characterName: character.name, title: base.title, content: { worldbook: { entries: {} } },
        reload: getAllWorldBooks, newId: () => crypto.randomUUID(), assertCurrent: check,
        validateReference: (current, targetId) => {
          check();
          if (!current.assets?.some(ref => ref.kind === 'worldbook' && (ref.assetId === input.targetId || ref.assetId === targetId))) throw new Error('目标世界书关联已变化，请重新选择');
        },
        prepareContent: async target => { await validateRecords(); expected = target;
          return { worldbook: mergeRecordsIntoWorldbook(target.worldbook, input.records, input.duplicateMode, input.operationId), autoSaved: false }; },
        save: item => saveWorldBook({ ...item, title: item.title || expected!.title }, item.id === expected!.id ? expected : undefined),
      });
      return result;
    }
    if (!input.newBookId || !input.newTitle?.trim()) throw new Error('请填写新世界书标题');
    const books = await getAllWorldBooks(); check();
    const previous = books.find(book => book.id === input.newBookId);
    const book: WorldBookItem = { id: input.newBookId, title: input.newTitle.trim(), createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now(),
      worldbook: mergeRecordsIntoWorldbook(previous?.worldbook ?? { entries: {} }, input.records, input.duplicateMode, input.operationId), autoSaved: false };
    await saveWorldBook(book, previous); check();
    const originalPrimary = character.assets?.find(ref => ref.kind === 'worldbook' && (ref.relations?.includes('embedded') || ref.relations?.includes('primary')))?.assetId;
    const saved = await updateCharacter(character.id, current => {
      check(); const primary = current.assets?.find(ref => ref.kind === 'worldbook' && (ref.relations?.includes('embedded') || ref.relations?.includes('primary')));
      if (primary?.assetId !== originalPrimary && primary?.assetId !== book.id) throw new Error('世界书已保存，但当前引用已变化，请重新选择');
      const assets = switchAssetRef(current.assets, 'worldbook', primary?.assetId ?? book.id, book.id)
        .map(ref => ref.kind === 'worldbook' && ref.assetId === book.id ? { ...ref, relations: [...new Set([...(ref.relations ?? []), 'primary' as const])] } : ref);
      return { assets, updatedAt: Date.now() };
    });
    if (!saved) throw new Error('世界书已保存，但角色引用更新失败');
    return { targetId: book.id, title: book.title };
  });
}
