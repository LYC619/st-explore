import { bytesFromBase64, type WorldMedia } from './asset';
interface Entry { url: string; bytes: number; refs: number; used: number }
/** One pool per stage. Active images are pinned; old object URLs are revoked on LRU eviction and unmount. */
export class StageMediaPool {
  private entries = new Map<string, Entry>(); private closed = false; private clock = 0;
  constructor(readonly maxBytes = 32 * 1024 * 1024) {}
  get bytes() { return [...this.entries.values()].reduce((n, e) => n + e.bytes, 0); }
  get size() { return this.entries.size; }
  acquire(media: WorldMedia) {
    if (this.closed) throw new Error('舞台已关闭');
    let entry = this.entries.get(media.id);
    if (!entry) {
      const bytes = media.width * media.height * 4;
      for (const [id, old] of [...this.entries].sort((a,b) => a[1].used-b[1].used)) { if (this.bytes + bytes <= this.maxBytes) break; if (!old.refs) { URL.revokeObjectURL(old.url); this.entries.delete(id); } }
      if (this.bytes + bytes > this.maxBytes) throw new Error('素材显存预算已满，请使用较小的图片');
      const blob = new Blob([bytesFromBase64(media.data)], { type: media.mime });
      entry = { url: URL.createObjectURL(blob), bytes, refs: 0, used: ++this.clock }; this.entries.set(media.id, entry);
    }
    entry.refs++; entry.used = ++this.clock; let released = false;
    return { url: entry.url, release: () => { if (!released) { released = true; entry!.refs--; } } };
  }
  dispose() { this.closed = true; for (const e of this.entries.values()) URL.revokeObjectURL(e.url); this.entries.clear(); }
}
