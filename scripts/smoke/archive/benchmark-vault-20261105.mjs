// Actual local disk I/O with the production vault backend; never opens the source for writes.
import * as disk from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve('.cache/1105-performance/vault');
const output = path.resolve(process.argv[2] || '.cache/1105-performance/before.json');
const source = 'D:/2.数据库/我的STExplore';
if (process.argv.includes('--prepare')) {
  let count = 0, bytes = 0;
  async function copy(dir = '') {
    for (const entry of await disk.readdir(path.join(source, dir), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (dir || ['角色', '临时', '资产'].includes(entry.name)) await copy(rel); }
      else if (/\.(json|md)$/.test(entry.name) || entry.name === '卡片.png') {
        await disk.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        await disk.copyFile(path.join(source, rel), path.join(root, rel));
        bytes += (await disk.stat(path.join(root, rel))).size; count++;
      }
    }
  }
  await copy(); console.log(JSON.stringify({ prepared: count, bytes }));
}
let metrics;
const resolve = rel => {
  const absolute = path.resolve(root, rel);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error('out of benchmark root');
  return absolute;
};
const fs = {
  async list(dir) {
    metrics.lists++;
    let entries; try { entries = await disk.readdir(resolve(dir), { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return Promise.all(entries.map(async e => { const s = await disk.stat(resolve(path.join(dir, e.name))); return { name: e.name, isDir: e.isDirectory(), isSymlink: e.isSymbolicLink(), size: s.size, modifiedAt: s.mtimeMs }; }));
  },
  async stat(rel) { metrics.stats++; try { const s = await disk.stat(resolve(rel)); return { exists: true, isDir: s.isDirectory(), size: s.size, modifiedAt: s.mtimeMs }; } catch (e) { if (e.code === 'ENOENT') return { exists: false, isDir: false }; throw e; } },
  async readText(rel) { const data = await disk.readFile(resolve(rel)); metrics.reads++; metrics.bytes += data.length; if (rel.endsWith('/故事.json')) metrics.storyReads++; return data.toString('utf8'); },
  async readBinary(rel) { const data = await disk.readFile(resolve(rel)); metrics.binaryReads++; metrics.bytes += data.length; return data.toString('base64'); },
  async writeText(rel, content) { metrics.writes++; metrics.writeBytes += Buffer.byteLength(content); await disk.mkdir(path.dirname(resolve(rel)), { recursive: true }); await disk.writeFile(resolve(rel), content); },
  async writeBinary(rel, data) { await disk.writeFile(resolve(rel), Buffer.from(data, 'base64')); },
  removeFile: rel => disk.unlink(resolve(rel)),
  async removeEmptyDir(rel) { try { await disk.rmdir(resolve(rel)); return true; } catch (e) { if (['ENOTEMPTY', 'ENOENT'].includes(e.code)) return false; throw e; } },
  rename: (from, to) => disk.rename(resolve(from), resolve(to)),
  mkdir: rel => disk.mkdir(resolve(rel), { recursive: true }),
};
const server = await createServer({ configFile: false, resolve: { alias: { '@': path.resolve('src') } }, server: { middlewareMode: true, watch: null }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { createVault } = await server.ssrLoadModule('/src/lib/vault/vault-backend.ts');
  const results = [];
  for (let run = 0; run < 3; run++) {
    metrics = { reads: 0, storyReads: 0, binaryReads: 0, bytes: 0, lists: 0, stats: 0, writes: 0, writeBytes: 0 };
    const start = performance.now();
    const vault = createVault(fs);
    const stories = await vault.repo('archiveStories').listLight();
    const startup = { ms: performance.now() - start, ...metrics };
    const largest = [];
    for (const s of stories) { const p = await vault.pathOf('archiveStories', s.id); largest.push({ id: s.id, size: (await disk.stat(resolve(p + '/故事.json'))).size }); }
    largest.sort((a,b) => b.size - a.size);
    const id = largest[0]?.id;
    const enterStart = performance.now(); const record = id ? await vault.repo('archiveStories').get(id) : null;
    const enterMs = performance.now() - enterStart;
    const reenterStart = performance.now(); if (id) await vault.repo('archiveStories').get(id);
    results.push({ run, stories: stories.length, startup, largestBytes: largest[0]?.size, floors: record?.session.messages.length, enterMs, reenterMs: performance.now() - reenterStart, total: { ...metrics }, nodeMemory: process.memoryUsage() });
  }
  await disk.mkdir(path.dirname(output), { recursive: true }); await disk.writeFile(output, JSON.stringify({ boundary: 'Node production vault + Windows disk; not WebView2 IPC', results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await server.close(); }
