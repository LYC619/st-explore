import type { ArchiveCharacter } from '@/types/archive';
import type { LibraryTagPreferences } from '@/lib/library-tag-preferences';
import { characterFilterTags } from '@/lib/tag-taxonomy';
import { avatarKey } from './catalog';
import { sha256 } from 'js-sha256';

const prefix = 'ste-library:';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const filterNames = ['类型/人物','类型/剧情','类型/玩法','类型/综合','类型/同人','评价/神作','评价/精品','评价/及格'];
const idOf = (name: string) => prefix + sha256(name).slice(0, 20);

/** The chat picker shows only the agreed type/rating filters; library tags remain intact. */
export function roleplayLibraryTags(characters: Pick<ArchiveCharacter, 'id' | 'tags' | 'type' | 'rating'>[], preferences: LibraryTagPreferences, _base: Record<string, unknown>) {
  const visible = (raw: string) => !preferences.deleted?.includes(raw) && !preferences.deletedCategories?.includes(raw.split('/')[0]);
  const names = filterNames.filter(visible);
  const tags = names.map(name => ({id: idOf(name), name: name.split('/')[1]}));
  const tagMap: Record<string, string[]> = {};
  for (const character of characters) {
    const labels = [...characterFilterTags({ tags: character.tags ?? [], rating: character.rating }), ...(character.type ? [`类型/${character.type}`] : [])];
    tagMap[avatarKey(character.id)] = names.filter(name => labels.includes(name)).map(idOf);
  }
  return { tags, tag_map: tagMap };
}

/** A filtered settings snapshot must not erase hidden personal ST tags on save. */
export function preserveHiddenTavernTags(previous: Record<string, unknown>, incoming: Record<string, unknown>) {
  const tags = new Map<string, unknown>();
  for (const source of [previous, incoming]) for (const tag of Array.isArray(source.tags) ? source.tags : []) {
    const id = object(tag).id;
    if (typeof id === 'string' && !id.startsWith(prefix)) tags.set(id, tag);
  }
  const tagMap: Record<string, string[]> = {};
  for (const source of [previous, incoming]) for (const [avatar, raw] of Object.entries(object(source.tag_map))) {
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && !id.startsWith(prefix)) : [];
    tagMap[avatar] = [...new Set([...(tagMap[avatar] ?? []), ...ids])];
  }
  return { tags: [...tags.values()], tag_map: tagMap };
}
