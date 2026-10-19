import { downloadPortrait, portraitDownloadName, type PortraitLink } from './portrait-cloud';
interface Entry { refs: number; controller: AbortController; promise: Promise<File>; file?: File; objectUrl?: string; used: number }
/** Two thumbnail requests, 32 MB retained files. Imports reuse bytes while rows are visible. */
export class PortraitPreviewCache {
  private entries = new Map<string, Entry>();
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private download: typeof downloadPortrait = downloadPortrait, private maxBytes = 32 * 1024 * 1024) {}
  private async fetch(link: PortraitLink, signal: AbortSignal): Promise<File> {
    await new Promise<void>(resolve => {
      const enter = () => { this.active++; resolve(); };
      if (this.active < 2) enter(); else this.waiting.push(enter);
    });
    try { signal.throwIfAborted(); return await this.download(link, signal); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
  acquire(link: PortraitLink): { promise: Promise<string>; release: () => void } {
    let entry = this.entries.get(link.url);
    if (!entry) {
      const controller = new AbortController();
      entry = { refs: 0, controller, used: Date.now(), promise: Promise.resolve(undefined as unknown as File) };
      const current = entry;
      current.promise = this.fetch(link, controller.signal).then(file => { current.file = file; this.evict(); return file; }).catch(error => {
        if (this.entries.get(link.url) === current) this.entries.delete(link.url); throw error;
      });
      this.entries.set(link.url, current);
    }
    const current = entry; current.refs++; current.used = Date.now(); let released = false;
    return { promise: current.promise.then(file => {
      if (released) throw new DOMException('预览已取消', 'AbortError');
      return current.objectUrl ??= URL.createObjectURL(file);
    }), release: () => {
      if (released) return; released = true; current.refs--;
      if (!current.refs) {
        if (current.objectUrl) URL.revokeObjectURL(current.objectUrl); current.objectUrl = undefined;
        if (!current.file) { current.controller.abort(); if (this.entries.get(link.url) === current) this.entries.delete(link.url); }
        this.evict();
      }
    } };
  }
  take(link: PortraitLink): File | undefined {
    const entry = this.entries.get(link.url), file = entry?.file; if (!file) return undefined;
    entry!.used = Date.now(); return new File([file], portraitDownloadName(link.name, file.type), { type: file.type });
  }
  async reuse(link: PortraitLink, signal: AbortSignal): Promise<File | undefined> {
    if (!this.entries.has(link.url)) return undefined;
    signal.throwIfAborted(); const acquired = this.acquire(link);
    let abort = () => {};
    try {
      await Promise.race([acquired.promise, new Promise<never>((_, reject) => {
        abort = () => reject(new DOMException('已取消', 'AbortError')); signal.addEventListener('abort', abort, { once: true });
      })]);
      signal.throwIfAborted(); return this.take(link);
    } finally { signal.removeEventListener('abort', abort); acquired.release(); }
  }
  clearUnused(): void {
    for (const [key, entry] of this.entries) if (!entry.refs) { entry.controller.abort(); if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl); this.entries.delete(key); }
  }
  private evict(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + (entry.file?.size ?? 0), 0);
    for (const [key, entry] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes <= this.maxBytes) break; if (entry.refs) continue;
      bytes -= entry.file?.size ?? 0; if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl); this.entries.delete(key);
    }
  }
}
export const portraitPreviewCache = new PortraitPreviewCache();
