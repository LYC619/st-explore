/**
 * 当前激活的文件库后端（模块态开关）。
 * 网页版永不激活（保持 IndexedDB）；客户端在启动接线（7.2c）时 setActiveVault。
 * repo 层每次调用现查，激活/停用即时生效，上层 *-db.ts 无需重建。
 */
import type { VaultBackend } from './vault-backend';

let active: VaultBackend | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

export function setActiveVault(v: VaultBackend | null): void {
  active = v;
  epoch += 1;
  for (const listener of listeners) listener();
}

export function getActiveVault(): VaultBackend | null {
  return active;
}

/** A switch away and back must still invalidate in-flight work. */
export function getVaultEpoch(): number { return epoch; }

export function subscribeActiveVault(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
