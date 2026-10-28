import type { ArchiveCharacter } from '@/types/archive';
import type { LibraryTagPreferences } from '@/lib/library-tag-preferences';
import { characterFilterTags } from '@/lib/tag-taxonomy';
import { avatarKey } from './catalog';
import { sha256 } from 'js-sha256';

const prefix = 'ste-library:';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function roleplayLibraryTags(characters: Pick<ArchiveCharacter, 'id' | 'tags' | 'type' | 'rating'>[], preferences: LibraryTagPreferences, base: Record<string, unknown>) {
  const visible = (raw: string) => !preferences.deleted?.includes(raw) && !preferences.deletedCategories?.includes(raw.includes('/') ? raw.split('/')[0] : '未分类');
  const definitions = new Map<string, { id: string; name: string }>();
  const tagMap: Record<string, string[]> = Object.fromEntries(Object.entries(object(base.tag_map)).map(([avatar, ids]) => [avatar, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !id.startsWith(prefix)) : []]));
  for (const character of characters) {
    const labels = [...characterFilterTags({ tags: character.tags ?? [], rating: character.rating }), ...(character.type ? [`类型/${character.type}`] : [])].filter(visible);
    const ids = [...new Set(labels)].map(name => {
      const id = prefix + sha256(name).slice(0, 20); definitions.set(id, { id, name }); return id;
    });
    const avatar = avatarKey(character.id);
    tagMap[avatar] = [...new Set([...(tagMap[avatar] ?? []), ...ids])];
  }
  return { tags: [...(Array.isArray(base.tags) ? base.tags.filter(tag => !String(object(tag).id || '').startsWith(prefix)) : []), ...definitions.values()], tag_map: tagMap };
}
