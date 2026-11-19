import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import type { VaultFs } from './fs';

interface Coordinator { queue: KeyedSerialQueue; revision: number; activeCharacterSaves: Set<string> }
const objects = new WeakMap<object, Coordinator>();
const roots = new Map<string, Coordinator>();

/** Shared by handles for the same library in this JS runtime; not an OS/process lock. */
export function mutationCoordinator(fs: VaultFs): Coordinator {
  const identity = fs.mutationIdentity ?? fs;
  const found = typeof identity === 'string' ? roots.get(identity) : objects.get(identity);
  if (found) return found;
  const value: Coordinator = { queue: new KeyedSerialQueue(), revision: 0, activeCharacterSaves: new Set() };
  if (typeof identity === 'string') roots.set(identity, value);
  else objects.set(identity, value);
  return value;
}

/** Maintenance uses the same lock and invalidates backend indexes after disk moves. */
export function withVaultMutation<T>(fs: VaultFs, task: () => Promise<T>): Promise<T> {
  const state = mutationCoordinator(fs);
  return state.queue.enqueue('records', async () => {
    try { return await task(); }
    finally { state.revision++; }
  });
}
