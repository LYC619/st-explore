import { afterEach, expect, it } from 'vitest';
import { getLibraryTagPreferences, saveLibraryTagPreferences } from '@/lib/archive-db';
import { getChatTagOptions, normalizeLibraryTagPreferences, removeCustomTagDefinition, removeTagCategory, setTagChatVisibility } from '@/lib/library-tag-preferences';
import { roleplayLibraryTags } from '@/lib/roleplay/library-tags';
import { avatarKey } from '@/lib/roleplay/catalog';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';

afterEach(() => setActiveVault(null));

it('uses library choices for arbitrary labels, independently of sidebar visibility', () => {
  const preferences = normalizeLibraryTagPreferences({ version: 1, hidden: ['待重读'], chatVisible: ['待重读', '我的分组/待续'], customCategories: ['我的分组'] });
  const cards = [{ id: 'a', tags: ['待重读'] }, { id: 'b', tags: ['缺总结', '我的分组/待续'] }];
  const projected = roleplayLibraryTags(cards, preferences, {});
  expect(getChatTagOptions(preferences).map(option => option.raw)).toEqual(['待重读', '我的分组/待续']);
  expect(projected.tags.map(tag => tag.name)).toEqual(['待重读', '待续']);
  expect(projected.tag_map[avatarKey('a')]).toEqual([projected.tags[0].id]);
  expect(projected.tag_map[avatarKey('b')]).toEqual([projected.tags[1].id]);
});

it('migrates the former default selection but keeps an explicit empty selection empty', () => {
  const old = normalizeLibraryTagPreferences({ version: 1 });
  expect(old.chatVisible).toHaveLength(8);
  expect(normalizeLibraryTagPreferences({ version: 1, chatVisible: [] }).chatVisible).toEqual([]);
  expect(normalizeLibraryTagPreferences({ version: 1, chatVisible: [' 待重读 ', '待重读', '', 42] }).chatVisible).toEqual(['待重读']);
  expect(getChatTagOptions({ ...old, chatVisible: [] })).toEqual([]);
});

it('can disable defaults and removes tag and category selections on deletion', () => {
  let preferences = normalizeLibraryTagPreferences({ version: 1, customCategories: ['归档'], chatVisible: ['类型/人物', '缺总结', '归档/待查'] });
  preferences = setTagChatVisibility(preferences, '类型/人物', false);
  preferences = removeCustomTagDefinition(preferences, '缺总结');
  preferences = removeTagCategory(preferences, '归档');
  expect(getChatTagOptions(preferences)).toEqual([]);
  expect(preferences.chatVisible).toEqual([]);
});

it('stores the selection in the library file and keeps two libraries separate after reopen', async () => {
  const first = createMemFs(), second = createMemFs();
  setActiveVault(createVault(first));
  const saved = setTagChatVisibility(normalizeLibraryTagPreferences({ version: 1, chatVisible: [] }), '待重读', true);
  await saveLibraryTagPreferences(saved);
  expect(JSON.parse(await first.readText('库信息.json')).libraryTags.chatVisible).toEqual(['待重读']);
  setActiveVault(createVault(second));
  await saveLibraryTagPreferences({ ...saved, chatVisible: ['待补录'] });
  setActiveVault(createVault(first));
  expect((await getLibraryTagPreferences()).chatVisible).toEqual(['待重读']);
  setActiveVault(createVault(second));
  expect((await getLibraryTagPreferences()).chatVisible).toEqual(['待补录']);
});
