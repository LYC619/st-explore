import { expect, it } from 'vitest';
import { readLibraryReturnState, writeLibraryReturnState } from '@/lib/library-return-state';
it.each(['grid', 'list', 'review'])('restores sorting and filters after opening a character from %s', mode => {
  localStorage.setItem('ste-library-view', mode);
  const state = { searchQuery: '旅人', tagFilters: {}, typeFilter: 'all' as const, sortKey: 'added' as const, sortAsc: true };
  writeLibraryReturnState(state);
  expect(readLibraryReturnState()).toEqual(state);
});
