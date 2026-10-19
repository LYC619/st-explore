// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { getCharacter, saveCharacter } from '@/lib/archive-db';
import { saveWorldBook } from '@/lib/worldbook-db';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterExportSnapshot, CharacterWorldbookChoiceRequired } from '@/lib/character-export-snapshot';
import { characterBookToWorldBook } from '@/lib/character-book';
import { extractCharacterFromPngBuffer } from '@/lib/png-parser';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import type { ArchiveCharacter } from '@/types/archive';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aoc8AAAAASUVORK5CYII=';
const character: ArchiveCharacter = { id: 'c', name: '本地展示', tags: [], status: '未开始', createdAt: 1, updatedAt: 1, pngBase64: png,
  displayMeta: { name: '展示覆盖', creator: '展示作者' }, card: { spec: 'chara_card_v2', data: { name: '卡内名', description: '卡原简介',
    character_book: { entries: [{ keys: [], content: '旧 A', enabled: true }] }, extensions: { world: '旧书', regex_scripts: [{ scriptName: '保留正则' }], variables: { score: 9 } } } },
  assets: [{ kind: 'worldbook', assetId: 'wb', relations: ['embedded'] }] };
beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); setActiveVault(null); });
afterEach(() => { setActiveVault(null); closeDB(); vi.unstubAllGlobals(); });

it.each(['browser', 'vault'])('exports current persisted worldbook in equivalent JSON and PNG, preserving MVU and sources (%s)', async mode => {
  if (mode === 'vault') setActiveVault(createVault(createMemFs()));
  await saveCharacter(structuredClone(character));
  await saveWorldBook({ id: 'wb', title: '当前书', createdAt: 1, updatedAt: 2,
    worldbook: { originalData: { name: '旧书', extensions: { bookUnknown: true } }, entries: {
      '7': { ...DEFAULT_ENTRY, uid: 7, comment: '卷总结', content: '新 B', key: ['关键词'], position: 4, unknownField: { x: 1 }, extensions: { old: true } },
    } } });
  const before = JSON.stringify(await getCharacter('c'));
  const output = await buildCharacterExportSnapshot('c');
  expect(output.card.data).toMatchObject({ name: '卡内名', description: '卡原简介', extensions: { world: '当前书', variables: { score: 9 }, regex_scripts: [{ scriptName: '保留正则' }] } });
  expect(characterBookToWorldBook(output.card.data!.character_book)!.entries['7']).toMatchObject({ uid: 7, content: '新 B', position: 4, unknownField: { x: 1 } });
  const bytes = Uint8Array.from(atob(output.pngBase64!), ch => ch.charCodeAt(0));
  expect(extractCharacterFromPngBuffer(bytes.buffer)).toEqual(output.card);
  expect(JSON.stringify(await getCharacter('c'))).toBe(before);
});
it('does not invent a book when no binding exists; primary is used only without embedded', async () => {
  await saveCharacter({ ...character, assets: [] });
  expect((await buildCharacterExportSnapshot('c')).card).toEqual(character.card);
  await saveWorldBook({ id: 'primary', title: '主书', createdAt: 1, updatedAt: 1, worldbook: { entries: {} } });
  await saveCharacter({ ...character, assets: [{ kind: 'worldbook', assetId: 'primary', relations: ['primary'] }, { kind: 'worldbook', assetId: 'extra', relations: ['extra'] }] });
  expect((await buildCharacterExportSnapshot('c')).card.data!.extensions?.world).toBe('主书');
});
it('requires an explicit choice for multiple candidates and refuses missing targets or deleted characters', async () => {
  await saveCharacter({ ...character, assets: [{ kind: 'worldbook', assetId: 'a', relations: ['embedded'] }, { kind: 'worldbook', assetId: 'b', relations: ['embedded'] }] });
  for (const id of ['a', 'b']) await saveWorldBook({ id, title: id, createdAt: 1, updatedAt: 1, worldbook: { entries: {} } });
  await expect(buildCharacterExportSnapshot('c')).rejects.toBeInstanceOf(CharacterWorldbookChoiceRequired);
  expect((await buildCharacterExportSnapshot('c', 'b')).card.data!.extensions?.world).toBe('b');
  await expect(buildCharacterExportSnapshot('c', 'unrelated')).rejects.toThrow('不在');
  await expect(buildCharacterExportSnapshot('deleted')).rejects.toThrow('角色不存在');
});
