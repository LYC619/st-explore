import { expect, it } from 'vitest';
import { roleplayLibraryTags } from '@/lib/roleplay/library-tags';
import { DEFAULT_LIBRARY_TAG_PREFERENCES } from '@/lib/library-tag-preferences';
import { avatarKey } from '@/lib/roleplay/catalog';

it('links rating, type and custom tags while retaining ST tags and dropping stale library definitions', () => {
  const base = { tags: [{ id: 'manual', name: 'ST手动标签' }, { id: 'ste-library:old', name: '旧标签' }],
    tag_map: { [avatarKey('c')]: ['manual', 'ste-library:old'] } };
  const linked = roleplayLibraryTags([{ id: 'c', tags: ['题材/悬疑', '题材/删除项'], type: '人物', rating: 8 }],
    { ...DEFAULT_LIBRARY_TAG_PREFERENCES, deleted: ['题材/删除项'] }, base);
  expect(linked.tags.map(tag => (tag as { name: string }).name)).toEqual(['ST手动标签', '题材/悬疑', '评价/精品', '类型/人物']);
  expect(linked.tag_map[avatarKey('c')]).toContain('manual');
  expect(linked.tag_map[avatarKey('c')]).not.toContain('ste-library:old');
  const removed = roleplayLibraryTags([{ id: 'c', tags: ['题材/悬疑'], type: '人物', rating: 8 }],
    { ...DEFAULT_LIBRARY_TAG_PREFERENCES, deletedCategories: ['题材', '类型'] }, linked);
  expect(removed.tags.map(tag => (tag as { name: string }).name)).toEqual(['ST手动标签', '评价/精品']);
});
