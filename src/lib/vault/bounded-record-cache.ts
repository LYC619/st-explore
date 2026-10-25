/** Approximate retained JS bytes, including UTF-16 strings and container overhead. */
export interface FullCacheOptions {
  maxBytes?: number;
  maxEntries?: number;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 128;

function budget(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/**
 * Stop as soon as the budget is exceeded. Never stringify a full body or build
 * an array of all its values just to decide that it is too large to retain.
 * Very deep records bypass the cache instead of risking a recursive stack overflow.
 */
export function estimateRecordBytes(value: unknown, limit: number): number {
  let bytes = 0;
  const seen = new WeakSet<object>();
  function visit(item: unknown, depth: number): void {
    if (bytes > limit) return;
    if (typeof item === 'string') { bytes += item.length * 2; return; }
    if (!item || typeof item !== 'object') { bytes += 8; return; }
    if (seen.has(item)) return;
    if (depth > 128) { bytes = Infinity; return; }
    seen.add(item);
    if (Array.isArray(item)) {
      bytes += 24 + item.length * 8;
      for (let index = 0; index < item.length && bytes <= limit; index++) visit(item[index], depth + 1);
    } else {
      bytes += 32;
      for (const key in item) {
        if (bytes > limit) break;
        if (!Object.hasOwn(item, key)) continue;
        bytes += 8 + key.length * 2;
        if (bytes <= limit) visit((item as Record<string, unknown>)[key], depth + 1);
      }
    }
  }
  visit(value, 0);
  return bytes;
}

/** One LRU budget for all full-record stores in a vault. */
export class BoundedRecordCache<T> {
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;

  constructor(options: FullCacheOptions = {}) {
    this.maxBytes = budget(options.maxBytes, DEFAULT_MAX_BYTES);
    this.maxEntries = budget(options.maxEntries, DEFAULT_MAX_ENTRIES);
  }

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return structuredClone(hit.value);
  }

  /** Takes ownership of a private disk-read result; callers must only receive clones. */
  retain(key: string, value: T): void {
    this.delete(key);
    if (!this.maxEntries || !this.maxBytes) return;
    const bytes = estimateRecordBytes(value, this.maxBytes);
    // A single oversized record must not evict otherwise useful records.
    if (bytes > this.maxBytes) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }

  delete(key: string): void {
    const hit = this.entries.get(key);
    if (!hit) return;
    this.bytes -= hit.bytes;
    this.entries.delete(key);
  }
}
