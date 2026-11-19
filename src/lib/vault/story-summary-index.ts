import { sha256 } from 'js-sha256';
import type { BaseRecord } from '@/lib/repo/idb-repo';
import type { VaultFs, VaultStat } from './fs';

const FILE = '.ste-control/index/story-summaries-v2.json';
const MAX_BYTES = 32 * 1024 * 1024;
interface Entry { stamp: string; digest: string; summary: BaseRecord }
export function fileStamp(stat: VaultStat): string | undefined {
  return stat.exists && !stat.isDir && Number.isFinite(stat.size) && Number.isFinite(stat.modifiedAt)
    ? `${stat.size}:${stat.modifiedAt}` : undefined;
}
/** Optional, disposable acceleration only. Paths/ids are discovered from the current directory scan. */
export class StorySummaryIndex {
  private previous = new Map<string, Entry>();
  private next = new Map<string, Entry>();
  constructor(private fs: VaultFs, private file = FILE) {}
  async load(): Promise<void> {
    try {
      const stat = await this.fs.stat(this.file);
      if (!stat.exists || stat.size === undefined || stat.size > MAX_BYTES) return;
      const text = await this.fs.readText(this.file);
      if (text.length > MAX_BYTES) return;
      const data = JSON.parse(text);
      if (data?.schema !== 2 || !Array.isArray(data.entries) || data.entries.length > 100000) return;
      for (const pair of data.entries) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [path, entry] = pair;
        if (typeof path !== 'string' || !entry || typeof entry.stamp !== 'string' || typeof entry.digest !== 'string'
          || !entry.summary || typeof entry.summary.id !== 'string' || 'session' in entry.summary || 'branches' in entry.summary
          || sha256(JSON.stringify(entry.summary)) !== entry.digest) continue;
        this.previous.set(path, entry);
      }
    } catch { /* Corrupt, old, missing or unreadable cache: rebuild from the source records. */ }
  }
  get(path: string, stamp: string | undefined): BaseRecord | undefined {
    const entry = this.previous.get(path);
    if (!stamp || entry?.stamp !== stamp) return;
    this.next.set(path, entry);
    return entry.summary;
  }
  retain(path: string, stamp: string | undefined, summary: BaseRecord): void {
    if (stamp) this.next.set(path, { stamp, summary, digest: sha256(JSON.stringify(summary)) });
  }
  async save(): Promise<void> {
    try {
      if (!this.next.size && !this.previous.size) return;
      if (this.next.size === this.previous.size && [...this.next].every(([path, entry]) => {
        const old = this.previous.get(path); return old?.stamp === entry.stamp && old.digest === entry.digest;
      })) return;
      const text = JSON.stringify({ schema: 2, entries: [...this.next] });
      if (new TextEncoder().encode(text).length > MAX_BYTES) return;
      await this.fs.writeText(this.file, text);
    } catch { /* Cache writes must never turn a readable library into a startup failure. */ }
    finally { this.previous.clear(); this.next.clear(); }
  }
}
