import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { estimateRecordBytes } from '@/lib/vault/bounded-record-cache';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { PortraitMutationJournal } from '@/lib/portrait-journal';
import { sha256 } from 'js-sha256';

function story(id: string, content = '正文'): ArchiveStory {
  return {
    id, title: id, updatedAt: 1, createdAt: 1, markers: [],
    meta: { modelsUsed: [], playTimeMs: null },
    session: { id: `session-${id}`, title: id, createdAt: 1,
      character: { name: '角色' }, user: { name: '用户' },
      messages: [{ id: 'm1', role: 'assistant', content }],
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(count = 3, content = '正文') {
  const disk = createMemFs();
  const reads: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = `s${index}`;
    await disk.writeText(`临时/${id}/故事.json`, JSON.stringify(story(id, content)));
  }
  const fs = { ...disk, async readText(path: string) { reads.push(path); return disk.readText(path); } };
  return { disk, fs, reads, storyReads: () => reads.filter(path => path.endsWith('/故事.json')) };
}

afterEach(() => vi.restoreAllMocks());

describe('file vault bounded record reads', () => {
  it('checks the fixed schema on a cold vault without reading any story bodies', async () => {
    const { disk, fs, storyReads } = await fixture(96);
    const schema = { id: 'archive-schema', updatedAt: 1, version: 3 };
    await disk.writeText('库信息.json', JSON.stringify(schema));
    expect(await createVault(fs).repo('archiveMeta').get('archive-schema')).toEqual(schema);
    expect(storyReads()).toHaveLength(0);
  });

  it('retains schema missing/identity behavior and rejects an unresolved maintenance journal', async () => {
    const { disk, fs, storyReads } = await fixture();
    expect(await createVault(fs).repo('archiveMeta').get('archive-schema')).toBeUndefined();
    await disk.writeText('库信息.json', JSON.stringify({ id: 'different', updatedAt: 1 }));
    expect(await createVault(fs).repo('archiveMeta').get('archive-schema')).toBeUndefined();
    await disk.writeText('.ste/retained/00000000-0000-0000-0000-000000000000/manifest.json', '{}');
    await expect(createVault(fs).repo('archiveMeta').get('archive-schema')).rejects.toThrow('恢复清单损坏');
    expect(storyReads()).toHaveLength(0);
  });

  it('reuses the cold scan only as lightweight projections and reads full bodies on demand', async () => {
    const { fs, reads, storyReads } = await fixture(96, '正文'.repeat(200));
    const clonedIds: string[] = [];
    const clone = globalThis.structuredClone;
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
      if (value && typeof value === 'object' && 'session' in value && 'id' in value) clonedIds.push(String(value.id));
      return clone(value);
    });
    const vault = createVault(fs);
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await vault.pathOf('archiveStories', 's0');
    expect(storyReads()).toHaveLength(96);
    reads.length = 0;
    const entries = await repo.listLight();
    expect(entries).toHaveLength(96);
    expect(entries[0]).toMatchObject({ floorCount: 1 });
    expect(entries[0]).not.toHaveProperty('session');
    expect(storyReads()).toHaveLength(0);
    expect(clonedIds).toEqual([]);
    expect((await Promise.all(['s0', 's1'].map(id => repo.get(id)))).map(item => item?.id)).toEqual(['s0', 's1']);
    expect(storyReads()).toEqual(['临时/s0/故事.json', '临时/s1/故事.json']);
    expect(new Set(clonedIds)).toEqual(new Set(['s0', 's1']));
    entries[0].meta.modelsUsed.push('local-edit');
    expect((await repo.listLight())[0].meta.modelsUsed).toEqual([]);
  });

  it('keeps a story with malformed optional projection data available for a full read', async () => {
    const { disk, fs } = await fixture(1);
    const original = { ...story('s0'), branches: { unknown: 'preserve' } };
    await disk.writeText('临时/s0/故事.json', JSON.stringify(original));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vault = createVault(fs);
    expect(await vault.pathOf('archiveStories', 's0')).toBe('临时/s0');
    expect(await vault.repo('archiveStories').get('s0')).toEqual(original);
  });

  it('evicts the least recently read full record under a global entry budget', async () => {
    const { fs, reads, storyReads } = await fixture();
    const vault = createVault(fs, { fullCache: { maxEntries: 2 } });
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    await repo.get('s0'); await repo.get('s1'); await repo.get('s0'); await repo.get('s2');
    await repo.get('s0');
    expect(storyReads()).toHaveLength(3);
    await repo.get('s1');
    expect(storyReads()).toHaveLength(4);
  });

  it('shares the full entry budget across stores', async () => {
    const { disk, fs, reads, storyReads } = await fixture(1);
    await disk.writeText('资产/模板/评分模板·template.json', JSON.stringify({ id: 's0', updatedAt: 1, title: 'template' }));
    const vault = createVault(fs, { fullCache: { maxEntries: 1 } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    expect(await vault.repo('archiveStories').get('s0')).toHaveProperty('session');
    expect(await vault.repo('ratingTemplates').get('s0')).toHaveProperty('title', 'template');
    await vault.repo('archiveStories').get('s0');
    expect(storyReads()).toHaveLength(2);
  });

  it('charges unprojected listLight payloads to the same bounded full-record pool', async () => {
    const { disk, fs, reads, storyReads } = await fixture(1);
    const templatePath = '资产/模板/评分模板·template.json';
    await disk.writeText(templatePath, JSON.stringify({ id: 't0', updatedAt: 1, title: 'template' }));
    const vault = createVault(fs, { fullCache: { maxEntries: 1 } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await repo.get('s0');
    await vault.repo('ratingTemplates').listLight();
    await repo.get('s0');
    expect(storyReads()).toHaveLength(2);
    await vault.repo('ratingTemplates').listLight();
    expect(reads.filter(path => path === templatePath)).toHaveLength(2);
  });

  it('does not retain disabled-cache full records via listLight', async () => {
    const { disk, fs, reads } = await fixture(0);
    const templatePath = '资产/模板/评分模板·template.json';
    await disk.writeText(templatePath, JSON.stringify({ id: 't0', updatedAt: 1 }));
    const vault = createVault(fs, { fullCache: { maxEntries: 0 } });
    await vault.pathOf('ratingTemplates', 't0'); reads.length = 0;
    await vault.repo('ratingTemplates').listLight();
    await vault.repo('ratingTemplates').listLight();
    expect(reads.filter(path => path === templatePath)).toHaveLength(2);
  });

  it('evicts by estimated bytes even when the entry count has room', async () => {
    const { fs, reads, storyReads } = await fixture(2, '字'.repeat(1000));
    const vault = createVault(fs, { fullCache: { maxBytes: 4500, maxEntries: 128 } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await repo.get('s0'); await repo.get('s0');
    expect(storyReads()).toHaveLength(1);
    await repo.get('s1'); await repo.get('s0');
    expect(storyReads()).toHaveLength(3);
  });

  it('bypasses an oversized record without evicting a useful small record', async () => {
    const { disk, fs, reads, storyReads } = await fixture(2);
    await disk.writeText('临时/s1/故事.json', JSON.stringify(story('s1', '大'.repeat(10000))));
    const vault = createVault(fs, { fullCache: { maxBytes: 4500 } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await repo.get('s0'); await repo.get('s1'); await repo.get('s1'); await repo.get('s0');
    expect(storyReads()).toEqual(['临时/s0/故事.json', '临时/s1/故事.json', '临时/s1/故事.json']);
  });

  it('coalesces concurrent full misses and gives each reader an isolated record', async () => {
    const { fs, reads, storyReads } = await fixture(1);
    const vault = createVault(fs);
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    const [first, second] = await Promise.all([repo.get('s0'), repo.get('s0')]);
    expect(storyReads()).toHaveLength(1);
    first!.session.messages[0].content = 'caller edit';
    expect(second!.session.messages[0].content).toBe('正文');
    expect((await repo.get('s0'))!.session.messages[0].content).toBe('正文');
  });

  it('keeps concurrent full and light misses separate', async () => {
    const { fs } = await fixture(1);
    const vault = createVault(fs);
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await repo.put(story('s0'));
    const [full, light] = await Promise.all([repo.get('s0'), repo.listLight()]);
    expect(full!.session.messages).toHaveLength(1);
    expect(light[0]).not.toHaveProperty('session');
  });

  it('retries a failed shared body read instead of retaining its missing result', async () => {
    const { fs, reads, storyReads } = await fixture(1);
    let fail = false;
    const vault = createVault({ ...fs, async readText(path) {
      const text = await fs.readText(path);
      if (fail && path.endsWith('/故事.json')) throw new Error('temporary read failure');
      return text;
    } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fail = true;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    expect(await Promise.all([repo.get('s0'), repo.get('s0')])).toEqual([undefined, undefined]);
    expect(storyReads()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    fail = false;
    expect((await repo.get('s0'))?.id).toBe('s0');
    expect(storyReads()).toHaveLength(2);
  });

  it('retries a rejected shared binary read and preserves caller isolation', async () => {
    const { disk, fs } = await fixture(0);
    await disk.writeText('角色/c0/档案.json', JSON.stringify({ id: 'c0', name: 'c0', updatedAt: 1 }));
    await disk.writeBinary('角色/c0/卡片.png', 'png');
    let fail = true, binaryReads = 0;
    const vault = createVault({ ...fs, async readBinary(path) {
      binaryReads++;
      if (fail) throw new Error('temporary binary failure');
      return fs.readBinary(path);
    } });
    const repo = vault.repo<ArchiveCharacter>('characters');
    const results = await Promise.allSettled([repo.get('c0'), repo.get('c0')]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(binaryReads).toBe(1);
    fail = false;
    expect((await repo.get('c0'))?.pngBase64).toBe('png');
    expect(binaryReads).toBe(2);
  });

  it('invalidates full and light character snapshots when a newly discovered journal recovers', async () => {
    const { disk, fs } = await fixture(0);
    const profile = { id: 'c0', name: 'c0', updatedAt: 1, portraitRows: [] };
    await disk.writeText('角色/c0/档案.json', JSON.stringify(profile));
    const vault = createVault(fs);
    const repo = vault.repo<ArchiveCharacter>('characters');
    await repo.get('c0'); await repo.listLight();
    const afterRows = [{ id: 'row', title: '恢复行', items: [] }];
    const operationId = '00000000-0000-0000-0000-000000000001';
    const journal: PortraitMutationJournal = { version: 1, operationId, characterId: 'c0',
      status: 'prepared', beforeRows: [], afterRows, createdFiles: [], cleanupFiles: [], createdAt: 1 };
    await disk.writeText('角色/c0/档案.json', JSON.stringify({ ...profile, portraitRows: afterRows }));
    await disk.writeText(`角色/c0/.ste-control/portrait-journal/${operationId}.json`, JSON.stringify(journal));
    expect((await repo.get('c0'))?.portraitRows).toEqual(afterRows);
    expect((await repo.listLight())[0].portraitRows).toEqual(afterRows);
    expect((await disk.stat(`角色/c0/.ste-control/portrait-journal/${operationId}.json`)).exists).toBe(false);
  });

  it('checks newly added maintenance journals on the next vault session rather than every ordinary read', async () => {
    const { disk, fs, storyReads } = await fixture(1);
    await disk.writeText('库信息.json', JSON.stringify({ id: 'archive-schema', updatedAt: 1, version: 3 }));
    const repo = createVault(fs).repo('archiveMeta');
    await repo.get('archive-schema');
    await disk.writeText('.ste/retained/00000000-0000-0000-0000-000000000000/manifest.json', '{}');
    expect(await repo.get('archive-schema')).toMatchObject({ id: 'archive-schema' });
    await expect(createVault(fs).repo('archiveMeta').get('archive-schema')).rejects.toThrow('恢复清单损坏');
    expect(storyReads()).toHaveLength(0);
  });

  it.each([false, true])('coalesces overlapping maintenance recovery before schema and index=%s reads', async withIndex => {
    const { disk, fs } = await fixture(1);
    const schema = { id: 'archive-schema', updatedAt: 1, version: 3 };
    const content = JSON.stringify(schema);
    const operationId = '00000000-0000-0000-0000-000000000002';
    const root = `.ste/retained/${operationId}`;
    await disk.writeText(`${root}/files/库信息.json`, content);
    await disk.writeText(`${root}/manifest.json`, JSON.stringify({ schema: 1, operationId,
      store: 'archiveMeta', id: schema.id, createdAt: 1, deleteFiles: false,
      files: [{ path: '库信息.json', size: content.length, version: sha256('text:' + content) }] }));
    const vault = createVault(fs);
    const repo = vault.repo('archiveMeta');
    const [first, second] = await Promise.all([
      repo.get('archive-schema'),
      withIndex ? vault.pathOf('archiveStories', 's0') : repo.get('archive-schema'),
    ]);
    expect(first).toEqual(schema);
    expect(second).toEqual(withIndex ? '临时/s0' : schema);
    expect((await disk.stat(`${root}/manifest.json`)).exists).toBe(false);
  });

  it('retries schema recovery after an earlier unresolved journal is repaired', async () => {
    const { disk, fs, storyReads } = await fixture(1);
    const schema = { id: 'archive-schema', updatedAt: 1, version: 3 };
    await disk.writeText('库信息.json', JSON.stringify(schema));
    const manifest = '.ste/retained/00000000-0000-0000-0000-000000000002/manifest.json';
    await disk.writeText(manifest, '{}');
    const repo = createVault(fs).repo('archiveMeta');
    await expect(repo.get('archive-schema')).rejects.toThrow('恢复清单损坏');
    await disk.removeFile(manifest);
    await disk.removeEmptyDir('.ste/retained/00000000-0000-0000-0000-000000000002');
    expect(await repo.get('archive-schema')).toEqual(schema);
    expect(storyReads()).toHaveLength(0);
  });

  it('retries a blocked cold index after maintenance is repaired through the schema path', async () => {
    const { disk, fs } = await fixture(1);
    const operationRoot = '.ste/retained/00000000-0000-0000-0000-000000000002';
    await disk.writeText(`${operationRoot}/manifest.json`, '{}');
    const vault = createVault(fs);
    await expect(vault.pathOf('archiveStories', 's0')).rejects.toThrow('恢复清单损坏');
    await disk.removeFile(`${operationRoot}/manifest.json`);
    await disk.removeEmptyDir(operationRoot);
    await vault.repo('archiveMeta').get('archive-schema');
    expect(await vault.pathOf('archiveStories', 's0')).toBe('临时/s0');
  });

  it('does not resurrect a removed record when its shared read finishes late', async () => {
    const { fs, reads, storyReads } = await fixture(1);
    const reached = deferred(), release = deferred();
    let hold = false;
    const vault = createVault({ ...fs, async readText(path) {
      const text = await fs.readText(path);
      if (hold && path.endsWith('/故事.json')) { reached.resolve(); await release.promise; }
      return text;
    } });
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    hold = true;
    const old = [repo.get('s0'), repo.get('s0')];
    await reached.promise;
    expect(storyReads()).toHaveLength(1);
    await repo.remove('s0');
    hold = false;
    await repo.put({ ...story('s0'), rating: 8 }, { derivedUnchanged: true });
    release.resolve();
    await Promise.all(old);
    expect((await repo.get('s0'))?.rating).toBe(8);
  });

  it('does not join an old-path read after its character directory moves', async () => {
    const { disk, fs } = await fixture(0);
    const profile = { id: 'c0', name: 'before', updatedAt: 1 };
    await disk.writeText('角色/before/档案.json', JSON.stringify(profile));
    await disk.writeText('角色/before/故事/s0/故事.json', JSON.stringify({ ...story('s0'), characterId: 'c0' }));
    const reached = deferred(), release = deferred();
    let hold = false;
    const vault = createVault({ ...fs, async readText(path) {
      if (hold && path === '角色/before/故事/s0/故事.json') { reached.resolve(); await release.promise; }
      return fs.readText(path);
    } });
    await vault.pathOf('archiveStories', 's0');
    hold = true;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    const old = repo.get('s0');
    await reached.promise;
    await vault.repo<ArchiveCharacter>('characters').put({ ...profile, name: 'after' } as ArchiveCharacter, { derivedUnchanged: true });
    const current = repo.get('s0');
    // Give the new request a chance to pick its in-flight version, then release
    // the old path. A stale joined read would return undefined for both callers.
    await Promise.resolve(); await Promise.resolve();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    release.resolve();
    expect(await old).toBeUndefined();
    expect((await current)?.id).toBe('s0');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('applies the default 128-entry cap without custom options', async () => {
    const { fs, reads, storyReads } = await fixture(129);
    const vault = createVault(fs);
    await vault.pathOf('archiveStories', 's0'); reads.length = 0;
    const repo = vault.repo<ArchiveStory>('archiveStories');
    for (let index = 0; index < 129; index++) await repo.get(`s${index}`);
    await repo.get('s0');
    expect(storyReads()).toHaveLength(130);
  });

  it('estimates with an early cutoff before touching the rest of an oversized body', () => {
    const record = { body: '字'.repeat(1000), get untouchedTail() { throw new Error('must stop before visiting tail'); } };
    expect(estimateRecordBytes(record, 100)).toBeGreaterThan(100);
  });

  it('does not stringify a record to estimate retained bytes', () => {
    const record = { body: '字'.repeat(1000), nested: { metadata: 'kept' } };
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('no serialization'); });
    const estimate = estimateRecordBytes(record, 4500);
    stringify.mockRestore();
    expect(estimate).toBeGreaterThan(2000);
    expect(estimate).toBeLessThan(4500);
  });

  it.each([false, true])('coalesces light=%s misses without rejoining a stale read after a write', async light => {
    const { fs, reads, storyReads } = await fixture(1);
    const reached = deferred(), release = deferred();
    let held = false;
    const vault = createVault({ ...fs, async readText(path) {
      const text = await fs.readText(path);
      if (held && path.endsWith('/故事.json')) { reached.resolve(); await release.promise; }
      return text;
    } });
    const repo = vault.repo<ArchiveStory>('archiveStories');
    await repo.put(story('s0')); reads.length = 0;
    const read = () => light ? repo.listLight().then(items => items[0]) : repo.get('s0');
    held = true;
    const old = [read(), read()];
    await reached.promise;
    expect(storyReads()).toHaveLength(1);
    held = false;
    await repo.put({ ...story('s0'), rating: 9 }, { derivedUnchanged: true });
    expect((await read())?.rating).toBe(9);
    release.resolve();
    const [first, second] = await Promise.all(old);
    first!.meta.modelsUsed.push('caller edit');
    expect(second!.meta.modelsUsed).toEqual([]);
    expect((await read())?.rating).toBe(9);
  });
});
