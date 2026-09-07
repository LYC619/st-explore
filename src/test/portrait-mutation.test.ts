import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';
import type { PreparedCharacterMutation } from '@/lib/character-mutation';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { deleteCharacter, getCharacter, saveCharacter, updateCharacter } from '@/lib/archive-db';
import { endPortraitOperation, recoverCharacterJournals, type PortraitMutationJournal } from '@/lib/portrait-journal';
import { loadPortraitViews, loadPortraitImage, movePortraitItemsMutation, replacePortraitItemMutation } from '@/lib/portrait-store';

const oldBytes = btoa('old bytes');
const newBytes = btoa('new bytes');
const replacement = () => new File(['new bytes'], 'new.png', { type: 'image/png' });
const profilePath = '角色/Fixture/档案.json';
const sourcePath = '角色/Fixture/立绘/Day/old.png';
const snapshotPath = '角色/Fixture/立绘/立绘.json';
type Fault = 'journal' | 'temporary' | 'second-temporary' | 'rename' | 'second-rename'
  | 'profile-before' | 'profile-after' | 'snapshot' | 'cleanup' | 'journal-remove' | 'none';

async function fixture() {
  const base = createMemFs();
  const control = { fault: 'none' as Fault, binaryWrites: 0, renames: 0 };
  const fs: VaultFs = {
    ...base,
    async writeText(path, content) {
      if (control.fault === 'journal' && path.includes('/portrait-journal/')) throw new Error('journal failure');
      if (control.fault === 'snapshot' && path === snapshotPath) throw new Error('snapshot failure');
      if (control.fault === 'profile-before' && path === profilePath) throw new Error('profile failure');
      await base.writeText(path, content);
      if (control.fault === 'profile-after' && path === profilePath) throw new Error('post-write failure');
    },
    async writeBinary(path, content) {
      control.binaryWrites++;
      if (control.fault === 'temporary' || control.fault === 'second-temporary' && control.binaryWrites === 2) {
        throw new Error('temporary failure');
      }
      await base.writeBinary(path, content);
    },
    async rename(from, to) {
      control.renames++;
      if (control.fault === 'rename' || control.fault === 'second-rename' && control.renames === 2) {
        throw new Error('rename failure');
      }
      await base.rename(from, to);
    },
    async removeFile(path) {
      if (control.fault === 'cleanup' && path === sourcePath) throw new Error('cleanup failure');
      if (control.fault === 'journal-remove' && path.includes('/portrait-journal/')) throw new Error('journal remove failure');
      await base.removeFile(path);
    },
  };
  const c: ArchiveCharacter = {
    id: 'fixture', name: 'Fixture', card: { name: 'Fixture' }, tags: [], status: '未开始',
    createdAt: 1, updatedAt: 1, portraitRows: [
      { id: 'day', title: 'Day', items: [
        { id: 'p1', source: 'manual', fileName: 'old.png', dataBase64: btoa('stale inline'), mime: 'image/png', addedAt: 1 },
        { id: 'p2', source: 'manual', fileName: 'other.png', mime: 'image/png', addedAt: 1 },
      ] },
      { id: 'night', title: 'Night', items: [] },
    ],
  };
  setActiveVault(createVault(fs));
  await saveCharacter(c);
  await base.writeBinary(sourcePath, oldBytes);
  await base.writeBinary('角色/Fixture/立绘/Day/other.png', btoa('other bytes'));
  await base.writeText(snapshotPath, 'old snapshot');
  return { base, fs, control, c, journals: () => Object.keys(base.dump()).filter(p => p.includes('/portrait-journal/')) };
}

afterEach(() => setActiveVault(null));

describe('portrait prepared mutation persistence', () => {
  it('retains the source through prepare and saves only the patch envelope', async () => {
    const { fs, base, c, journals } = await fixture();
    const saved = await updateCharacter(c.id, async current => {
      const prepared = await replacePortraitItemMutation(current, 'p1', replacement());
      expect(await fs.readBinary(sourcePath)).toBe(oldBytes);
      expect(journals()).toHaveLength(1);
      // Automatic recovery during the active transaction must not remove the new files.
      await getCharacter(c.id);
      const fileName = prepared.patch.portraitRows![0].items[0].fileName!;
      expect(await fs.readBinary(`角色/Fixture/立绘/Day/${fileName}`)).toBe(newBytes);
      return prepared;
    });
    expect(journals()).toHaveLength(0);
    expect((await fs.stat(sourcePath)).exists).toBe(false);
    expect(base.dump()[profilePath]).not.toContain('commitAfterPersist');
    expect(saved?.portraitRows?.[0].items[0].dataBase64).toBeUndefined();
    const view = (await loadPortraitViews(saved!))[0].items.find(item => item.itemId === 'p1')!;
    expect(view.url).toBeUndefined();
    expect(await loadPortraitImage(view)).toBe(`data:image/png;base64,${newBytes}`);
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter(c.id))?.portraitRows).toEqual(saved?.portraitRows);
  });

  it.each(['journal', 'temporary', 'rename', 'profile-before'] as const)('keeps old content when %s fails', async fault => {
    const { c, fs, base, control, journals } = await fixture();
    control.fault = fault;
    await expect(updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement())))
      .rejects.toThrow();
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    expect(JSON.parse(await base.readText(profilePath)).portraitRows).toEqual(c.portraitRows);
    expect(await base.readText(snapshotPath)).toBe('old snapshot');
    control.fault = 'none';
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter(c.id))?.portraitRows).toEqual(c.portraitRows);
    expect(journals()).toHaveLength(0);
    expect(Object.keys(base.dump()).filter(path => path.endsWith('.tmp'))).toEqual([]);
  });

  it('returns the actual saved record when metadata was written before an error', async () => {
    const { c, fs, base, control, journals } = await fixture();
    control.fault = 'profile-after';
    const saved = await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()));
    expect(saved?.portraitRows?.[0].items[0].fileName).not.toBe('old.png');
    control.fault = 'none';
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter(c.id))?.portraitRows).toEqual(saved?.portraitRows);
    expect(JSON.parse(await base.readText(snapshotPath))).toHaveProperty('行');
    expect(journals()).toHaveLength(0);
  });

  it('preserves the operation identity in a blocked file recovery result', async () => {
    const { c, base, journals } = await fixture();
    const prepared = await replacePortraitItemMutation(c, 'p1', replacement());
    const { operationId } = JSON.parse(await base.readText(journals()[0])) as PortraitMutationJournal;
    await base.writeText(profilePath, JSON.stringify({ ...c, portraitRows: [] }));
    const report = await prepared.recoverAfterPersistFailure(async () => undefined);
    expect(report).toMatchObject({ action: 'blocked', operationId });
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    expect(journals()).toHaveLength(1);
  });

  it('exposes character and operation identity on a blocked persistence error', async () => {
    const { c, fs, base, journals } = await fixture();
    const writeText = fs.writeText;
    fs.writeText = async (path, content) => {
      if (path === profilePath) {
        await base.writeText(path, JSON.stringify({ ...JSON.parse(content), portraitRows: [] }));
        throw new Error('ambiguous profile failure');
      }
      return writeText(path, content);
    };
    const result = await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()))
      .catch(error => error);
    const { operationId } = JSON.parse(await base.readText(journals()[0])) as PortraitMutationJournal;
    expect(result).toMatchObject({
      code: 'portrait-recovery-required', characterId: c.id, operationId,
      recovery: { action: 'blocked', operationId },
    });
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    expect(journals()).toHaveLength(1);
  });

  it.each(['cleanup', 'snapshot', 'journal-remove'] as const)('retains a committed journal on %s failure and retries after reopening', async fault => {
    const { c, fs, base, control, journals } = await fixture();
    control.fault = fault;
    const onWarning = vi.fn();
    const saved = await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()), { onWarning });
    expect(saved?.portraitRows?.[0].items[0].fileName).not.toBe('old.png');
    expect(onWarning).toHaveBeenCalledWith({ warnings: expect.arrayContaining([expect.stringContaining('failure')]) });
    expect(journals()).toHaveLength(1);
    expect(JSON.parse(await base.readText(journals()[0])).status).toBe('committed');
    control.fault = 'none';
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter(c.id))?.portraitRows).toEqual(saved?.portraitRows);
    expect(journals()).toHaveLength(0);
    expect((await base.stat(sourcePath)).exists).toBe(false);
    expect(JSON.parse(await base.readText(snapshotPath))).toHaveProperty('行');
  });

  it('does not turn a throwing warning observer into a failed save', async () => {
    const { c, control } = await fixture();
    control.fault = 'cleanup';
    await expect(updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()), {
      onWarning: () => { throw new Error('observer failure'); },
    })).resolves.toHaveProperty('id', c.id);
  });

  it('keeps a committed character readable but gates later mutations until cleanup succeeds', async () => {
    const { c, base, control, journals } = await fixture();
    control.fault = 'cleanup';
    const onWarning = vi.fn();
    const saved = await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()), { onWarning });
    expect(saved).toBeDefined();
    expect(onWarning).toHaveBeenCalled();
    expect((await getCharacter(c.id))?.portraitRows).toEqual(saved!.portraitRows);
    const operationId = JSON.parse(await base.readText(journals()[0])).operationId;
    const second = vi.fn(current => replacePortraitItemMutation(current, 'p1', replacement()));
    await expect(updateCharacter(c.id, second)).rejects.toMatchObject({ code: 'portrait-recovery-required', characterId: c.id, operationId });
    expect(second).not.toHaveBeenCalled();
    await expect(saveCharacter({ ...saved!, name: 'Renamed' })).rejects.toMatchObject({ code: 'portrait-recovery-required' });
    await expect(deleteCharacter(c.id)).rejects.toMatchObject({ code: 'portrait-recovery-required' });
    expect(journals()).toHaveLength(1);
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    control.fault = 'none';
    await expect(updateCharacter(c.id, second)).resolves.toHaveProperty('id', c.id);
    expect(second).toHaveBeenCalledOnce();
    expect(journals()).toHaveLength(0);
    setActiveVault(createVault({ ...base }));
    await expect(getCharacter(c.id)).resolves.toHaveProperty('id', c.id);
  });

  it('reports unexpected post-commit cleanup exceptions as warnings without rolling back the save', async () => {
    const { c } = await fixture();
    const onWarning = vi.fn();
    const mutation: PreparedCharacterMutation = {
      patch: { rating: 9 },
      commitAfterPersist: async () => { throw new Error('cleanup callback failure'); },
      recoverAfterPersistFailure: vi.fn(),
    };
    await expect(updateCharacter(c.id, () => mutation, { onWarning })).resolves.toHaveProperty('rating', 9);
    expect(onWarning).toHaveBeenCalled();
    expect(mutation.recoverAfterPersistFailure).not.toHaveBeenCalled();
  });

  it.each(['replace', 'move'] as const)('gates direct %s preparation while an earlier journal remains unresolved', async operation => {
    const { c, base, control, journals } = await fixture();
    control.fault = 'cleanup';
    const saved = (await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement())))!;
    const filesBefore = Object.keys(base.dump());
    const prepare = operation === 'replace'
      ? replacePortraitItemMutation(saved, 'p1', replacement())
      : movePortraitItemsMutation(saved, ['p1'], 'night');
    await expect(prepare).rejects.toMatchObject({ code: 'portrait-recovery-required', characterId: c.id });
    expect(journals()).toHaveLength(1);
    expect(Object.keys(base.dump())).toEqual(filesBefore);
  });

  it.each(['second-temporary', 'second-rename', 'profile-before'] as const)('moves neither source on %s failure', async fault => {
    const { c, base, fs, control, journals } = await fixture();
    const rows = c.portraitRows!;
    const firstItem = rows[0].items[0];
    control.fault = fault;
    await expect(updateCharacter(c.id, () => movePortraitItemsMutation(c, ['p1', 'p2'], 'night'))).rejects.toThrow();
    expect(c.portraitRows).toBe(rows);
    expect(rows[0].items[0]).toBe(firstItem);
    expect(firstItem.fileName).toBe('old.png');
    expect(rows[1].items).toHaveLength(0);
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    expect(await base.readBinary('角色/Fixture/立绘/Day/other.png')).toBe(btoa('other bytes'));
    control.fault = 'none';
    setActiveVault(createVault({ ...fs }));
    expect((await getCharacter(c.id))?.portraitRows).toEqual(c.portraitRows);
    expect(journals()).toHaveLength(0);
    expect((await base.list('角色/Fixture/立绘/Night')).filter(entry => !entry.isDir)).toEqual([]);
  });

  it.each(['createdFiles', 'cleanupFiles'] as const)('does not accept a journal self-declaring an unrelated %s path', async field => {
    const { c, fs, base, journals } = await fixture();
    await replacePortraitItemMutation(c, 'p1', replacement());
    const journalPath = journals()[0];
    const journal = JSON.parse(await base.readText(journalPath)) as PortraitMutationJournal;
    const stray = '立绘/Day/unrelated.png';
    await base.writeBinary(`角色/Fixture/${stray}`, btoa('user file'));
    journal[field].push(stray);
    if (field === 'cleanupFiles') await base.writeText(profilePath, JSON.stringify({ ...c, portraitRows: journal.afterRows }));
    await base.writeText(journalPath, JSON.stringify(journal));
    endPortraitOperation(fs, c.id, journal.operationId);
    setActiveVault(createVault({ ...fs }));
    await expect(getCharacter(c.id)).rejects.toMatchObject({ code: 'portrait-recovery-required' });
    expect(await base.readBinary(`角色/Fixture/${stray}`)).toBe(btoa('user file'));
    expect(journals()).toHaveLength(1);
  });

  it('does not delete the old file if a committed new file is missing during recovery', async () => {
    const { c, fs, base, journals } = await fixture();
    const prepared = await replacePortraitItemMutation(c, 'p1', replacement());
    const journal = JSON.parse(await base.readText(journals()[0])) as PortraitMutationJournal;
    await base.writeText(profilePath, JSON.stringify({ ...c, ...prepared.patch }));
    await base.removeFile(`角色/Fixture/立绘/Day/${prepared.patch.portraitRows![0].items[0].fileName}`);
    endPortraitOperation(fs, c.id, journal.operationId);
    setActiveVault(createVault({ ...fs }));
    await expect(getCharacter(c.id)).rejects.toMatchObject({ code: 'portrait-recovery-required' });
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    expect(journals()).toHaveLength(1);
  });

  it('keeps a shared old file even when another item uses Windows-equivalent casing', async () => {
    const { c, base } = await fixture();
    c.portraitRows![0].items[1].fileName = 'OLD.PNG';
    await saveCharacter(c);
    await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()));
    expect(await base.readBinary(sourcePath)).toBe(oldBytes);
  });

  it('captures the vault before waiting for FileReader', async () => {
    const a = await fixture();
    const b = await fixture();
    setActiveVault(createVault(a.fs));
    const preparing = replacePortraitItemMutation(a.c, 'p1', replacement());
    setActiveVault(createVault(b.fs));
    const prepared = await preparing;
    expect(a.journals()).toHaveLength(1);
    expect(b.journals()).toHaveLength(0);
    setActiveVault(createVault(a.fs));
    await saveCharacter({ ...a.c, ...prepared.patch });
    await prepared.commitAfterPersist();
    expect(await b.base.readBinary(sourcePath)).toBe(oldBytes);
  });

  it('passes the originally captured vault into an updater after a queued wait', async () => {
    const a = await fixture();
    const b = await fixture();
    setActiveVault(createVault(a.fs));
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = updateCharacter(a.c.id, async () => { await barrier; return { rating: 5 }; });
    const second = updateCharacter(a.c.id, (current, context) => (
      replacePortraitItemMutation(current, 'p1', replacement(), context.vault)
    ));
    setActiveVault(createVault(b.fs));
    release();
    const saved = await second;
    await first;
    expect(JSON.parse(await a.base.readText(profilePath)).portraitRows).toEqual(saved?.portraitRows);
    expect(await b.base.readBinary(sourcePath)).toBe(oldBytes);
    expect(JSON.parse(await b.base.readText(profilePath)).portraitRows).toEqual(b.c.portraitRows);
    expect(b.journals()).toHaveLength(0);
  });

  it('replaces a missing old image without treating its absence as a failed save', async () => {
    const { c, base, journals } = await fixture();
    await base.removeFile(sourcePath);
    const saved = await updateCharacter(c.id, current => replacePortraitItemMutation(current, 'p1', replacement()));
    const fileName = saved!.portraitRows![0].items[0].fileName;
    expect(await base.readBinary(`角色/Fixture/立绘/Day/${fileName}`)).toBe(newBytes);
    expect(journals()).toHaveLength(0);
  });

  it.each(['before', 'after', 'ambiguous', 'missing', 'unreadable'] as const)('checks actual inline metadata after a save error: %s', async state => {
    const { c } = await fixture();
    const mutation = await replacePortraitItemMutation(c, 'p1', replacement(), null);
    const readPersisted = vi.fn(async () => {
      if (state === 'unreadable') throw new Error('read failure');
      if (state === 'missing') return undefined;
      if (state === 'before') return structuredClone(c);
      if (state === 'after') return { ...c, ...mutation.patch };
      return { ...c, portraitRows: [] };
    });
    const report = await mutation.recoverAfterPersistFailure(readPersisted);
    expect(readPersisted).toHaveBeenCalledOnce();
    expect(report.action).toBe(state === 'before' ? 'rolled-back' : state === 'after' ? 'finalized' : 'blocked');
  });
});

describe('portrait journal recovery after an abandoned operation', () => {
  it.each(['missing', 'corrupt'] as const)('reports a %s profile with a journal when a fresh vault lists characters', async state => {
    const { c, base, fs, journals } = await fixture();
    await replacePortraitItemMutation(c, 'p1', replacement());
    if (state === 'missing') await base.removeFile(profilePath);
    else await base.writeText(profilePath, '{broken profile');
    const before = base.dump();
    const media = new Map<string, string>();
    for (const [path, content] of Object.entries(before)) {
      if (content === '<binary>') media.set(path, await base.readBinary(path));
    }
    const mutate = vi.fn(async () => { throw new Error('unexpected mutation during startup'); });
    const reopened = createVault({
      ...fs, writeText: mutate, writeBinary: mutate, removeFile: mutate, trashFile: mutate,
      rename: mutate, mkdir: mutate, removeEmptyDir: mutate,
    });
    const result = await reopened.repo<ArchiveCharacter>('characters').list().catch(error => error);
    expect(result).toMatchObject({ code: 'portrait-recovery-required', path: profilePath });
    expect(result.message).toContain(profilePath);
    expect(result.message).not.toContain('broken profile');
    expect(mutate).not.toHaveBeenCalled();
    expect(base.dump()).toEqual(before);
    for (const [path, bytes] of media) expect(await base.readBinary(path)).toBe(bytes);
    expect(journals()).toHaveLength(1);
  });

  it.each(['journal', 'temporary-1', 'temporary-2', 'final-1', 'final-2', 'metadata', 'committed'])(
    'recovers a batch-move crash at %s and repeats without further deletion', async checkpoint => {
      const { c, base, fs } = await fixture();
      const strayPath = '角色/Fixture/立绘/Night/user.png';
      await base.writeBinary(strayPath, btoa('unmanaged'));
      let disk: ReturnType<typeof createMemFs> | undefined;
      const capture = async (point: string) => {
        if (point !== checkpoint) return;
        disk = createMemFs();
        for (const [path, text] of Object.entries(base.dump())) {
          if (text === '<binary>') await disk.writeBinary(path, await base.readBinary(path));
          else await disk.writeText(path, text);
        }
      };
      let writes = 0;
      let renames = 0;
      const liveFs: VaultFs = {
        ...fs,
        async writeText(path, content) {
          await fs.writeText(path, content);
          if (path.includes('/portrait-journal/')) await capture('journal');
        },
        async writeBinary(path, content) {
          await fs.writeBinary(path, content);
          await capture(`temporary-${++writes}`);
        },
        async rename(from, to) {
          await fs.rename(from, to);
          await capture(`final-${++renames}`);
        },
      };
      setActiveVault(createVault(liveFs));
      const prepared = await movePortraitItemsMutation(c, ['p1', 'p2'], 'night');
      // No owner callbacks run. Each snapshot is an actual durable IO checkpoint.
      await base.writeText(profilePath, JSON.stringify({ ...c, ...prepared.patch }));
      await capture('metadata');
      const journalPath = Object.keys(base.dump()).find(path => path.includes('/portrait-journal/'))!;
      const journal = JSON.parse(await base.readText(journalPath)) as PortraitMutationJournal;
      await base.writeText(journalPath, JSON.stringify({ ...journal, status: 'committed' }));
      await capture('committed');
      expect(disk).toBeDefined();
      const restartedDisk = disk!;
      const removeFile = vi.fn(restartedDisk.removeFile);
      const restartedFs = { ...restartedDisk, removeFile };
      setActiveVault(createVault(restartedFs));
      const saved = await getCharacter(c.id);
      const committed = checkpoint === 'metadata' || checkpoint === 'committed';
      expect(saved?.portraitRows).toEqual(committed ? prepared.patch.portraitRows : c.portraitRows);
      for (const [path, bytes] of [[sourcePath, oldBytes], ['角色/Fixture/立绘/Day/other.png', btoa('other bytes')]]) {
        expect((await restartedDisk.stat(path)).exists).toBe(!committed);
        if (!committed) expect(await restartedDisk.readBinary(path)).toBe(bytes);
      }
      for (const path of journal.createdFiles) {
        expect((await restartedDisk.stat(`角色/Fixture/${path}`)).exists).toBe(committed && !path.endsWith('.tmp'));
      }
      if (committed) {
        const moved = prepared.patch.portraitRows![1].items;
        expect(await restartedDisk.readBinary(`角色/Fixture/立绘/Night/${moved[0].fileName}`)).toBe(oldBytes);
        expect(await restartedDisk.readBinary(`角色/Fixture/立绘/Night/${moved[1].fileName}`)).toBe(btoa('other bytes'));
        expect(JSON.parse(await restartedDisk.readText(snapshotPath))).toHaveProperty('行');
      } else expect(await restartedDisk.readText(snapshotPath)).toBe('old snapshot');
      expect(await restartedDisk.readBinary(strayPath)).toBe(btoa('unmanaged'));
      expect((await restartedDisk.stat(journalPath)).exists).toBe(false);
      const afterRecovery = restartedDisk.dump();
      removeFile.mockClear();
      expect(await recoverCharacterJournals('角色/Fixture', c.id, restartedFs)).toEqual([]);
      setActiveVault(createVault({ ...restartedFs }));
      expect((await getCharacter(c.id))?.portraitRows).toEqual(saved?.portraitRows);
      expect(restartedDisk.dump()).toEqual(afterRecovery);
      expect(removeFile).not.toHaveBeenCalled();
    },
  );

  it.each(['schema', 'outside-path', 'wrong-id', 'ambiguous', 'missing-profile', 'corrupt-profile', 'unreadable-profile'])(
    'blocks %s without deleting any media on repeated recovery', async corruption => {
      const { c, base, fs, journals } = await fixture();
      await replacePortraitItemMutation(c, 'p1', replacement());
      const journalPath = journals()[0];
      const journal = JSON.parse(await base.readText(journalPath)) as PortraitMutationJournal;
      if (corruption === 'schema') await base.writeText(journalPath, '{broken');
      if (corruption === 'outside-path') await base.writeText(journalPath, JSON.stringify({ ...journal, cleanupFiles: ['../outside.png'] }));
      if (corruption === 'wrong-id') await base.writeText(journalPath, JSON.stringify({ ...journal, characterId: 'other' }));
      if (corruption === 'ambiguous') await base.writeText(profilePath, JSON.stringify({ ...c, portraitRows: [] }));
      if (corruption === 'missing-profile') await base.removeFile(profilePath);
      if (corruption === 'corrupt-profile') await base.writeText(profilePath, '{broken');
      const removeFile = vi.fn(base.removeFile);
      const restartedFs = { ...fs, removeFile, readText: async (path: string) => {
        if (corruption === 'unreadable-profile' && path === profilePath) throw new Error('profile read failure');
        return base.readText(path);
      } };
      const before = base.dump();
      for (let attempt = 0; attempt < 2; attempt++) {
        const reports = await recoverCharacterJournals('角色/Fixture', c.id, restartedFs);
        expect(reports).toEqual([expect.objectContaining({ action: 'blocked', warnings: [expect.stringContaining('portrait-recovery-required')] })]);
      }
      expect(removeFile).not.toHaveBeenCalled();
      expect(base.dump()).toEqual(before);
      expect(await base.readBinary(sourcePath)).toBe(oldBytes);
    },
  );
});
