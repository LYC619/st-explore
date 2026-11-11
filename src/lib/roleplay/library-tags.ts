import type { ArchiveCharacter } from '@/types/archive';
import { getChatTagOptions, characterChatTags, type LibraryTagPreferences } from '@/lib/library-tag-preferences';
import { avatarKey } from './catalog';
import { sha256 } from 'js-sha256';

const prefix = 'ste-library:';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const idOf = (name: string) => prefix + sha256(name).slice(0, 20);

/** Project the current library's explicit chat selection without changing character data. */
export function roleplayLibraryTags(characters: Pick<ArchiveCharacter, 'id' | 'tags' | 'type' | 'rating'>[], preferences: LibraryTagPreferences, _base: Record<string, unknown>) {
  const options = getChatTagOptions(preferences);
  const tags = options.map(option => ({ id: idOf(option.raw), name: option.label }));
  const tagMap: Record<string, string[]> = {};
  for (const character of characters) {
    const labels = characterChatTags(character);
    tagMap[avatarKey(character.id)] = options.filter(option => labels.includes(option.raw)).map(option => idOf(option.raw));
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
