import { scopedKey } from '@/lib/vault/vault-scope';
import type { LibrarySortKey, LibraryTypeFilter } from '@/lib/library-query';
import type { TagCategory } from '@/lib/tag-taxonomy';

export interface LibraryReturnState {
  searchQuery: string;
  tagFilters: Partial<Record<TagCategory, string[]>>;
  typeFilter: LibraryTypeFilter;
  sortKey: LibrarySortKey;
  sortAsc: boolean;
  browse?: { page: number; scrollTop: number; expandedGroups: string[]; layout: string };
}

// Only navigation context, never archive contents. A new app session starts fresh.
const states = new Map<string, LibraryReturnState>();
export function readLibraryReturnState(): LibraryReturnState | undefined {
  return states.get(scopedKey('library-return'));
}
export function writeLibraryReturnState(state: LibraryReturnState): void {
  states.set(scopedKey('library-return'), state);
}
