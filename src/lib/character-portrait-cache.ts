import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { getRecordVersion, subscribeRecordChanges } from '@/lib/repo/changes';
import { joinPath } from '@/lib/vault/fs';
import type { ArchiveCharacter } from '@/types/archive';

/** Original PNG strings only. Full profiles and browser object URLs never live here. */
export class CharacterPortraitCache {
  private entries = new Map<string, { value: string | undefined; bytes: number }>();
  private pending = new Map<string, Promise<string | undefined>>();
  private bytes = 0;
  private active = 0;
  private waiting: Array<() => void> = [];
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  constructor(options: { maxBytes?: number; maxEntries?: number } = {}) {
    this.maxBytes = Math.max(0, options.maxBytes ?? 16 * 1024 * 1024);
    this.maxEntries = Math.max(0, options.maxEntries ?? 48);
  }
  read(key: string, load: () => Promise<string | undefined>): Promise<string | undefined> {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key); this.entries.set(key, hit);
      return Promise.resolve(hit.value);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Schedule after pending registration so identity checks can safely refer
    // to this promise, including when a queued read has been invalidated.
    const promise = Promise.resolve().then(async () => {
      await new Promise<void>(resolve => {
        const enter = () => { this.active++; resolve(); };
        if (this.active < 4) enter(); else this.waiting.push(enter);
      });
      try {
        if (this.pending.get(key) !== promise) return undefined;
        const value = await load();
        const bytes = (value?.length ?? 0) * 2;
        if (this.pending.get(key) === promise && this.maxEntries > 0 && bytes <= this.maxBytes) {
          while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
            this.delete(this.entries.keys().next().value!);
          }
          this.entries.set(key, { value, bytes }); this.bytes += bytes;
        }
        return value;
      } finally {
        if (this.pending.get(key) === promise) this.pending.delete(key);
        this.active--; this.waiting.shift()?.();
      }
    });
    this.pending.set(key, promise);
    return promise;
  }
  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  invalidate(prefix: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.delete(key);
    for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
  }
  clear(): void { this.entries.clear(); this.pending.clear(); this.bytes = 0; }
}

const portraits = new CharacterPortraitCache();
const identity = (id: string) => `${getVaultEpoch()}:${JSON.stringify(id)}:`;
subscribeActiveVault(() => portraits.clear());
subscribeRecordChanges(({ store, id }) => { if (store === 'characters') portraits.invalidate(identity(id)); });

export function loadCharacterPortrait(id: string, updatedAt: number): Promise<string | undefined> {
  const vault = getActiveVault();
  const repo = vault ? undefined : getCurrentRepo<ArchiveCharacter>('characters');
  const key = `${identity(id)}${updatedAt}:${getRecordVersion('characters', id)}`;
  return portraits.read(key, async () => {
    if (!vault) return (await repo!.get(id))?.pngBase64;
    // Keep the same journal/recovery gate as full-record reads, but do not fill
    // the full-record cache just to display a portrait.
    await vault.assertCharacterWritable(id);
    const dir = await vault.pathOf('characters', id);
    if (!dir) return undefined;
    const path = joinPath(dir, '卡片.png');
    return (await vault.fs.stat(path)).exists ? vault.fs.readBinary(path) : undefined;
  });
}
