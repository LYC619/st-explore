import { describe, expect, it } from 'vitest';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { serializeFrontmatter } from '@/lib/vault/frontmatter';

function fixture() {
  const base = createMemFs(), stamps = new Map<string, number>(), reads: string[] = [];
  let clock = 0;
  const fs: VaultFs = { ...base,
    writeText: async (path, text) => { await base.writeText(path, text); stamps.set(path, ++clock); },
    readText: async path => { reads.push(path); return base.readText(path); },
    list: async path => (await base.list(path)).map(entry => ({ ...entry, modifiedAt: stamps.get(`${path}/${entry.name}`) ?? 0 })),
    stat: async path => { const stat = await base.stat(path); const i = path.lastIndexOf('/');
      const entry = (await base.list(i < 0 ? '' : path.slice(0, i))).find(e => e.name === path.slice(i + 1));
      return { ...stat, size: entry?.size, modifiedAt: stamps.get(path) ?? 0 }; },
  };
  return { fs, reads, bodies: () => reads.filter(path => path.endsWith('.md') || path.includes('/故事树·')) };
}
const summary = (id: string, body = 'Synthetic '.repeat(1000)) => serializeFrontmatter({ id, title: id, updatedAt: 1 }, body);

describe('disposable summary and story-tree identities', () => {
  it('avoids unchanged bodies on reopen and refreshes edits, moves, deletions and orphans', async () => {
    const { fs, reads, bodies } = fixture();
    const md = '临时/遗留故事/分卷总结·one.md', tree = '临时/记录/故事树·two.json';
    await fs.writeText(md, summary('one')); await fs.writeText(tree, JSON.stringify({ id: 'two', updatedAt: 1, content: 'x'.repeat(20000) }));
    const first = createVault(fs); expect(await first.pathOf('summaries', 'one')).toBe(md);
    expect(await first.pathOf('stories', 'two')).toBe(tree); expect(bodies()).toHaveLength(2);
    reads.length = 0;
    const warm = createVault(fs); expect(await warm.pathOf('summaries', 'one')).toBe(md);
    expect(await warm.pathOf('stories', 'two')).toBe(tree); expect(bodies()).toEqual([]);
    await fs.writeText(md, summary('changed')); reads.length = 0;
    const changed = createVault(fs); expect(await changed.pathOf('summaries', 'one')).toBeUndefined();
    expect(await changed.pathOf('summaries', 'changed')).toBe(md); expect(bodies()).toEqual([md]);
    await fs.rename(md, '临时/记录/分卷总结·moved.md'); await fs.removeFile(tree); reads.length = 0;
    const moved = createVault(fs); expect(await moved.pathOf('summaries', 'changed')).toBe('临时/记录/分卷总结·moved.md');
    expect(await moved.pathOf('stories', 'two')).toBeUndefined();
    expect(bodies()).toEqual(['临时/记录/分卷总结·moved.md']);
  });

  it('rebuilds a corrupt cache and works without stable modification times', async () => {
    const { fs, reads, bodies } = fixture(); const path = '临时/记录/分卷总结·one.md';
    await fs.writeText(path, summary('one')); await createVault(fs).pathOf('summaries', 'one');
    await fs.writeText('.ste-control/index/record-identities-v2.json', '{broken'); reads.length = 0;
    expect(await createVault(fs).pathOf('summaries', 'one')).toBe(path); expect(bodies()).toEqual([path]);
    const unstamped = createMemFs(); await unstamped.writeText(path, summary('one'));
    expect(await createVault(unstamped).pathOf('summaries', 'one')).toBe(path);
    expect(await createVault(unstamped).pathOf('summaries', 'one')).toBe(path);
  });
});
