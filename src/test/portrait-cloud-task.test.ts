import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortraitCloudTaskStore } from '@/lib/portrait-cloud-task';
import type { ArchiveCharacter } from '@/types/archive';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const links = Array.from({ length: 9 }, (_, i) => ({ name: `图片${i}`, url: `https://x.test/${i}.png` }));
const target = { characterId: 'original', characterName: '原角色', rowId: 'row-a', rowTitle: '表情' };
const file = new File(['png'], '立绘.png');
const stores: PortraitCloudTaskStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

function setup(overrides: Partial<ConstructorParameters<typeof PortraitCloudTaskStore>[0]> = {}) {
  let epoch = 1;
  let changed = () => {};
  const saved: string[] = [];
  const store = new PortraitCloudTaskStore({
    download: async () => file,
    save: async (destination) => { saved.push(`${destination.characterId}/${destination.rowId}`); return { id: destination.characterId } as ArchiveCharacter; },
    getEpoch: () => epoch,
    subscribeEpoch: listener => { changed = listener; return () => {}; },
    ...overrides,
  });
  stores.push(store);
  return { store, saved, switchVault: () => { epoch++; changed(); } };
}

describe('background portrait task', () => {
  it('uses captured item rows, skips existing items and retries only one failed item', async () => {
    let fail = true; const calls: string[] = [];
    const { store, saved } = setup({
      download: async link => { calls.push(link.url); if (fail) throw new Error('offline'); return file; },
      checkExisting: async (_target, link) => link.url.endsWith('0.png'),
    });
    store.start(target, links.slice(0, 3).map((link, index) => ({ ...link, rowId: `row-${index}`, rowTitle: `分行${index}` })));
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(store.getSnapshot()?.items.map(item => item.status)).toEqual(['skipped', 'failed', 'failed']);
    fail = false; store.retry(1);
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(store.getSnapshot()?.items.map(item => item.status)).toEqual(['skipped', 'saved', 'failed']);
    expect(saved).toEqual(['original/row-1']); expect(calls).toHaveLength(3);
  });
  it('runs four workers and bounds downloaded files awaiting serialized saves', async () => {
    const gate = deferred<void>();
    let downloads = 0;
    const { store } = setup({ download: async () => { downloads++; return file; }, save: async () => { await gate.promise; return { id: 'original' } as ArchiveCharacter; } });
    store.start(target, links);
    await vi.waitFor(() => expect(downloads).toBe(4));
    expect(store.getSnapshot()?.items.filter(item => item.status === 'saving')).toHaveLength(4);
    gate.resolve();
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(downloads).toBe(9);
    expect(store.getSnapshot()?.items.every(item => item.status === 'saved')).toBe(true);
  });

  it('keeps downloading after the UI observer unmounts and fixes the original destination', async () => {
    const gate = deferred<File>();
    const { store, saved } = setup({ download: () => gate.promise });
    const unsubscribe = store.subscribe(() => {});
    const selected = { ...target };
    store.start(selected, links.slice(0, 2));
    selected.characterId = 'other'; selected.rowId = 'other-row';
    unsubscribe();
    gate.resolve(file);
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(saved).toEqual(['original/row-a', 'original/row-a']);
  });

  it('cancels downloads immediately on a vault switch and refuses retry in another epoch', async () => {
    const gate = deferred<File>();
    const signals: AbortSignal[] = [];
    const { store, saved, switchVault } = setup({ download: (_link, signal) => { signals.push(signal); return gate.promise; } });
    store.start(target, links);
    switchVault();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    gate.resolve(file);
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('cancelled'));
    expect(saved).toEqual([]);
    expect(() => store.retry()).toThrow(/资料库/);
  });

  it('retries only unfinished items and keeps successful images after cancel', async () => {
    let attempt = 0;
    const { store, saved } = setup({ download: async (link) => { if (link.url === links[1].url && attempt++ === 0) throw new Error('HTTP 503'); return file; } });
    store.start(target, links.slice(0, 2));
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(store.getSnapshot()?.items.map(item => item.status)).toEqual(['saved', 'failed']);
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot()?.items.every(item => item.status === 'saved')).toBe(true));
    expect(saved).toHaveLength(2);
  });

  it('stops pending downloads while retaining successful saves for a later retry', async () => {
    const gate = deferred<File>();
    let retrying = false;
    const { store, saved } = setup({ download: async link => link.url === links[0].url || retrying ? file : gate.promise });
    store.start(target, links.slice(0, 3));
    await vi.waitFor(() => expect(store.getSnapshot()?.items[0].status).toBe('saved'));
    store.cancel();
    gate.resolve(file);
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('cancelled'));
    expect(saved).toHaveLength(1);
    expect(store.getSnapshot()?.items.map(item => item.status)).toEqual(['saved', 'cancelled', 'cancelled']);
    retrying = true;
    store.retry();
    await vi.waitFor(() => expect(store.getSnapshot()?.status).toBe('completed'));
    expect(saved).toHaveLength(3);
  });
});
