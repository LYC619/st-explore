import { afterEach, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getStoriesByCharacter } from '@/lib/archive-db';

afterEach(() => { setActiveVault(null); vi.restoreAllMocks(); });

it('does not let malformed optional branches on another character block the requested stories', async () => {
  const disk = createMemFs();
  for (const [id, characterId, branches] of [
    ['good', 'target', []], ['bad', 'other', { unknown: 'preserve' }],
  ] as const) {
    await disk.writeText(`临时/${id}/故事.json`, JSON.stringify({
      id, characterId, title: id, updatedAt: 1, createdAt: 1,
      branches, session: { messages: [] },
    }));
  }
  const vault = createVault(disk); setActiveVault(vault);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The pre-change list-then-filter query can still read this target.
  expect((await vault.repo('archiveStories').list()).filter(item =>
    (item as unknown as { characterId: string }).characterId === 'target')).toHaveLength(1);
  expect((await getStoriesByCharacter('target')).map(item => item.id)).toEqual(['good']);
});
