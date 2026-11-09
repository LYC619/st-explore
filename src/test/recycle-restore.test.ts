import { afterEach, expect, it, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { listRetainedOperations, recycleExpiryLabel, restoreRetainedOperation, recoverFileMaintenance } from '@/lib/vault/file-maintenance';
import { buildCharacterFromCard } from '@/lib/archive-db';
import type { ArchiveCharacter } from '@/types/archive';

afterEach(() => { setActiveVault(null); vi.restoreAllMocks(); });
async function fixture() {
  const mem = createMemFs();
  const fs = { ...mem, readBinary: vi.fn(mem.readBinary), fingerprint: vi.fn(async (path: string) => {
    try { return sha256(Uint8Array.from(atob(await mem.readBinary(path)), c => c.charCodeAt(0))); }
    catch { return sha256(await mem.readText(path)); }
  }) };
  const vault = createVault(fs); setActiveVault(vault);
  await vault.repo<ArchiveCharacter>('characters').put({ ...buildCharacterFromCard({ name: '合成角色' }), id: 'fixture', pngBase64: 'YQ==' });
  const before = await mem.readText('角色/合成角色/档案.json');
  fs.readBinary.mockClear();
  await vault.repo('characters').remove('fixture', { deleteFiles: true });
  return { fs, mem, vault, before };
}
it('moves bytes without frontend binary reads, lists without bodies, and restores readable records', async () => {
  const { fs, vault, before, mem } = await fixture();
  expect(fs.readBinary).not.toHaveBeenCalled();
  fs.fingerprint.mockClear();
  const [entry] = await listRetainedOperations(vault);
  expect(entry.paths).toHaveLength(2);
  expect(fs.fingerprint).not.toHaveBeenCalled();
  await restoreRetainedOperation(vault, entry.operationId);
  expect(await mem.readText('角色/合成角色/档案.json')).toBe(before);
  expect(await vault.repo('characters').get('fixture')).toMatchObject({ id: 'fixture', pngBase64: 'YQ==' });
  expect(await listRetainedOperations(vault)).toEqual([]);
});
it('names an entry by its record, not its first file, and shows the actual recycle date', async () => {
  const { vault } = await fixture();
  const [entry] = await listRetainedOperations(vault);
  expect(entry).toMatchObject({ store: 'characters', title: '合成角色' });
  const day = 24 * 60 * 60 * 1000;
  expect(recycleExpiryLabel(entry.recycleAfter, entry.createdAt + 3 * day))
    .toBe(`27 天后（${new Date(entry.recycleAfter!).toLocaleDateString('zh-CN')}）移入系统回收站`);
  expect(recycleExpiryLabel(entry.recycleAfter, entry.recycleAfter! + 1)).toBe('已到期，稍后自动移入系统回收站');
  expect(recycleExpiryLabel(undefined)).toBe('长期保留');
});
it('never overwrites an occupied destination and preflights all missing files', async () => {
  const { vault, mem } = await fixture();
  const [entry] = await listRetainedOperations(vault);
  await mem.writeBinary('角色/合成角色/卡片.png', 'Yg==');
  await expect(restoreRetainedOperation(vault, entry.operationId)).rejects.toThrow('原位置');
  expect((await mem.stat('角色/合成角色/档案.json')).exists).toBe(false);
  expect(await mem.readBinary('角色/合成角色/卡片.png')).toBe('Yg==');
  await mem.removeFile('角色/合成角色/卡片.png');
  await mem.removeFile(`.ste/retained/${entry.operationId}/files/角色/合成角色/卡片.png`);
  await expect(restoreRetainedOperation(vault, entry.operationId)).rejects.toThrow('不完整');
  expect((await mem.stat('角色/合成角色/档案.json')).exists).toBe(false);
});
it('resumes an interrupted restore on reopening without losing the other file', async () => {
  const { vault, fs, mem, before } = await fixture();
  const [entry] = await listRetainedOperations(vault);
  const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(mem.rename).mockRejectedValueOnce(Error('synthetic interruption'));
  await expect(restoreRetainedOperation(vault, entry.operationId)).rejects.toThrow('synthetic interruption');
  rename.mockRestore();
  await recoverFileMaintenance(fs);
  expect(await mem.readText('角色/合成角色/档案.json')).toBe(before);
  expect(await mem.readBinary('角色/合成角色/卡片.png')).toBe('YQ==');
});

it('restores legacy base64/text digests even after the native fingerprint capability is added', async () => {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  await vault.repo<ArchiveCharacter>('characters').put({ ...buildCharacterFromCard({ name: 'Legacy' }), id: 'legacy', pngBase64: 'YQ==' });
  await vault.repo('characters').remove('legacy', { deleteFiles: false });
  const [entry] = await listRetainedOperations(vault);
  fs.fingerprint = vi.fn(async () => { throw Error('must use original digest format'); });
  await restoreRetainedOperation(vault, entry.operationId);
  expect(fs.fingerprint).not.toHaveBeenCalled();
  expect(await vault.repo('characters').get('legacy')).toMatchObject({ id: 'legacy', pngBase64: 'YQ==' });
});
