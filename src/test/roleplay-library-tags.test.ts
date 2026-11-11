import { expect, it } from 'vitest';
import { roleplayLibraryTags, preserveHiddenTavernTags } from '@/lib/roleplay/library-tags';
import { DEFAULT_LIBRARY_TAG_PREFERENCES } from '@/lib/library-tag-preferences';
import { avatarKey } from '@/lib/roleplay/catalog';

it('projects only the eight type/rating filters without exposing custom or old ST tags', () => {
  const base = { tags: [{ id: 'manual', name: 'ST手动标签' }, { id: 'ste-library:old', name: '旧标签' }], tag_map: { [avatarKey('c')]: ['manual', 'ste-library:old'] } };
  const linked = roleplayLibraryTags([{ id: 'c', tags: ['题材/悬疑', '人物/少女', '待转移'], type: '人物', rating: 8 }], DEFAULT_LIBRARY_TAG_PREFERENCES, base);
  expect(linked.tags.map(tag => tag.name)).toEqual(['人物','剧情','玩法','综合','同人','神作','精品','及格']);
  expect(linked.tag_map[avatarKey('c')]).toHaveLength(2);
  expect(linked.tag_map[avatarKey('c')]).not.toContain('manual');
  expect(base.tags[0].name).toBe('ST手动标签');
  const removed=roleplayLibraryTags([{id:'c',tags:[],type:'人物',rating:8}],{...DEFAULT_LIBRARY_TAG_PREFERENCES,deletedCategories:['类型']},base);
  expect(removed.tags.map(tag=>tag.name)).toEqual(['神作','精品','及格']);
});

it('preserves hidden original ST tag data when the filtered chat settings are saved', () => {
  const original={ tags:[{id:'manual',name:'原有标签'}], tag_map:{a:['manual']} };
  const saved=preserveHiddenTavernTags(original,{tags:[{id:'ste-library:x',name:'人物'},{id:'new',name:'新标签'}],tag_map:{a:['ste-library:x','new']}});
  expect(saved.tags).toEqual([{id:'manual',name:'原有标签'},{id:'new',name:'新标签'}]);
  expect(saved.tag_map.a).toEqual(['manual','new']);
});

it('makes library-enabled organizing tags selectable without matching completed or untagged cards', () => {
  const characters = [
    { id: 'missing', tags: ['缺总结', '日记完', '其他标签'], type: '人物' as const, rating: 8 },
    { id: 'done', tags: ['总结完', '缺日记'], type: '人物' as const, rating: 8 },
    { id: 'untagged', tags: [], type: '剧情' as const },
  ];
  const preferences = { ...DEFAULT_LIBRARY_TAG_PREFERENCES, chatVisible: [...DEFAULT_LIBRARY_TAG_PREFERENCES.chatVisible!, '缺总结', '总结完', '缺日记', '日记完'] };
  const linked = roleplayLibraryTags(characters, preferences, {});
  expect(linked.tags.slice(8).map(tag => tag.name)).toEqual(['缺总结', '总结完', '缺日记', '日记完']);
  const missing = linked.tags.find(tag => tag.name === '缺总结')!;
  expect(missing).toBeDefined();
  expect(characters.filter(character => linked.tag_map[avatarKey(character.id)].includes(missing.id)).map(character => character.id)).toEqual(['missing']);
  expect(linked.tag_map[avatarKey('missing')]).toHaveLength(4);
  const reordered = roleplayLibraryTags([...characters].reverse(), preferences, {});
  expect(reordered.tags).toEqual(linked.tags);
  expect(linked.tags.some(tag => tag.name === '其他标签')).toBe(false);
});

it('respects deleted tags while keeping an enabled filter even when no cards match', () => {
  const characters = [{ id: 'missing', tags: ['缺总结', '缺日记'] }];
  const preferences = { ...DEFAULT_LIBRARY_TAG_PREFERENCES, chatVisible: ['缺总结', '缺日记'] };
  const deleted = roleplayLibraryTags(characters, { ...preferences, deleted: ['缺总结'] }, {});
  expect(deleted.tags.map(tag => tag.name)).toEqual(['缺日记']);
  const deletedCategory = roleplayLibraryTags(characters, { ...preferences, deletedCategories: ['未分类'] }, {});
  expect(deletedCategory.tag_map[avatarKey('missing')]).toEqual([]);
  const refreshed = roleplayLibraryTags([{ id: 'missing', tags: ['总结完'] }], preferences, {});
  expect(refreshed.tags.map(tag => tag.name)).toEqual(['缺总结', '缺日记']);
  expect(refreshed.tag_map[avatarKey('missing')]).toEqual([]);
});
