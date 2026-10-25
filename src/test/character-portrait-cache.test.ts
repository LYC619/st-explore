import { afterEach, expect, it, vi } from 'vitest';
import { CharacterPortraitCache, loadCharacterPortrait } from '@/lib/character-portrait-cache';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { createMemFs } from '@/lib/vault/fs';
import { saveCharacter } from '@/lib/archive-db';
import type { ArchiveCharacter } from '@/types/archive';

afterEach(() => setActiveVault(null));
it('merges concurrent reads, evicts least-recent entries by bytes, and skips oversized retention', async () => {
  const cache = new CharacterPortraitCache({ maxEntries: 2, maxBytes: 12 });
  const read = vi.fn(async () => '123');
  expect(await Promise.all([cache.read('a', read), cache.read('a', read)])).toEqual(['123', '123']);
  expect(read).toHaveBeenCalledTimes(1);
  await cache.read('b', read); await cache.read('a', read); await cache.read('c', read);
  await cache.read('a', read); expect(read).toHaveBeenCalledTimes(3);
  await cache.read('b', read); expect(read).toHaveBeenCalledTimes(4);
  const oversized = vi.fn(async () => '1234567');
  await cache.read('large', oversized); await cache.read('large', oversized);
  expect(oversized).toHaveBeenCalledTimes(2);
  await cache.read('b', read); expect(read).toHaveBeenCalledTimes(4);
});
it('does not let a read started before invalidation refill the cache', async () => {
  const cache = new CharacterPortraitCache();
  let finish!: (value: string) => void;
  const old = cache.read('a', () => new Promise<string>(resolve => { finish = resolve; }));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  cache.clear();
  expect(await cache.read('a', async () => 'new')).toBe('new');
  finish('old'); await old;
  expect(await cache.read('a', async () => 'wrong')).toBe('new');
});
it('invalidates same-timestamp writes and same-id vault switches without retaining full records', async () => {
  const disk = createMemFs(); const binary = vi.fn(disk.readBinary);
  setActiveVault(createVault({ ...disk, readBinary: binary }));
  const character: ArchiveCharacter = { id: 'a', name: 'A', card: { name: 'A' }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1, pngBase64: 'AQID' };
  await saveCharacter(character); binary.mockClear();
  expect(await loadCharacterPortrait(character.id, character.updatedAt)).toBe('AQID');
  expect(await loadCharacterPortrait(character.id, character.updatedAt)).toBe('AQID');
  expect(binary).toHaveBeenCalledTimes(1);
  await saveCharacter({ ...character, pngBase64: 'BAUG' }); binary.mockClear();
  expect(await loadCharacterPortrait(character.id, character.updatedAt)).toBe('BAUG');
  expect(binary).toHaveBeenCalledTimes(1);
  setActiveVault(createVault(createMemFs()));
  await saveCharacter({ ...character, pngBase64: 'BwgJ' });
  expect(await loadCharacterPortrait(character.id, character.updatedAt)).toBe('BwgJ');
});
