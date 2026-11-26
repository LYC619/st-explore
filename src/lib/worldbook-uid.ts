import { tr } from '@/lib/i18n';
import type { WorldBook } from '@/types/worldbook';

/** Keep numeric identities unique, including when an edited UID reaches the safe integer limit. */
export function nextWorldbookNumber(taken: Iterable<number>): number {
  const values = new Set([...taken].filter(n => Number.isSafeInteger(n) && n >= 0));
  let max = -1;
  for (const value of values) max = Math.max(max, value);
  if (max < Number.MAX_SAFE_INTEGER) return max + 1;
  let candidate = 0;
  while (values.has(candidate)) candidate++;
  return candidate;
}

export function availableWorldbookIdentity(book: WorldBook, preferredUid?: number, preferredKey?: string) {
  const taken = new Set(Object.values(book.entries).map(entry => entry.uid));
  const uid = preferredUid !== undefined && Number.isSafeInteger(preferredUid) && preferredUid >= 0 && !taken.has(preferredUid)
    ? preferredUid : nextWorldbookNumber(taken);
  const wantedKey = preferredKey ?? String(uid);
  const key = Object.hasOwn(book.entries, wantedKey)
    ? String(nextWorldbookNumber(Object.keys(book.entries).map(Number))) : wantedKey;
  return { uid, key };
}

export function changeWorldbookUid(book: WorldBook, key: string, uid: number): WorldBook {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error(tr("UID 必须是非负安全整数"));
  const entry = book.entries[key];
  if (!entry) throw new Error(tr("条目不存在"));
  if (Object.entries(book.entries).some(([otherKey, other]) => otherKey !== key && other.uid === uid)) {
    throw new Error(tr("UID {{v0}} 已被占用", { v0: uid }));
  }
  if (entry.uid === uid) return book;
  // Dictionary keys stay stable while editing; exportWorldBook rebuilds the ST keys from UID.
  return { ...book, entries: { ...book.entries, [key]: { ...entry, uid } } };
}
