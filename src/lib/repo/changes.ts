import type { StoreName } from '@/lib/idb';
import { subscribeActiveVault } from '@/lib/vault/active';

type RecordChange = { store: StoreName; id: string };
const listeners = new Set<(change: RecordChange) => void>();
const versions = new Map<string, number>();
subscribeActiveVault(() => versions.clear());

export function getRecordVersion(store: StoreName, id: string): number {
  return versions.get(`${store}:${id}`) ?? 0;
}
export function subscribeRecordChanges(listener: (change: RecordChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Notify after persistence, or when a native cache is invalidated around a write/recovery. */
export function notifyRecordChanged(store: StoreName, id: string): void {
  const key = `${store}:${id}`;
  versions.set(key, (versions.get(key) ?? 0) + 1);
  for (const listener of listeners) listener({ store, id });
}
