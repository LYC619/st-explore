import { openDB } from '@/lib/idb';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import type { VaultFs } from '@/lib/vault/fs';
import { validWorldMedia, type WorldMedia } from './asset';
const ROOT = '世界素材';
export function currentMediaRepo() {
  const vault = getActiveVault(), epoch = getVaultEpoch();
  return new WorldMediaRepo(vault?.fs ?? null, () => { if (epoch !== getVaultEpoch() || vault !== getActiveVault()) throw new Error('资料库已切换'); });
}
/** Immutable content-addressed derived assets. Source paths are never written or exported. */
export class WorldMediaRepo {
  constructor(private fs: VaultFs | null, private guard: () => void = () => {}) {}
  private async path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('素材引用无效');
    if (this.fs) {
      const root = (await this.fs.list('')).find(e => e.name === ROOT);
      const file = (await this.fs.list(ROOT)).find(e => e.name === `${id}.json`);
      if (root && (root.isSymlink || !root.isDir) || file && (file.isSymlink || file.isDir)) throw new Error('素材路径不安全');
    }
    this.guard(); return `${ROOT}/${id}.json`;
  }
  async get(id: string): Promise<WorldMedia | undefined> {
    this.guard(); const path = await this.path(id); let value: unknown;
    if (this.fs) { const stat = await this.fs.stat(path); if (!stat.exists) return; if ((stat.size ?? 0) > 7_000_000) throw new Error('素材文件过大'); value = JSON.parse(await this.fs.readText(path)); }
    else { const db = await openDB(); value = await new Promise((resolve, reject) => { const r = db.transaction('worldMedia').objectStore('worldMedia').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
    this.guard(); if (value === undefined) return; if (!validWorldMedia(value)) throw new Error('素材已损坏'); return value;
  }
  async put(value: WorldMedia) {
    this.guard(); if (!validWorldMedia(value)) throw new Error('素材无效'); if (await this.get(value.id)) return;
    const path = await this.path(value.id);
    if (this.fs) {
      await this.fs.mkdir(ROOT); const temp = `${ROOT}/.${crypto.randomUUID()}.tmp`, text = JSON.stringify(value);
      await this.fs.writeText(temp, text); if (await this.fs.readText(temp) !== text) throw new Error('素材写入校验失败'); this.guard();
      try { await this.fs.rename(temp, path); } catch (reason) { if (!await this.get(value.id)) throw reason; }
    } else { const db = await openDB(); this.guard(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('worldMedia','readwrite'); tx.objectStore('worldMedia').put(value); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
  }
}
