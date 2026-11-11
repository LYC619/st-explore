import { afterEach, describe, expect, it } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { listRetainedOperations, prepareFileRemoval, restoreRetainedOperation, scanVaultFiles } from '@/lib/vault/file-maintenance';
import type { ArchiveCharacter } from '@/types/archive';

const card = (id: string): ArchiveCharacter => ({ id, name: id, tags: [], status: '未开始', createdAt: 1, updatedAt: 1, card: { data: { name: id } } as ArchiveCharacter['card'] });
afterEach(() => setActiveVault(null));

describe('existing attachment directory names', () => {
  it.each(['.', ' ', '..', ' .'])('deletes and restores exact legacy names with suffix %j, without blocking other cards', async suffix => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(card('legacy'));
    await vault.repo<ArchiveCharacter>('characters').put(card('ordinary'));
    const dir = (await vault.pathOf('characters', 'legacy'))!;
    const legacy = `${dir}/附件/下载${suffix}/记录.txt${suffix}`;
    const sibling = `${dir}/附件/下载/记录.txt`;
    await fs.writeText(legacy, 'legacy-exact');
    await fs.writeText(sibling, 'ordinary-distinct');
    // A path elsewhere in the vault used to block every character's deletion.
    await vault.repo('characters').remove('ordinary', { deleteFiles: true });
    expect(await fs.readText(legacy)).toBe('legacy-exact');
    expect((await prepareFileRemoval(vault, 'characters', 'legacy')).files.map(f => f.path)).toContain(legacy);
    await vault.repo('characters').remove('legacy', { deleteFiles: true });
    expect((await fs.stat(legacy)).exists).toBe(false);
    const retained = (await listRetainedOperations(vault)).find(item => item.title === 'legacy')!;
    expect(retained.restorable).toBe(true);
    expect(retained.paths).toContain(legacy);
    await restoreRetainedOperation(vault, retained.operationId);
    expect(await fs.readText(legacy)).toBe('legacy-exact');
    expect(await fs.readText(sibling)).toBe('ordinary-distinct');
    expect(await createVault(fs).repo('characters').get('legacy')).toMatchObject({ id: 'legacy' });
  });

  it('keeps a legacy attachment referenced by another active record', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(card('owner'));
    const shared = `${await vault.pathOf('characters', 'owner')}/附件/资料./图片.png`;
    await fs.writeText(shared, 'shared');
    await vault.repo<ArchiveCharacter & { media: string }>('characters').put({ ...card('other'), media: shared });
    await vault.repo('characters').remove('owner', { deleteFiles: false });
    expect(await fs.readText(shared)).toBe('shared');
  });

  it.each(['..', '../escape', 'bad\\path', 'bad:stream', 'NUL.', 'CON ', '...', '   ', 'bad\u0000name'])('still blocks unsafe entry %j before moving files', async name => {
    const mem = createMemFs(); let armed = false, moves = 0;
    const fs: VaultFs = { ...mem,
      list: async dir => [...await mem.list(dir), ...(armed && dir === '' ? [{ name, isDir: true, size: 0 }] : [])],
      rename: async (from, to) => { moves++; return mem.rename(from, to); },
    };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(card('safe'));
    armed = true; moves = 0;
    expect((await scanVaultFiles(vault)).complete).toBe(false);
    await expect(vault.repo('characters').remove('safe', { deleteFiles: true })).rejects.toThrow('文件检查未完成');
    expect(moves).toBe(0);
  });

  it('still blocks a symlink with a legacy-looking name', async () => {
    const mem = createMemFs(), fs: VaultFs = { ...mem, list: async dir => [...await mem.list(dir), ...(dir === '' ? [{ name: 'link.', isDir: true, isSymlink: true, size: 0 }] : [])] };
    expect((await scanVaultFiles(createVault(fs))).complete).toBe(false);
  });

});
