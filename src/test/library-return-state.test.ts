import { expect, it } from 'vitest';
import { readLibraryReturnState, writeLibraryReturnState } from '@/lib/library-return-state';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
it.each(['grid', 'list', 'review'])('restores sorting and filters after opening a character from %s', mode => {
  localStorage.setItem('ste-library-view', mode);
  const state = { searchQuery: '旅人', tagFilters: {}, typeFilter: 'all' as const, sortKey: 'added' as const, sortAsc: true };
  writeLibraryReturnState(state);
  expect(readLibraryReturnState()).toEqual(state);
});

it('keeps page, scroll and expanded groups scoped to the selected vault', () => {
  const state = { searchQuery: '', tagFilters: {}, typeFilter: 'all' as const, sortKey: 'recent' as const, sortAsc: false,
    browse: { page: 3, scrollTop: 480, expandedGroups: ['人物'], layout: 'grid' } };
  try {
    setCurrentVaultId('browse-a'); writeLibraryReturnState(state);
    setCurrentVaultId('browse-b'); expect(readLibraryReturnState()).toBeUndefined();
    setCurrentVaultId('browse-a'); expect(readLibraryReturnState()).toEqual(state);
  } finally { setCurrentVaultId(null); }
});
