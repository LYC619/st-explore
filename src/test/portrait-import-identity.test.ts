import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, saveCharacter, getCharacter } from '@/lib/archive-db';
import { portraitCloudTasks } from '@/lib/portrait-cloud-task';
import { portraitPreviewCache } from '@/lib/portrait-preview-cache';
import { setPortraitAsCard, type PortraitViewItem } from '@/lib/portrait-store';
const api = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/portrait-cloud', async importOriginal => ({ ...await importOriginal<object>(), downloadPortrait: api.download }));
const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1kAAAAASUVORK5CYII='), c => c.charCodeAt(0));
beforeEach(() => { portraitCloudTasks.dismiss(); api.download.mockReset().mockResolvedValue(new File([bytes], '同名.png', { type: 'image/png' })); });
afterEach(() => { portraitCloudTasks.dismiss(); portraitPreviewCache.clearUnused(); setActiveVault(null); vi.unstubAllGlobals(); });
it('explicit reimport downloads updated bytes even while an old preview is cached', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const card = buildCharacterFromCard({ name: '缓存更新角色' });
  card.portraitRows = [{ id: 'one', title: '表情', items: [] }]; await saveCharacter(card);
  const target = { characterId: card.id, characterName: card.name, rowId: 'one', rowTitle: '表情' };
  const link = { name: '同名', url: 'https://files.catbox.moe/cache.png' };
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:preview'; } static revokeObjectURL() {} });
  const preview = portraitPreviewCache.acquire(link);
  try {
    await preview.promise;
    portraitCloudTasks.start(target, [link]);
    await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
    const original = (await getCharacter(card.id))!.portraitRows![0].items[0].importSource!.sha256;
    expect(api.download).toHaveBeenCalledTimes(1);
    api.download.mockResolvedValue(new File([bytes, new Uint8Array([0])], '更新.png', { type: 'image/png' }));
    portraitCloudTasks.start(target, [{ ...link, force: true }]);
    await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
    const items = (await getCharacter(card.id))!.portraitRows![0].items;
    expect(items).toHaveLength(2);
    expect(items[1].importSource!.sha256).not.toBe(original);
    expect(api.download).toHaveBeenCalledTimes(2);
  } finally { preview.release(); }
});
it('explains an AVIF decoder limitation without pretending the bytes are PNG', async () => {
  setActiveVault(null); const card = buildCharacterFromCard({ name: '格式回归' });
  vi.stubGlobal('Image', class { src = ''; decode() { return Promise.reject(new Error('unsupported decoder')); } });
  await expect(setPortraitAsCard(card, { dataBase64: 'AAAAFGZ0eXBhdmlmAAAAAG1pZjE=', mime: 'image/avif' } as PortraitViewItem)).rejects.toThrow(/AVIF.*解码|解码.*AVIF/);
});
it('persists source identity with the image, skips after reopening and permits explicit reimport', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const card = buildCharacterFromCard({ name: '去重角色' }); card.portraitRows = [{ id: 'one', title: '乔伊', items: [] }, { id: 'two', title: 'Andrea', items: [] }]; await saveCharacter(card);
  const target = { characterId: card.id, characterName: card.name, rowId: 'one', rowTitle: '乔伊' };
  const link = { name: '同名', url: 'https://files.catbox.moe/abcd.png', rowId: 'two', rowTitle: 'Andrea' };
  portraitCloudTasks.start(target, [link]); await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
  const saved = (await getCharacter(card.id))!;
  expect(saved.portraitRows?.[1].items[0]).toMatchObject({ importSource: { url: link.url, file: 'abcd.png', sha256: expect.any(String) } });
  expect(saved.portraitRows?.[0].items).toHaveLength(0);
  setActiveVault(createVault(fs));
  portraitCloudTasks.start(target, [link]); await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
  expect(portraitCloudTasks.getSnapshot()?.items[0].status).toBe('skipped'); expect(api.download).toHaveBeenCalledTimes(1);
  portraitCloudTasks.start(target, [{ ...link, force: true }]); await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
  expect((await getCharacter(card.id))?.portraitRows?.[1].items).toHaveLength(2);
});
