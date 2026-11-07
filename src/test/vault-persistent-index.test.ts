import { describe, expect, it, vi } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import type { ArchiveStory } from '@/types/archive';

const story = (id: string, title = id): ArchiveStory => ({ id, title, updatedAt: 1, createdAt: 1, markers: [], meta: { modelsUsed: [], playTimeMs: null }, session: { id, title, createdAt: 1, character: { name: '角色' }, user: { name: '用户' }, messages: [{ id: 'm', role: 'assistant', content: '正文'.repeat(1000) }] } });
const file = (id: string) => `临时/${id}/故事.json`;
async function fixture() {
  const disk = createMemFs(), stamps = new Map<string, number>(); let clock = 0;
  const fs: VaultFs = { ...disk,
    async writeText(path, text) { await disk.writeText(path, text); stamps.set(path, ++clock); },
    async stat(path) { const result = await disk.stat(path); return { ...result, size: disk.dump()[path]?.length, modifiedAt: stamps.get(path) }; },
    readText: vi.fn(path => disk.readText(path)),
  };
  for (const id of ['s1', 's2']) await fs.writeText(file(id), JSON.stringify(story(id)));
  const reads = () => vi.mocked(fs.readText).mock.calls.filter(([path]) => path.endsWith('/故事.json')).length;
  const clear = () => vi.mocked(fs.readText).mockClear();
  return { fs, disk, reads, clear };
}
describe('rebuildable story summary index', () => {
  it('reuses validated summaries across vault sessions without reading story bodies', async () => {
    const { fs, reads, clear } = await fixture();
    const first = await createVault(fs).repo<ArchiveStory>('archiveStories').listLight(); expect(reads()).toBe(2); clear();
    const repo = createVault(fs).repo<ArchiveStory>('archiveStories');
    expect(await repo.listLight()).toEqual(first); expect(reads()).toBe(0);
    expect((await repo.get('s1'))).toHaveProperty('session.messages'); expect(reads()).toBe(1);
  });
  it('rebuilds only changed files and discovers additions/removals on restart', async () => {
    const { fs, reads, clear } = await fixture();
    await createVault(fs).repo<ArchiveStory>('archiveStories').listLight();
    await fs.writeText(file('s1'), JSON.stringify(story('s1', 'changed'))); await fs.removeFile(file('s2'));
    await fs.writeText(file('s3'), JSON.stringify(story('s3'))); clear();
    expect((await createVault(fs).repo<ArchiveStory>('archiveStories').listLight()).map(s => s.title).sort()).toEqual(['changed', 's3']); expect(reads()).toBe(2);
  });
  it('invalidates full and light cached stories on external edit and deletion within a session', async () => {
    const { fs } = await fixture(); const repo = createVault(fs).repo<ArchiveStory>('archiveStories');
    await repo.listLight(); await repo.get('s1');
    await fs.writeText(file('s1'), JSON.stringify(story('s1', 'external')));
    expect((await repo.get('s1'))?.title).toBe('external'); expect((await repo.listLight()).find(s => s.id === 's1')?.title).toBe('external');
    await fs.removeFile(file('s1')); expect(await repo.get('s1')).toBeUndefined(); expect(await repo.listLight()).toHaveLength(1);
  });
  it('does not serve a different identity under the old id', async () => {
    const { fs } = await fixture(); const repo = createVault(fs).repo<ArchiveStory>('archiveStories'); await repo.listLight();
    await fs.writeText(file('s1'), JSON.stringify(story('replacement'))); expect(await repo.get('s1')).toBeUndefined();
  });
  it('ignores a broken index and a read-only cache directory without losing records', async () => {
    const { fs, disk, reads, clear } = await fixture(); await createVault(fs).repo<ArchiveStory>('archiveStories').listLight();
    const cache = Object.keys(disk.dump()).find(p => p.startsWith('.ste-control/index/'));
    expect(cache).toBeTruthy(); await fs.writeText(cache!, '{broken'); clear();
    const readOnly = { ...fs, writeText: async () => { throw new Error('readonly'); } };
    expect(await createVault(readOnly).repo<ArchiveStory>('archiveStories').listLight()).toHaveLength(2); expect(reads()).toBe(2);
  });
  it('falls back to ordinary scan when the filesystem has no validation metadata', async () => {
    const { disk } = await fixture(); const fs = { ...disk, readText: vi.fn(path => disk.readText(path)) };
    await createVault(fs).repo<ArchiveStory>('archiveStories').listLight(); fs.readText.mockClear();
    expect(await createVault(fs).repo<ArchiveStory>('archiveStories').listLight()).toHaveLength(2);
    expect(fs.readText.mock.calls.filter(([p]) => p.endsWith('/故事.json'))).toHaveLength(2);
  });
  it('never uses an old summary after a normal save', async () => {
    const { fs } = await fixture(); const repo = createVault(fs).repo<ArchiveStory>('archiveStories'); await repo.listLight();
    await repo.put(story('s1', 'saved'), { derivedUnchanged: true });
    expect((await createVault(fs).repo<ArchiveStory>('archiveStories').listLight()).find(s => s.id === 's1')?.title).toBe('saved');
  });
  it('ignores a parseable but corrupted summary and rebuilds it', async () => {
    const { fs, disk, reads, clear } = await fixture(); await createVault(fs).repo<ArchiveStory>('archiveStories').listLight();
    const cache = Object.keys(disk.dump()).find(p => p.startsWith('.ste-control/index/'))!;
    const data = JSON.parse(await fs.readText(cache)); data.entries[0][1].summary.title = 'corrupted';
    await fs.writeText(cache, JSON.stringify(data)); clear();
    expect((await createVault(fs).repo<ArchiveStory>('archiveStories').listLight()).map(s => s.title).sort()).toEqual(['s1', 's2']); expect(reads()).toBe(1);
  });
  it('does not rewrite an unchanged index and detects same-size external edits', async () => {
    const { fs } = await fixture(); await createVault(fs).repo<ArchiveStory>('archiveStories').listLight();
    const write = vi.spyOn(fs, 'writeText'); await createVault(fs).repo<ArchiveStory>('archiveStories').listLight(); expect(write).not.toHaveBeenCalled();
    const repo = createVault(fs).repo<ArchiveStory>('archiveStories'); await repo.get('s1');
    await fs.writeText(file('s1'), JSON.stringify(story('s1', 's9'))); expect((await repo.get('s1'))?.title).toBe('s9');
  });
});
