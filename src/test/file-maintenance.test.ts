import { afterEach, describe, expect, it } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import * as maintenance from '@/lib/vault/file-maintenance';
import { serializeFrontmatter } from '@/lib/vault/frontmatter';
import type { SummaryItem } from '@/types/summary';

const character = (id = 'c'): ArchiveCharacter => ({ id, name: id, card: { data: { name: id } } as ArchiveCharacter['card'], tags: [], status: '未开始', createdAt: 1, updatedAt: 1 });
const story = (): ArchiveStory => ({ id: 's', title: '故事', session: { id: 'session', title: '故事', messages: [], character: { name: 'c' }, user: { name: 'u' }, createdAt: 1, rawMetadata: {} }, markers: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1 });
afterEach(() => setActiveVault(null));

describe('vault file lifecycle', () => {
  it('retains owned files without reindexing them on restart and preserves unknown files', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put({ ...character(), pngBase64: 'YQ==' });
    const dir = (await vault.pathOf('characters', 'c'))!;
    await fs.writeText(`${dir}/私有笔记.txt`, 'mine');
    await vault.repo('characters').remove('c', { deleteFiles: false });
    expect(Object.keys(fs.dump()).some(path => path.startsWith('.ste/retained/') && path.endsWith('/档案.json'))).toBe(true);
    expect(await createVault(fs).repo('characters').list()).toEqual([]);
    expect(await fs.readText(`${dir}/私有笔记.txt`)).toBe('mine');
  });

  it('rolls back a partially moved operation and keeps the record readable', async () => {
    const mem = createMemFs(); let moves = 0;
    const fs: VaultFs = { ...mem, rename: async (from, to) => { if (to.includes('/files/') && ++moves === 2) throw new Error('disk full'); await mem.rename(from, to); } };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put({ ...character(), pngBase64: 'YQ==' });
    await expect(vault.repo('characters').remove('c', { deleteFiles: false })).rejects.toThrow('disk full');
    expect(await createVault(mem).repo('characters').get('c')).toMatchObject({ id: 'c', pngBase64: 'YQ==' });
  });

  it('removes managed portrait and attachment files but never sourcePath or user strays', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    const c = { ...character(), sourcePath: '外部/原卡.png', portraitRows: [{ id: 'row', title: '默认', items: [{ id: 'p', source: 'manual' as const, fileName: 'a.png', addedAt: 1 }] }], attachments: [{ id: 'a', title: 'a', path: '附件/a.txt', pathBase: 'character' as const, size: 1, addedAt: 1 }] };
    await vault.repo<ArchiveCharacter>('characters').put(c);
    const dir = (await vault.pathOf('characters', 'c'))!;
    await fs.writeBinary(`${dir}/立绘/默认/a.png`, 'YQ==');
    await fs.writeText(`${dir}/附件/a.txt`, 'owned');
    await fs.writeText(`${dir}/立绘/默认/user.txt`, 'user');
    await fs.writeBinary('外部/原卡.png', 'YQ==');
    await vault.repo('characters').remove('c', { deleteFiles: true });
    expect((await fs.stat(`${dir}/立绘/默认/a.png`)).exists).toBe(false);
    expect((await fs.stat(`${dir}/附件/a.txt`)).exists).toBe(false);
    expect((await fs.stat('外部/原卡.png')).exists).toBe(true);
    expect(await fs.readText(`${dir}/立绘/默认/user.txt`)).toBe('user');
  });

  it('preserves valid unbound stories and only removes owned story runtime files', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveStory>('archiveStories').put(story());
    const dir = (await vault.pathOf('archiveStories', 's'))!;
    await fs.writeText(`${dir}/memory/main/state.md`, '---\nowner: manual\n---\nstate');
    await fs.writeText(`${dir}/memory/readme.txt`, 'mine');
    await vault.repo('archiveStories').remove('s', { deleteFiles: false });
    expect((await fs.stat(`${dir}/memory/main/state.md`)).exists).toBe(false);
    expect(await fs.readText(`${dir}/memory/readme.txt`)).toBe('mine');
  });

  it('recovers an interrupted rollback before rebuilding the index after restart', async () => {
    const mem = createMemFs(); let moves = 0;
    const fs: VaultFs = { ...mem, rename: async (from, to) => {
      if (to.includes('/files/') && ++moves === 2 || from.includes('/files/')) throw new Error('device offline');
      await mem.rename(from, to);
    } };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put({ ...character(), pngBase64: 'YQ==' });
    await expect(vault.repo('characters').remove('c', { deleteFiles: false })).rejects.toThrow('恢复未完成');
    expect(await createVault(mem).repo('characters').get('c')).toMatchObject({ id: 'c', pngBase64: 'YQ==' });
  });

  it('reports a failed trash operation and exposes the remaining retained files', async () => {
    const mem = createMemFs(), fs: VaultFs = { ...mem, trashFile: async () => { throw new Error('trash offline'); } };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(character());
    await expect(vault.repo('characters').remove('c', { deleteFiles: true })).rejects.toThrow('部分文件仍保留');
    expect(await vault.repo('characters').get('c')).toBeUndefined();
    expect(await createVault(mem).repo('characters').get('c')).toBeUndefined();
    const scan = await maintenance.scanVaultFiles(createVault(mem));
    const paths = scan.entries.filter(entry => entry.category === 'retained').map(entry => entry.path);
    expect(paths).toHaveLength(1);
    expect((await maintenance.cleanupVaultFiles(scan, paths)).removed).toEqual(paths);
  });

  it('keeps shared managed images referenced by another record', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    const a = { ...character(), portraitRows: [{ id: 'row', title: '默认', items: [{ id: 'p', source: 'manual' as const, fileName: 'a.png', addedAt: 1 }] }] };
    await vault.repo<ArchiveCharacter>('characters').put(a);
    const path = `${await vault.pathOf('characters', 'c')}/立绘/默认/a.png`;
    await fs.writeBinary(path, 'YQ==');
    await vault.repo<ArchiveCharacter & { customMediaPath: string }>('characters').put({ ...character('other'), customMediaPath: path });
    await vault.repo('characters').remove('c', { deleteFiles: true });
    expect((await fs.stat(path)).exists).toBe(true);
  });

  it('stops and restores staged files if the vault changes during deletion', async () => {
    const mem = createMemFs(); let switched = false;
    const fs: VaultFs = { ...mem, rename: async (from, to) => {
      await mem.rename(from, to);
      if (!switched && to.includes('/files/')) { switched = true; setActiveVault(createVault(createMemFs())); }
    } };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put({ ...character(), pngBase64: 'YQ==' });
    await expect(vault.repo('characters').remove('c', { deleteFiles: false })).rejects.toThrow('切换');
    expect(await createVault(mem).repo('characters').get('c')).toMatchObject({ id: 'c', pngBase64: 'YQ==' });
  });

  it('does not start deletion if the vault switches while building its file preview', async () => {
    const mem = createMemFs(); let armed = false;
    const fs: VaultFs = { ...mem, readText: async path => {
      const value = await mem.readText(path);
      if (armed && path.endsWith('档案.json')) { armed = false; setActiveVault(createVault(createMemFs())); }
      return value;
    } };
    const vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(character());
    armed = true;
    await expect(vault.repo('characters').remove('c', { deleteFiles: false })).rejects.toThrow('切换');
    expect(await createVault(mem).repo('characters').get('c')).toMatchObject({ id: 'c' });
  });
});

describe('file maintenance checks', () => {
  it('leaves standalone assets and unbound records valid, lists unknown files view-only', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveStory>('archiveStories').put(story());
    await fs.writeText('资产/世界书/valid.json', JSON.stringify({ __ste: { id: 'w', title: 'w', updatedAt: 1 }, entries: {} }));
    await fs.writeText('backup.zip', 'backup');
    await fs.writeText('用户笔记.txt', 'notes');
    const scan = await maintenance.scanVaultFiles(vault);
    expect(scan.complete).toBe(true);
    expect(scan.entries.filter(entry => entry.selectable)).toEqual([]);
    expect(scan.entries.map(entry => entry.path)).toEqual(['backup.zip', '用户笔记.txt']);
  });

  it('revalidates same-size file changes and new references before cleaning', async () => {
    const fs = createMemFs(), vault = createVault(fs), c = character();
    await vault.repo<ArchiveCharacter>('characters').put(c);
    const dir = (await vault.pathOf('characters', c.id))!;
    const name = '.ste-portrait-00000000-0000-0000-0000-000000000001-0.png';
    const path = `${dir}/立绘/默认/${name}`;
    await fs.writeBinary(path, 'YQ==');
    let scan = await maintenance.scanVaultFiles(vault);
    expect(scan.entries.find(entry => entry.path === path)?.category).toBe('unreferenced');
    await fs.writeBinary(path, 'Yg==');
    expect((await maintenance.cleanupVaultFiles(scan, [path])).skipped).toHaveLength(1);
    scan = await maintenance.scanVaultFiles(vault);
    await vault.repo<ArchiveCharacter>('characters').put({ ...c, portraitRows: [{ id: 'row', title: '默认', items: [{ id: 'p', source: 'manual', fileName: name, addedAt: 1 }] }] });
    expect((await maintenance.cleanupVaultFiles(scan, [path])).skipped).toHaveLength(1);
    expect((await fs.stat(path)).exists).toBe(true);
  });

  it('skips a retained file if a live record starts referencing it after scanning', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveCharacter>('characters').put(character());
    await vault.repo('characters').remove('c', { deleteFiles: false });
    const scan = await maintenance.scanVaultFiles(vault);
    const path = scan.entries.find(entry => entry.category === 'retained')!.path;
    await vault.repo<ArchiveCharacter & { customFilePath: string }>('characters').put({ ...character('other'), customFilePath: path });
    expect((await maintenance.cleanupVaultFiles(scan, [path])).skipped).toHaveLength(1);
    expect((await fs.stat(path)).exists).toBe(true);
  });

  it('blocks cleanup after a corrupt record, symlink or switched vault', async () => {
    const mem = createMemFs(), vault = createVault(mem);
    await mem.writeText('角色/坏/档案.json', '{');
    expect((await maintenance.scanVaultFiles(vault)).complete).toBe(false);
    const linked = createVault({ ...mem, list: async path => path === '' ? [{ name: 'linked', isDir: true, isSymlink: true, size: 0 }] : mem.list(path) });
    expect((await maintenance.scanVaultFiles(linked)).complete).toBe(false);
    await mem.removeFile('角色/坏/档案.json');
    const scan = await maintenance.scanVaultFiles(vault);
    setActiveVault(createVault(createMemFs()));
    await expect(maintenance.cleanupVaultFiles(scan, [])).rejects.toThrow('切换');
  });

  it('treats duplicate record identities as incomplete rather than deleting an arbitrary copy', async () => {
    const fs = createMemFs();
    await fs.writeText('角色/a/档案.json', JSON.stringify(character()));
    await fs.writeText('角色/b/档案.json', JSON.stringify(character()));
    expect((await maintenance.scanVaultFiles(createVault(fs))).complete).toBe(false);
  });

  it('never treats a managed-looking image inside a backup as garbage', async () => {
    const fs = createMemFs();
    await fs.writeBinary('备份/角色/c/立绘/默认/.ste-portrait-00000000-0000-0000-0000-000000000001-0.png', 'YQ==');
    const scan = await maintenance.scanVaultFiles(createVault(fs));
    expect(scan.entries.filter(entry => entry.selectable)).toEqual([]);
  });

  it('blocks a malformed committed memory journal as well as pending journals', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    await vault.repo<ArchiveStory>('archiveStories').put(story());
    const dir = await vault.pathOf('archiveStories', 's');
    await fs.writeText(`${dir}/.ste-control/roleplay/main/memory-journal/${'a'.repeat(64)}.json`, JSON.stringify({ schema: 1, status: 'committed' }));
    expect((await maintenance.scanVaultFiles(vault)).complete).toBe(false);
  });

  it('finishes portrait retention idempotently after metadata has committed', async () => {
    expect(typeof maintenance.finalizeRetainedFiles).toBe('function');
    const fs = createMemFs(), path = '角色/c/立绘/默认/a.png';
    await fs.writeBinary(path, 'YQ==');
    const options = { operationId: '00000000-0000-0000-0000-000000000001', store: 'characters' as const, id: 'c', paths: [path], deleteFiles: false };
    await maintenance.finalizeRetainedFiles(fs, options);
    await maintenance.finalizeRetainedFiles(fs, options);
    expect((await fs.stat(path)).exists).toBe(false);
    expect((await maintenance.scanVaultFiles(createVault(fs))).entries.find(entry => entry.category === 'retained')).toBeDefined();
  });

  it('publishes staged child summaries into the live backend index', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    const dir = `.ste-control/story-packages/${'a'.repeat(64)}/story`;
    await fs.writeText(`${dir}/故事.json`, JSON.stringify(story()));
    await fs.writeText(`${dir}/分卷总结·记录.md`, serializeFrontmatter({ id: 'sum', bookId: 's', updatedAt: 1 }, 'body'));
    await vault.publishStoryDirectory!('s', dir);
    expect(await vault.repo('summaries').get('sum')).toMatchObject({ id: 'sum' });
  });

  it('does not leave two summary identities when a move fails after target publication', async () => {
    const mem = createMemFs(); let fail = false;
    const fs: VaultFs = { ...mem, rename: async (from, to) => { if (fail && to.endsWith('.md') && to.includes('/目标/')) throw new Error('move failed'); await mem.rename(from, to); }, removeFile: async path => { if (fail && path.includes('/记录/')) throw new Error('move failed'); await mem.removeFile(path); } };
    const vault = createVault(fs);
    await vault.repo<ArchiveStory>('archiveStories').put({ ...story(), title: '目标' });
    const summary = { id: 'sum', bookId: null, title: '记录', kind: 'volume', content: 'body', updatedAt: 1 } as unknown as SummaryItem;
    await vault.repo<SummaryItem>('summaries').put(summary);
    fail = true;
    await expect(vault.repo<SummaryItem>('summaries').put({ ...summary, bookId: 's' })).rejects.toThrow();
    expect(Object.keys(mem.dump()).filter(path => path.endsWith('.md'))).toHaveLength(1);
    expect((await createVault(mem).repo<SummaryItem>('summaries').list())).toHaveLength(1);
    expect((await createVault(mem).repo<SummaryItem>('summaries').get('sum'))?.bookId).toBeNull();
  });
});
