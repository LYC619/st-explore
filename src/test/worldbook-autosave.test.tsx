import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorldbookAutosave } from '@/hooks/use-worldbook-autosave';
import { setActiveVault } from '@/lib/vault/active';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, container: HTMLDivElement;
let api: ReturnType<typeof useWorldbookAutosave<string>>;
let value: string, dirty: boolean, scope: string;
let save: ReturnType<typeof vi.fn<(value: string) => Promise<void>>>;
function Harness() {
  api = useWorldbookAutosave({ value, dirty, enabled: true, scope, save });
  return <output>{api.status}</output>;
}
async function render(next = value) { value = next; await act(async () => root.render(<Harness />)); }
beforeEach(() => {
  vi.useFakeTimers(); value = 'A'; dirty = false; scope = 'book'; save = vi.fn().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

it('does not save restored content; debounces three edits into the latest snapshot', async () => {
  await render(); await act(async () => vi.advanceTimersByTimeAsync(700)); expect(save).not.toHaveBeenCalled();
  dirty = true;
  for (const next of ['B', 'C', 'D']) { await render(next); await act(async () => vi.advanceTimersByTimeAsync(200)); }
  expect(save).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(600)); expect(save.mock.calls).toEqual([['D']]);
  expect(api.status).toBe('saved');
});
it('serializes in-flight edits and flush waits for the newest snapshot', async () => {
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  dirty = true; await render('B');
  let pending!: Promise<void>; await act(async () => { pending = api.flush(); });
  await render('C'); expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await pending; });
  expect(save.mock.calls).toEqual([['B'], ['C']]);
});
it('a failed save keeps the draft pending and explicit retry can save it', async () => {
  save.mockRejectedValueOnce(new Error('只读'));
  dirty = true; await render('B');
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(api.status).toBe('error'); expect(api.error?.message).toBe('只读');
  await act(async () => api.flush()); expect(save).toHaveBeenCalledTimes(2); expect(api.status).toBe('saved');
});
it('a library switch cancels a queued debounce instead of writing the old draft into the new library', async () => {
  dirty = true; await render('B'); setActiveVault(null);
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(save).not.toHaveBeenCalled(); expect(api.status).toBe('error');
});
it('a replacement flush waits for the new asset write after the previous asset finishes', async () => {
  let finishOld!: () => void, finishNew!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { finishOld = resolve; }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
  dirty = true; await render('old');
  await act(async () => { void api.flush(); });
  scope = 'imported'; await render('new');
  let completed = false;
  let pending!: Promise<void>;
  await act(async () => { pending = api.flush(true).then(() => { completed = true; }); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finishOld());
  expect(save.mock.calls).toEqual([['old'], ['new']]);
  expect(completed).toBe(false);
  await act(async () => { finishNew(); await pending; });
  expect(completed).toBe(true);
});
