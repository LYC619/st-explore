import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter } from '@/types/archive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('does not continuously retry a persistent blocked portrait journal while displaying a card', async () => {
  const disk = createMemFs();
  const character: ArchiveCharacter = { id: 'c', name: 'C', card: { name: 'C' },
    tags: [], status: '未开始', createdAt: 1, updatedAt: 1 };
  await disk.writeText('角色/C/档案.json', JSON.stringify(character));
  await disk.writeText('角色/C/.ste-control/portrait-journal/broken.json', '{}');
  let journalChecks = 0;
  const fs = { ...disk, async list(path: string) {
    if (path.endsWith('/portrait-journal')) {
      journalChecks++;
      // Stop the faulty feedback loop deterministically, without hiding the
      // repeated recovery attempts. A real persistent disk error never stops.
      if (journalChecks > 8) throw new Error('test I/O safety cutoff');
    }
    return disk.list(path);
  } };
  setActiveVault(createVault(fs));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<CharacterPortrait character={character} />); });
    // Allow an additional turn for any reaction to the asynchronous failure.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(journalChecks).toBe(1);
  } finally {
    await act(async () => root.unmount()); container.remove(); setActiveVault(null);
  }
});
