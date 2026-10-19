import { getVaultEpoch } from '@/lib/vault/active';

const generating = new Map<string, number>();
const maintaining = new Set<string>();
const keyOf = (storyId: string) => JSON.stringify([getVaultEpoch(), storyId]);

export function assertStoryIdle(storyId: string): void {
  if (generating.has(keyOf(storyId))) throw new Error('故事正在生成，请等待生成完成并保存后重试');
}

/** The returned release belongs to the captured library, even after a library switch. */
export function beginStoryGeneration(storyId: string): () => void {
  const key = keyOf(storyId);
  if (maintaining.has(key)) throw new Error('故事正在维护，请等待操作完成后生成');
  generating.set(key, (generating.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (generating.get(key) ?? 1) - 1;
    if (count) generating.set(key, count); else generating.delete(key);
  };
}

export function acquireStoryMaintenance(storyId: string): () => void {
  assertStoryIdle(storyId);
  const key = keyOf(storyId);
  if (maintaining.has(key)) throw new Error('故事正在维护，请等待操作完成');
  maintaining.add(key);
  return () => { maintaining.delete(key); };
}
