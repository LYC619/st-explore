import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createIdbRepo } from '@/lib/repo/idb-repo';

beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { closeDB(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('does not acknowledge a write when its transaction aborts after the request succeeds', async () => {
  const repo = createIdbRepo('archiveStories');
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(repo.put({ id: 'cancelled-story', updatedAt: 1 })).rejects.toThrow();
  expect(await repo.get('cancelled-story')).toBeUndefined();
});

it('returns only after a successful write is committed', async () => {
  const repo = createIdbRepo('archiveStories');
  let complete = false;
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    this.transaction.addEventListener('complete', () => { complete = true; });
    return original.apply(this, args);
  });
  await repo.put({ id: 'saved-story', updatedAt: 1 });
  expect(complete).toBe(true);
});
