import { afterEach, expect, it, vi } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard } from '@/lib/archive-db';
import type { ArchiveCharacter } from '@/types/archive';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VaultRecycleMaintenance } from '@/components/vault/VaultRecycleMaintenance';
import { sha256 } from 'js-sha256';
import * as maintenance from '@/lib/vault/file-maintenance';

const day = 24 * 60 * 60 * 1000;
const time = new Date('2026-10-23T08:00:00Z').getTime();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); setActiveVault(null); });

async function setup(trash = true) {
  const mem = createMemFs();
  const trashFile = vi.fn(async (path: string) => mem.removeFile(path));
  const fs: VaultFs = { ...mem, trashFile: trash ? trashFile : undefined };
  const vault = createVault(fs); setActiveVault(vault);
  vi.spyOn(Date, 'now').mockReturnValue(time);
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: 'c' }), id: 'c' });
  return { fs, mem, vault, trashFile };
}

it('stages a deletion immediately, then recycles only after that file has spent 30 days in the vault', async () => {
  const { vault, fs, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  expect(trashFile).not.toHaveBeenCalled();
  expect(await createVault(fs).repo('characters').list()).toEqual([]);
  const scan = await maintenance.scanVaultFiles(vault);
  const file = scan.entries.find(entry => entry.category === 'retained')!;
  expect(file).toMatchObject({ recycleAfter: time + 30 * day });
  await maintenance.recycleExpiredFiles(vault, time + 30 * day - 1);
  expect(trashFile).not.toHaveBeenCalled();
  const result = await maintenance.recycleExpiredFiles(vault, time + 30 * day);
  expect(result.removed).toEqual([file.path]);
  expect(trashFile).toHaveBeenCalledTimes(1);
});

it('never expires a file retained by choice', async () => {
  const { vault, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: false });
  await maintenance.recycleExpiredFiles(vault, time + 365 * day);
  expect(trashFile).not.toHaveBeenCalled();
  expect((await maintenance.scanVaultFiles(vault)).entries.some(entry => entry.category === 'retained')).toBe(true);
});

it('does not assign an automatic deadline to legacy committed deletions', async () => {
  const { vault, fs, mem, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  const path = Object.keys(mem.dump()).find(path => path.endsWith('/manifest.json'))!;
  const legacy = JSON.parse(await fs.readText(path)); delete legacy.recycleAfter;
  await fs.writeText(path, JSON.stringify(legacy));
  await fs.writeText(path.replace('manifest.json', 'committed.json'), JSON.stringify({ digest: sha256(JSON.stringify(legacy)) }));
  await maintenance.recycleExpiredFiles(vault, time + 365 * day);
  expect(trashFile).not.toHaveBeenCalled();
  expect((await maintenance.scanVaultFiles(vault)).entries.find(entry => entry.category === 'retained')?.recycleAfter).toBeUndefined();
});

it('only expires the earlier deletion and leaves the later file for its own deadline', async () => {
  const { vault, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  vi.mocked(Date.now).mockReturnValue(time + 10 * day);
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: 'later' }), id: 'later' });
  await vault.repo('characters').remove('later', { deleteFiles: true });
  const result = await maintenance.recycleExpiredFiles(vault, time + 31 * day);
  expect(result.removed).toHaveLength(1);
  expect(trashFile.mock.calls[0][0]).toContain('/角色/c/');
  expect((await maintenance.scanVaultFiles(vault)).entries.filter(entry => entry.category === 'retained')).toHaveLength(1);
});

it('checks after opening and stops its timer when switching away from the vault', async () => {
  const { vault, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  vi.mocked(Date.now).mockRestore();
  vi.useFakeTimers(); vi.setSystemTime(time + 31 * day);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(VaultRecycleMaintenance)));
  expect(trashFile).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(trashFile).toHaveBeenCalledTimes(1);
  await act(async () => setActiveVault(null));
  expect(vi.getTimerCount()).toBe(0);
});

it('leaves expired files intact if the vault switches during reference checks', async () => {
  const { vault, fs, mem, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: 'live' }), id: 'live' });
  const switched = createVault({ ...fs, readText: async path => {
    const content = await mem.readText(path);
    if (path === '角色/live/档案.json') setActiveVault(null);
    return content;
  } });
  setActiveVault(switched);
  await expect(maintenance.recycleExpiredFiles(switched, time + 31 * day)).rejects.toThrow('切换');
  expect(trashFile).not.toHaveBeenCalled();
});

it('blocks an expired operation when its staging directory has become a link', async () => {
  const { vault, fs, mem, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  const linked = createVault({ ...fs, list: async path => (await mem.list(path)).map(entry =>
    path === '.ste/retained' ? { ...entry, isSymlink: true } : entry) });
  setActiveVault(linked);
  await expect(maintenance.recycleExpiredFiles(linked, time + 31 * day)).rejects.toThrow('无法确认');
  expect(trashFile).not.toHaveBeenCalled();
});

it('keeps files on unsupported platforms and retries a system trash failure on a later check', async () => {
  const { vault, fs, mem } = await setup(false);
  await vault.repo('characters').remove('c', { deleteFiles: true });
  const file = (await maintenance.scanVaultFiles(vault)).entries.find(entry => entry.category === 'retained')!;
  await maintenance.recycleExpiredFiles(vault, time + 40 * day);
  expect((await fs.stat(file.path)).exists).toBe(true);
  const trashFile = vi.fn().mockRejectedValueOnce(new Error('trash offline')).mockImplementation((path: string) => mem.removeFile(path));
  const desktop = createVault({ ...mem, trashFile }); setActiveVault(desktop);
  const failed = await maintenance.recycleExpiredFiles(desktop, time + 40 * day);
  expect(failed.failed).toHaveLength(1);
  expect((await fs.stat(file.path)).exists).toBe(true);
  expect((await maintenance.recycleExpiredFiles(desktop, time + 41 * day)).removed).toEqual([file.path]);
});

it('records partial recycling success and retries only the remaining files', async () => {
  const { vault, mem, trashFile } = await setup();
  await vault.repo<ArchiveCharacter>('characters').put({ ...buildCharacterFromCard({ name: 'c' }), id: 'c', pngBase64: 'YQ==' });
  await vault.repo('characters').remove('c', { deleteFiles: true });
  trashFile.mockImplementationOnce(path => mem.removeFile(path)).mockRejectedValueOnce(new Error('second file unavailable'));
  const first = await maintenance.recycleExpiredFiles(vault, time + 31 * day);
  expect(first.removed).toHaveLength(1); expect(first.failed).toHaveLength(1);
  const second = await maintenance.recycleExpiredFiles(vault, time + 32 * day);
  expect(second.removed).toEqual(first.failed.map(item => item.path));
  expect(trashFile).toHaveBeenCalledTimes(3);
});

it('skips changed and newly referenced recycled files', async () => {
  const { vault, fs, trashFile } = await setup();
  await vault.repo('characters').remove('c', { deleteFiles: true });
  const file = (await maintenance.scanVaultFiles(vault)).entries.find(entry => entry.category === 'retained')!;
  await vault.repo<ArchiveCharacter & { customPath: string }>('characters').put({ ...buildCharacterFromCard({ name: 'other' }), id: 'other', customPath: file.path });
  await maintenance.recycleExpiredFiles(vault, time + 40 * day);
  expect(trashFile).not.toHaveBeenCalled();
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: 'other' }), id: 'other' });
  await fs.writeText(file.path, 'changed');
  await maintenance.recycleExpiredFiles(vault, time + 40 * day);
  expect(trashFile).not.toHaveBeenCalled();
});

it('previews a batch with one shared record inventory', async () => {
  const mem = createMemFs();
  const readText = vi.fn((path: string) => mem.readText(path));
  const fs = { ...mem, readText }, vault = createVault(fs);
  for (const id of ['a', 'b', 'c']) await vault.repo('characters').put({ ...buildCharacterFromCard({ name: id }), id });
  readText.mockClear();
  await Promise.all(['a', 'b'].map(id => maintenance.prepareFileRemoval(vault, 'characters', id)));
  expect(readText.mock.calls.filter(([path]) => path === '角色/c/档案.json')).toHaveLength(2);
  readText.mockClear();
  const previews = await maintenance.prepareFileRemovals(vault, ['a', 'b'].map(id => ({ store: 'characters', id })));
  expect(previews.map(preview => preview.count)).toEqual([1, 1]);
  expect(readText.mock.calls.filter(([path]) => path === '角色/c/档案.json')).toHaveLength(1);
});
