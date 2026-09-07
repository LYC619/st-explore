import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPlan, ReadingPackInput } from '@/lib/data-source';
import type { ParsedReadingPack } from '@/types/reading-pack';

const mocks = vi.hoisted(() => ({
  parse: vi.fn(), inspect: vi.fn(), apply: vi.fn(), toast: vi.fn(), save: vi.fn(),
}));
vi.mock('@/lib/reading-pack/reading-pack-worker-client', () => ({ parseReadingPackFile: mocks.parse }));
vi.mock('@/lib/data-source', () => ({ readingPackSource: { inspect: mocks.inspect, apply: mocks.apply } }));
vi.mock('@/lib/archive-db', () => ({
  getAllCharacters: async () => [], getAllArchiveStories: async () => [],
  getCharacter: async () => undefined, getArchiveStory: async () => undefined,
  saveCharacter: mocks.save, saveArchiveStory: mocks.save,
}));
vi.mock('@/lib/summary-db', () => ({ getAllSummaries: async () => [], saveSummary: mocks.save }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
import { ReadingPackImportDialog } from '@/components/settings/ReadingPackImportDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const parsed = { media: new Map() } as ParsedReadingPack;
const planFor = (origin: string): ImportPlan => ({
  kind: 'reading-pack', origin, characters: [{ id: origin, label: origin, action: 'add' }],
  stories: [], summaries: [], totals: { add: 1, overwrite: 0, skip: 0 },
});
let root: Root;
let host: HTMLDivElement;
let mounted: boolean;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;
const render = (open = true) => act(async () => { root.render(<ReadingPackImportDialog open={open} onOpenChange={onOpenChange} />); });
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  .find(b => b.textContent?.includes(label));
async function select(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['data'], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parse.mockResolvedValue(parsed);
  mocks.inspect.mockImplementation(async (input: ReadingPackInput) => planFor(input.origin));
  mocks.apply.mockResolvedValue({ written: { characters: 1, stories: 0, summaries: 0 }, skipped: 0, warnings: [] });
  onOpenChange = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(() => { if (mounted) act(() => root.unmount()); host.remove(); });

describe('reading pack dialog request ownership', () => {
  it('uses the same parsed input for inspect and apply, then releases the plan', async () => {
    await render();
    await select('valid.ste-reading');
    expect(mocks.inspect.mock.calls[0][0].parsed).toBe(parsed);
    const inspectedInput = mocks.inspect.mock.calls[0][0];
    await act(async () => button('确认导入')!.click());
    expect(mocks.apply.mock.calls[0][0]).toBe(inspectedInput);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await render(false);
    await render();
    expect(button('确认导入')).toBeUndefined();
  });

  it('can cancel while reading and ignores the eventual parsed result', async () => {
    const pending = deferred<ParsedReadingPack>();
    mocks.parse.mockReturnValue(pending.promise);
    await render();
    await select('pending.ste-reading');
    expect(button('取消')).not.toBeDisabled();
    await act(async () => button('取消')!.click());
    expect(mocks.parse.mock.calls[0][1].aborted).toBe(true);
    await act(async () => pending.resolve(parsed));
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('does not let old success or finally overwrite a new selection or clear its busy state', async () => {
    const a = deferred<ParsedReadingPack>();
    const b = deferred<ParsedReadingPack>();
    mocks.parse.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await render();
    await select('A.ste-reading');
    const aSignal = mocks.parse.mock.calls[0][1] as AbortSignal;
    await select('B.ste-reading');
    expect(aSignal.aborted).toBe(true);
    await act(async () => a.resolve(parsed));
    expect(button('读取中')).toBeDisabled();
    expect(button('确认导入')).toBeUndefined();
    await act(async () => b.resolve(parsed));
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('B.ste-reading');
    expect(document.body.textContent).not.toContain('A.ste-reading');
  });

  it('ignores a previous inspect result arriving after the next plan', async () => {
    const inspection = deferred<ImportPlan>();
    mocks.inspect.mockReturnValueOnce(inspection.promise);
    await render();
    await select('A.ste-reading');
    await select('B.ste-reading');
    await act(async () => inspection.resolve(planFor('A.ste-reading')));
    expect(document.body.textContent).toContain('B.ste-reading');
    expect(document.body.textContent).not.toContain('A.ste-reading');
    expect(button('确认导入')).not.toBeDisabled();
  });

  it('clears a previous plan before parsing another file and does not write on error', async () => {
    await render();
    await select('A.ste-reading');
    mocks.parse.mockRejectedValueOnce(new Error('bad ZIP'));
    await select('bad.ste-reading');
    expect(button('确认导入')).toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '读取阅读包失败' }));
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(['close', 'unmount'])('cancels on %s and suppresses stale errors', async (action) => {
    const pending = deferred<ParsedReadingPack>();
    mocks.parse.mockReturnValue(pending.promise);
    await render();
    await select('pending.ste-reading');
    const signal = mocks.parse.mock.calls[0][1] as AbortSignal;
    if (action === 'close') await render(false);
    else { act(() => root.unmount()); mounted = false; }
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new Error('late error')));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
