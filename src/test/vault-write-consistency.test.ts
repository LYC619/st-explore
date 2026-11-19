// Regression coverage through the public save entry points; synthetic data only.
import { afterEach, describe, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { saveCharacter, updateCharacter, saveArchiveStory, saveLibraryTagPreferences, saveRoleplayPreferences,
  setArchiveSchemaVersion, writePresetTagPreferences } from '@/lib/archive-db';
import { normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { STCharacterCard } from '@/lib/png-parser';
import { ARCHIVE_SCHEMA_VERSION } from '@/lib/archive-schema';
import { needsArchiveMigration } from '@/lib/archive-migrate';

const character = (id: string): ArchiveCharacter => ({
  id, name: 'Synthetic same-name character', card: { name: 'Synthetic' } as STCharacterCard,
  status: '未开始', tags: [], createdAt: 1, updatedAt: 1,
});
const story = (id: string): ArchiveStory => ({
  id, title: 'Synthetic same-title story',
  session: { id: 'synthetic-session', title: 'Synthetic', messages: [],
    character: { name: 'Synthetic' }, user: { name: 'Synthetic user' }, createdAt: 1 },
  markers: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1,
});

afterEach(() => setActiveVault(null));

describe('file vault write consistency', () => {
  it('can resume legacy migration after a journal advances only the compatibility gate', async () => {
    const base = createMemFs(), vault = createVault(base);
    setActiveVault(vault);
    await vault.repo('characters').put(character('legacy-gate'));
    expect(JSON.parse(await base.readText('库信息.json')).schemaVersion).toBe(ARCHIVE_SCHEMA_VERSION);
    await vault.repo('archiveMeta').put({ id: 'archive-schema', updatedAt: 2 });
    expect(await needsArchiveMigration()).toBe(true);
    await setArchiveSchemaVersion(ARCHIVE_SCHEMA_VERSION);
    expect(await needsArchiveMigration()).toBe(false);
  });
  it('gates old builds before journal publication and never downgrades the gate through stale settings', async () => {
    const base = createMemFs();
    await base.writeText('库信息.json', JSON.stringify({ id: 'archive-schema', updatedAt: 1, schemaVersion: 2, custom: 'kept' }));
    const fs = { ...base, async writeText(path: string, text: string) {
      if (path.endsWith('/manifest.json')) {
        expect(JSON.parse(await base.readText('库信息.json')).schemaVersion).toBe(ARCHIVE_SCHEMA_VERSION);
        throw new Error('synthetic interruption');
      }
      await base.writeText(path, text);
    } };
    const vault = createVault(fs);
    await expect(vault.repo('characters').put(character('gate'))).rejects.toThrow('synthetic interruption');
    expect(JSON.parse(await base.readText('库信息.json')).custom).toBe('kept');
    await vault.repo<{ id: string; updatedAt: number; schemaVersion: number }>('archiveMeta').put({ id: 'archive-schema', updatedAt: 2, schemaVersion: 2 });
    expect(JSON.parse(await base.readText('库信息.json')).schemaVersion).toBe(ARCHIVE_SCHEMA_VERSION);
  });
  it('keeps both same-name characters after concurrent saves and reopen', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    setActiveVault(vault);
    await vault.repo('characters').list();
    await Promise.all([saveCharacter(character('synthetic-c1')), saveCharacter(character('synthetic-c2'))]);
    const profiles = Object.keys(fs.dump()).filter(path => path.endsWith('/档案.json'));
    expect(profiles).toHaveLength(2);
    const first = await vault.repo<ArchiveCharacter>('characters').get('synthetic-c1');
    const second = await vault.repo<ArchiveCharacter>('characters').get('synthetic-c2');
    expect(first?.id).toBe('synthetic-c1');
    expect(second?.id).toBe('synthetic-c2');
    expect(await createVault(fs).repo('characters').list()).toHaveLength(2);
  });

  it('keeps both same-title stories after concurrent saves and reopen', async () => {
    const fs = createMemFs(), vault = createVault(fs);
    setActiveVault(vault);
    await vault.repo('archiveStories').list();
    await Promise.all([saveArchiveStory(story('synthetic-s1')), saveArchiveStory(story('synthetic-s2'))]);
    expect(Object.keys(fs.dump()).filter(path => path.endsWith('/故事.json'))).toHaveLength(2);
    const found = await Promise.all(['synthetic-s1', 'synthetic-s2'].map(id => vault.repo('archiveStories').get(id)));
    expect(found.filter(Boolean)).toHaveLength(2);
    expect(await createVault(fs).repo('archiveStories').list()).toHaveLength(2);
  });

  it('does not publish a new character when PNG staging fails', async () => {
    const base = createMemFs();
    const fs = { ...base, async writeBinary() { throw new Error('synthetic PNG failure'); } };
    const vault = createVault(fs), repo = vault.repo<ArchiveCharacter>('characters');
    await expect(repo.put({ ...character('synthetic-c1'), pngBase64: 'bmV3' })).rejects.toThrow('synthetic PNG failure');
    const current = await repo.get('synthetic-c1');
    const reopened = await createVault(base).repo<ArchiveCharacter>('characters').get('synthetic-c1');
    expect(current).toBeUndefined();
    expect(reopened).toBeUndefined();
  });

  it('keeps the old complete character when PNG replacement fails', async () => {
    const base = createMemFs();
    let fail = false;
    const fs = { ...base, async writeBinary(path: string, value: string) {
      if (fail) throw new Error('synthetic PNG failure');
      await base.writeBinary(path, value);
    } };
    const vault = createVault(fs);
    setActiveVault(vault);
    const old = { ...character('synthetic-c1'), pngBase64: 'b2xk' };
    await saveCharacter(old);
    fail = true;
    await expect(updateCharacter(old.id, () => ({ subtitle: 'Synthetic new metadata', pngBase64: 'bmV3', updatedAt: 2 }))).rejects.toThrow('synthetic PNG failure');
    const reopened = await createVault(base).repo<ArchiveCharacter>('characters').get('synthetic-c1');
    expect(reopened).toEqual(old);
  });

  it('serializes character renames with child story creation', async () => {
    const base = createMemFs();
    let hold = false, unblock!: () => void, reached!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const started = new Promise<void>(resolve => { reached = resolve; });
    const oldParent = '角色/Synthetic same-name character/故事';
    const fs = { ...base, async list(path: string) {
      const entries = await base.list(path);
      if (hold && path === oldParent) { hold = false; reached(); await gate; }
      return entries;
    } };
    const vault = createVault(fs);
    setActiveVault(vault);
    await saveCharacter(character('synthetic-c1'));
    hold = true;
    const pending = saveArchiveStory({ ...story('synthetic-s1'), characterId: 'synthetic-c1' });
    await started;
    const rename = updateCharacter('synthetic-c1', () => ({ name: 'Synthetic renamed character' }));
    let finished = false;
    void rename.then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    unblock();
    await Promise.all([pending, rename]);
    expect((await base.stat(`${oldParent}/Synthetic same-title story/故事.json`)).exists).toBe(false);
    expect((await vault.repo('archiveStories').get('synthetic-s1'))?.id).toBe('synthetic-s1');
    expect((await createVault(base).repo('archiveStories').get('synthetic-s1'))?.id).toBe('synthetic-s1');
  });

  it('rolls back profile changes when PNG removal fails', async () => {
    const base = createMemFs();
    let fail = false;
    const fs = { ...base, async removeFile(path: string) {
      if (fail && path.endsWith('/卡片.png')) throw new Error('synthetic remove failure');
      await base.removeFile(path);
    } };
    const repo = createVault(fs).repo<ArchiveCharacter>('characters');
    const old = { ...character('synthetic-c1'), pngBase64: 'b2xk' };
    await repo.put(old);
    fail = true;
    await expect(repo.put({ ...old, pngBase64: undefined, updatedAt: 2 })).rejects.toThrow('synthetic remove failure');
    const reopened = await createVault(base).repo<ArchiveCharacter>('characters').get('synthetic-c1');
    expect(reopened).toEqual(old);
  });

  it('preserves all four concurrently updated settings families', async () => {
    const fs = createMemFs();
    setActiveVault(createVault(fs));
    await Promise.all([
      setArchiveSchemaVersion(42),
      saveLibraryTagPreferences(normalizeLibraryTagPreferences({ version: 1, customTags: ['Synthetic tag'] })),
      saveRoleplayPreferences({ mainProfileId: 'synthetic-main' }),
      writePresetTagPreferences({ id: 'preset-tags', updatedAt: 1, categories: [], tags: ['Synthetic preset tag'], hidden: [] }, 0),
    ]);
    const current = JSON.parse(await fs.readText('库信息.json'));
    expect(current.schemaVersion).toBe(42);
    expect(current.libraryTags.customTags).toEqual(['Synthetic tag']);
    expect(current.roleplay.mainProfileId).toBe('synthetic-main');
    expect(current.presetTags.tags).toEqual(['Synthetic preset tag']);
  });

  it('coordinates separate handles and refreshes their path indexes', async () => {
    const fs = createMemFs(), first = createVault({ ...fs }), second = createVault({ ...fs });
    await Promise.all([first.repo('characters').list(), second.repo('characters').list()]);
    await Promise.all([first.repo<ArchiveCharacter>('characters').put(character('a')), second.repo<ArchiveCharacter>('characters').put(character('b'))]);
    expect((await first.repo('characters').list()).map(item => item.id).sort()).toEqual(['a', 'b']);
    await first.repo<ArchiveCharacter>('characters').put({ ...character('a'), name: 'Moved' });
    await second.repo<ArchiveStory>('archiveStories').put({ ...story('s'), characterId: 'a' });
    expect(await createVault(fs).pathOf('archiveStories', 's')).toContain('角色/Moved/故事/');
  });

  async function interruptedRename() {
    const base = createMemFs();
    const old = { ...character('c'), pngBase64: 'b2xk' };
    await createVault(base).repo<ArchiveCharacter>('characters').put(old);
    const oldDir = '角色/Synthetic same-name character';
    await base.writeText(`${oldDir}/user-note.txt`, 'synthetic user file');
    let interrupted = false;
    const broken = { ...base,
      async writeBinary(path: string, data: string) {
        if (path === '角色/Renamed/卡片.png') { interrupted = true; throw new Error('synthetic interruption'); }
        await base.writeBinary(path, data);
      },
      async writeText(path: string, data: string) {
        if (interrupted && path.endsWith('/档案.json')) throw new Error('synthetic offline disk');
        await base.writeText(path, data);
      },
    };
    await expect(createVault(broken).repo<ArchiveCharacter>('characters').put({ ...old, name: 'Renamed', pngBase64: 'bmV3', updatedAt: 2 })).rejects.toThrow();
    return { base, old, oldDir };
  }

  it('recovers an interrupted renamed profile/PNG pair before indexing and preserves user files', async () => {
    const { base, old, oldDir } = await interruptedRename();
    expect((await base.stat('角色/Renamed/档案.json')).exists).toBe(true);
    expect(await createVault(base).repo('characters').get('c')).toEqual(old);
    expect(await base.readText(`${oldDir}/user-note.txt`)).toBe('synthetic user file');
    expect((await base.stat('角色/Renamed')).exists).toBe(false);
  });

  it('lets two library handles recover an interrupted rename without racing the rollback', async () => {
    const { base, old, oldDir } = await interruptedRename();
    const first = createVault({ ...base }), second = createVault({ ...base });
    const recovered = await Promise.all([
      first.repo('characters').get('c'), second.repo('characters').get('c'),
    ]);
    expect(recovered).toEqual([old, old]);
    expect(await base.readText(`${oldDir}/user-note.txt`)).toBe('synthetic user file');
    expect((await base.stat('角色/Renamed')).exists).toBe(false);
    expect(Object.keys(base.dump()).filter(path => path.includes('/character-saves/'))).toEqual([]);
  });

  it('blocks recovery if the target was externally changed and preserves both versions', async () => {
    const { base } = await interruptedRename();
    const changed = JSON.stringify({ ...character('c'), name: 'External change' });
    await base.writeText('角色/Renamed/档案.json', changed);
    await expect(createVault(base).repo('characters').list()).rejects.toThrow('恢复记录与文件不一致');
    expect(await base.readText('角色/Renamed/档案.json')).toBe(changed);
    expect(Object.keys(base.dump()).some(path => path.endsWith('/before-profile'))).toBe(true);
  });

  it('rejects a corrupted rollback snapshot before changing the target', async () => {
    const { base } = await interruptedRename();
    const backup = Object.keys(base.dump()).find(path => path.endsWith('/before-profile'))!;
    await base.writeText(backup, '{}');
    const current = await base.readText('角色/Renamed/档案.json');
    await expect(createVault(base).repo('characters').list()).rejects.toThrow('恢复记录与文件不一致');
    expect(await base.readText('角色/Renamed/档案.json')).toBe(current);
  });

  it.each(['cleanup', 'acknowledgement'])('keeps a committed save successful after lost %s', async fault => {
    const base = createMemFs();
    const fs = { ...base,
      async writeText(path: string, content: string) {
        await base.writeText(path, content);
        if (fault === 'acknowledgement' && path.endsWith('/committed.json')) throw new Error('synthetic lost response');
      },
      async removeFile(path: string) {
        if (fault === 'cleanup' && path.endsWith('/manifest.json')) throw new Error('synthetic cleanup failure');
        await base.removeFile(path);
      },
    };
    const saved = { ...character('c'), pngBase64: 'bmV3' };
    await expect(createVault(fs).repo<ArchiveCharacter>('characters').put(saved)).resolves.toBeUndefined();
    expect(await createVault(base).repo('characters').get('c')).toEqual(saved);
    expect(Object.keys(base.dump()).filter(path => path.includes('/character-saves/'))).toEqual([]);
  });
});
