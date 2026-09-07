import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveCharacter, AttachedFile } from '@/types/archive';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCharacter, saveCharacter, updateCharacter } from '@/lib/archive-db';
import { getAttachmentPath, loadAttachmentViews, openAttachmentExternally, readAttachment, removeAttachment } from '@/lib/attachment-store';

const dir = '角色/A';
const attachment: AttachedFile = { id: 'file', title: 'Guide', path: `${dir}/附件/guide.txt`, size: 5, addedAt: 1 };
const character: ArchiveCharacter = {
  id: 'a', name: 'A', card: { name: 'A' }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1,
  attachments: [attachment],
};

async function fixture() {
  const base = createMemFs();
  const control = { failDelete: false, failProfile: false };
  const fs: VaultFs = {
    ...base,
    openPath: vi.fn(async () => {}),
    trashFile: vi.fn(async path => {
      if (control.failDelete) throw { code: 'permission-denied', path, message: 'locked' };
      await base.removeFile(path);
    }),
    async writeText(path, content) {
      if (control.failProfile && path.endsWith('/档案.json')) throw new Error('profile failure');
      await base.writeText(path, content);
    },
  };
  const vault = createVault(fs);
  setActiveVault(vault);
  await saveCharacter(structuredClone(character));
  await base.writeText(attachment.path, 'first');
  return { base, fs, vault, control };
}

afterEach(() => { setActiveVault(null); vi.restoreAllMocks(); });

describe('attachment identity and persistence boundaries', () => {
  it('uses the renamed directory after reopening when another character reuses the old name', async () => {
    const { base, fs } = await fixture();
    await updateCharacter('a', () => ({ name: 'A2' }));
    await saveCharacter({ ...character, id: 'b' });
    await base.writeText(attachment.path, 'second');
    setActiveVault(createVault({ ...fs }));
    const path = '角色/A2/附件/guide.txt';
    expect(await getAttachmentPath('a', 'file')).toBe(path);
    expect((await readAttachment('a', 'file')).text).toBe('first');
    await openAttachmentExternally('a', 'file');
    expect(fs.openPath).toHaveBeenCalledWith(path, false);
    await removeAttachment('a', 'file', true);
    expect(await base.readText(attachment.path)).toBe('second');
    expect((await base.stat(path)).exists).toBe(false);
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter('a'))?.attachments).toEqual([]);
    expect((await getCharacter('b'))?.attachments).toHaveLength(1);
  });

  it('never falls back to a reused old directory when the current file is missing', async () => {
    const { base, fs } = await fixture();
    await updateCharacter('a', () => ({ name: 'A2' }));
    await base.removeFile('角色/A2/附件/guide.txt');
    await saveCharacter({ ...character, id: 'b' });
    await base.writeText(attachment.path, 'second');
    setActiveVault(createVault({ ...fs }));
    await expect(readAttachment('a', 'file')).rejects.toMatchObject({ code: 'not-found' });
    await expect(openAttachmentExternally('a', 'file')).rejects.toMatchObject({ code: 'not-found' });
    await expect(removeAttachment('a', 'file', true)).rejects.toMatchObject({ code: 'not-found' });
    expect(fs.openPath).not.toHaveBeenCalled();
    expect(fs.trashFile).not.toHaveBeenCalled();
    expect(await base.readText(attachment.path)).toBe('second');
    expect((await getCharacter('a'))?.attachments).toHaveLength(1);
  });

  it('keeps the record on a physical deletion failure', async () => {
    const { base, fs, control } = await fixture();
    control.failDelete = true;
    await expect(removeAttachment('a', 'file', true)).rejects.toMatchObject({ code: 'permission-denied', message: 'locked' });
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter('a'))?.attachments).toHaveLength(1);
    expect(await base.readText(attachment.path)).toBe('first');
  });

  it('reports partial deletion and permits explicit record-only removal after a profile failure', async () => {
    const { base, fs, control } = await fixture();
    control.failProfile = true;
    await expect(removeAttachment('a', 'file', true)).rejects.toMatchObject({ code: 'attachment-metadata-failed' });
    expect((await base.stat(attachment.path)).exists).toBe(false);
    control.failProfile = false;
    setActiveVault(createVault({ ...fs }));
    const current = (await getCharacter('a'))!;
    expect(current.attachments).toHaveLength(1);
    expect((await loadAttachmentViews(current))[0].missing).toBe(true);
    await removeAttachment('a', 'file', false);
    expect((await getCharacter('a'))?.attachments).toEqual([]);
    expect(fs.trashFile).toHaveBeenCalledTimes(1);
  });

  it('uses one captured vault for the entire read and external-open operation', async () => {
    const a = await fixture();
    const b = await fixture();
    await updateCharacter('a', () => ({ name: 'B' }));
    await b.base.writeText('角色/B/附件/guide.txt', 'second');
    const pathOf = a.vault.pathOf.bind(a.vault);
    vi.spyOn(a.vault, 'pathOf').mockImplementation(async (store, id) => {
      const path = await pathOf(store, id);
      setActiveVault(b.vault);
      return path;
    });
    setActiveVault(a.vault);
    expect((await readAttachment('a', 'file')).text).toBe('first');
    setActiveVault(a.vault);
    await openAttachmentExternally('a', 'file');
    expect(a.fs.openPath).toHaveBeenCalledWith(attachment.path, false);
    expect(b.fs.openPath).not.toHaveBeenCalled();
  });

  it('deletes using the original vault and fresh record after a queued rename', async () => {
    const a = await fixture();
    const b = await fixture();
    setActiveVault(a.vault);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const rename = updateCharacter('a', async () => { await barrier; return { name: 'A2' }; });
    const deletion = removeAttachment('a', 'file', true);
    setActiveVault(b.vault);
    release();
    await rename;
    await deletion;
    expect(a.fs.trashFile).toHaveBeenCalledWith('角色/A2/附件/guide.txt');
    expect(await b.base.readText(attachment.path)).toBe('first');
    expect(b.fs.trashFile).not.toHaveBeenCalled();
  });

  it.each(['read', 'open', 'reveal'] as const)('holds the character queue through attachment %s', async action => {
    const { base, fs } = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const access = async (path: string) => {
      entered();
      await barrier;
      return base.readText(path);
    };
    const readText = fs.readText.bind(fs);
    vi.spyOn(fs, 'readText').mockImplementation(path => path === attachment.path ? access(path) : readText(path));
    let opened: string | undefined;
    vi.spyOn(fs, 'openPath').mockImplementation(async path => { opened = await access(path); });
    const operation = (action === 'read' ? readAttachment('a', 'file') : openAttachmentExternally('a', 'file', action === 'reveal'))
      .then(value => ({ value }), error => ({ error }));
    await started;
    let renameStarted = false;
    const rename = updateCharacter('a', () => { renameStarted = true; return { name: 'A2' }; });
    const reuse = rename.then(async () => {
      await saveCharacter({ ...character, id: 'b' });
      await base.writeText(attachment.path, 'second');
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    const overlapped = renameStarted;
    release();
    const result = await operation;
    await reuse;
    expect(overlapped).toBe(false);
    expect(result).not.toHaveProperty('error');
    if (action === 'read') expect(result).toHaveProperty('value.text', 'first');
    else expect(opened).toBe('first');
    await expect(removeAttachment('a', 'file', true)).resolves.toHaveProperty('attachments', []);
    expect(await base.readText(attachment.path)).toBe('second');
  });

  it('waits for a queued rename before resolving an attachment', async () => {
    const { fs } = await fixture();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const rename = updateCharacter('a', async () => { await barrier; return { name: 'A2' }; });
    const list = vi.spyOn(fs, 'list');
    const reading = readAttachment('a', 'file');
    await new Promise(resolve => setTimeout(resolve, 0));
    const resolvedEarly = list.mock.calls.some(([path]) => path === `${dir}/附件`);
    release();
    await rename;
    expect((await reading).path).toBe('角色/A2/附件/guide.txt');
    expect(resolvedEarly).toBe(false);
  });

  it('selects image decoding by the resolved basename, not the editable display title', async () => {
    const { base } = await fixture();
    await updateCharacter('a', () => ({ attachments: [{ ...attachment, path: '附件/cover.png', pathBase: 'character' }] }));
    await base.writeBinary(`${dir}/附件/cover.png`, btoa('image'));
    expect((await readAttachment('a', 'file')).base64).toBe(btoa('image'));
  });

  it('does not read an attachment that has grown beyond its preview budget', async () => {
    const { base, fs } = await fixture();
    await base.writeText(attachment.path, 'x'.repeat(600 * 1024));
    const read = vi.spyOn(fs, 'readText');
    await expect(readAttachment('a', 'file')).rejects.toThrow(/预览/);
    expect(read.mock.calls.some(([path]) => path === attachment.path)).toBe(false);
  });

  it.each(['角色/A/附件/nested/guide.txt', 'C:/secret.txt', '角色/../附件/guide.txt', '角色/A/附件/', '/角色/A/附件/guide.txt'])(
    'rejects invalid legacy paths without reading, opening, or deleting: %s', async path => {
      const { fs } = await fixture();
      await updateCharacter('a', () => ({ attachments: [{ ...attachment, path }] }));
      await expect(readAttachment('a', 'file')).rejects.toMatchObject({ code: 'unsafe-path' });
      await expect(openAttachmentExternally('a', 'file')).rejects.toMatchObject({ code: 'unsafe-path' });
      await expect(removeAttachment('a', 'file', true)).rejects.toMatchObject({ code: 'unsafe-path' });
      expect(fs.openPath).not.toHaveBeenCalled();
      expect(fs.trashFile).not.toHaveBeenCalled();
    },
  );

  it.each(['directory', 'link'] as const)('rejects %s targets before byte IO or external calls', async kind => {
    const { fs } = await fixture();
    const list = fs.list.bind(fs);
    vi.spyOn(fs, 'list').mockImplementation(async path => path === `${dir}/附件`
      ? [{ name: 'guide.txt', size: 1, isDir: kind === 'directory', isSymlink: kind === 'link' }]
      : list(path));
    const code = kind === 'directory' ? 'not-file' : 'unsafe-path';
    await expect(readAttachment('a', 'file')).rejects.toMatchObject({ code });
    await expect(openAttachmentExternally('a', 'file')).rejects.toMatchObject({ code });
    await expect(removeAttachment('a', 'file', true)).rejects.toMatchObject({ code });
    expect(fs.openPath).not.toHaveBeenCalled();
    expect(fs.trashFile).not.toHaveBeenCalled();
  });
});
