import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { setActiveVault } from '@/lib/vault/active';
import { saveArchiveStory } from '@/lib/archive-db';
import { loadBeautify, saveBeautify } from '@/lib/beautify-store';
import { DEFAULT_BEAUTIFY } from '@/lib/beautify';
import type { ArchiveStory } from '@/types/archive';

beforeEach(async () => {
  closeDB(); setActiveVault(null);
  globalThis.indexedDB = new IDBFactory();
  const session = { id: 'session', title: '故事', user: { name: '我' }, character: { name: '角色' }, messages: [], createdAt: 1 };
  const story: ArchiveStory = { id: 's', title: '故事', session, markers: [], createdAt: 1, updatedAt: 1,
    meta: { modelsUsed: [], playTimeMs: null },
    branches: [{ id: 'b', name: '支线', session: { ...session, id: 'branch' }, markers: [], createdAt: 1, updatedAt: 1 }] };
  await saveArchiveStory(story);
});
describe('beautify persistence', () => {
  it('saves to only the selected branch and rejects stale concurrent edits', async () => {
    const loaded = await loadBeautify('s', 'b');
    const config = { ...DEFAULT_BEAUTIFY, statusEnabled: true, mode: 'floating' as const };
    const saved = await saveBeautify('s', 'b', config, loaded.text);
    expect((await loadBeautify('s', 'b')).config).toEqual(config);
    expect((await loadBeautify('s', null)).config.statusEnabled).toBe(false);
    await expect(saveBeautify('s', 'b', DEFAULT_BEAUTIFY, loaded.text)).rejects.toThrow('已变化');
    expect((await loadBeautify('s', 'b')).text).toBe(saved);
  });
  it('refuses a deleted branch or story', async () => {
    await expect(loadBeautify('s', 'missing')).rejects.toThrow('不存在');
    await expect(saveBeautify('missing', null, DEFAULT_BEAUTIFY, null)).rejects.toThrow('不存在');
  });
});
