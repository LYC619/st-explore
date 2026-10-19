import { expect, it, vi } from 'vitest';
import { PortraitPreviewCache } from '@/lib/portrait-preview-cache';
it('limits thumbnail requests, reuses bytes for import and releases object URLs', async () => {
  let active = 0, max = 0; const gates: Array<() => void> = [];
  const download = vi.fn(async (_link, signal: AbortSignal) => {
    active++; max = Math.max(max, active);
    await new Promise<void>(resolve => gates.push(resolve)); active--; signal.throwIfAborted();
    return new File(['fixture'], 'a.png', { type: 'image/png' });
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const cache = new PortraitPreviewCache(download);
  const entries = [0, 1, 2].map(index => cache.acquire({ name: 'a', url: `https://x.test/${index}.png` }));
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
  gates.shift()!(); await entries[0].promise;
  const file = await cache.reuse({ name: '修改名字', url: 'https://x.test/0.png' }, new AbortController().signal);
  expect(file?.name).toBe('修改名字.png'); expect(max).toBe(2);
  entries.forEach(entry => entry.release());
  const settled = Promise.allSettled(entries.map(entry => entry.promise));
  for (const resolve of gates) resolve(); await settled;
  cache.clearUnused(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  expect(cache.take({ name: 'a', url: 'https://x.test/0.png' })).toBeUndefined();
});
