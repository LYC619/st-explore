import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorldbookEntries, type WorldbookEntryActions } from '@/hooks/use-worldbook-entries';
import { DEFAULT_ENTRY, exportWorldBook, type WorldBook, type WorldBookEntry } from '@/types/worldbook';
import { ToastAction } from '@/components/ui/toast';
import { EntryEditor } from '@/components/worldbook/EntryEditor';
import { useEntryFilters, type EntryFilterResult } from '@/hooks/use-entry-filters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const container = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); });

function setup(initial: WorldBook) {
  let book = initial;
  let actions: WorldbookEntryActions;
  let undo: (() => void) | undefined;
  function Harness() {
    const [value, setValue] = useState<WorldBook | null>(initial);
    book = value!;
    actions = useWorldbookEntries({ worldbook: value, setWorldbook: setValue, selectedUid: null,
      selectEntry: vi.fn(), clearSelectedEntry: vi.fn(), switchToEditTab: vi.fn(),
      toast: vi.fn(), renderUndoAction: callback => { undo = callback; return <ToastAction altText="撤销">撤销</ToastAction>; } });
    return null;
  }
  root = createRoot(container);
  act(() => root.render(<Harness />));
  return { get book() { return book; }, get actions() { return actions!; }, undo: () => { expect(undo).toBeTypeOf('function'); undo!(); } };
}

it('restores deleted content without duplicating a UID reused by another entry', () => {
  const state = setup({ entries: { '1': { ...DEFAULT_ENTRY, uid: 1, content: 'deleted' }, '2': { ...DEFAULT_ENTRY, uid: 2, content: 'kept' } } });
  act(() => state.actions.deleteEntry('1'));
  act(() => state.actions.updateEntry('2', { ...state.book.entries['2'], uid: 1 }));
  act(() => state.undo());
  const exported = Object.values(JSON.parse(exportWorldBook(state.book)).entries);
  expect(exported).toHaveLength(2);
  expect(exported).toEqual(expect.arrayContaining([expect.objectContaining({ content: 'deleted' }), expect.objectContaining({ content: 'kept' })]));
});

it('allocates distinct safe UIDs when the largest editable UID is present', () => {
  const state = setup({ entries: { high: { ...DEFAULT_ENTRY, uid: Number.MAX_SAFE_INTEGER, content: 'original' } } });
  act(() => state.actions.addEntry());
  act(() => state.actions.addEntry());
  const entries = Object.values(state.book.entries);
  expect(entries).toHaveLength(3);
  expect(entries.every(entry => Number.isSafeInteger(entry.uid))).toBe(true);
  expect(new Set(entries.map(entry => entry.uid)).size).toBe(3);
});

it('applies UID on blur and Enter while preserving invalid or occupied drafts', async () => {
  const changed = vi.fn();
  function Editor() {
    const [entry, setEntry] = useState<WorldBookEntry>({ ...DEFAULT_ENTRY, uid: 5 });
    return <EntryEditor entry={entry} usedUids={[5, 2]} onChange={next => { setEntry(next); changed(next); }} />;
  }
  root = createRoot(container); await act(async () => root.render(<Editor />));
  const input = container.querySelector<HTMLInputElement>('#entry-uid')!;
  const type = async (text: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await type(''); expect(changed).not.toHaveBeenCalled();
  await type('2'); await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(changed).not.toHaveBeenCalled(); expect(input.value).toBe('2');
  await type('9'); await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(changed.mock.calls.at(-1)?.[0].uid).toBe(9);
  await type('12'); await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(changed.mock.calls.at(-1)?.[0].uid).toBe(12);
});

it('starts with ascending UIDs and remembers the last display order after remount', () => {
  localStorage.clear();
  let state: EntryFilterResult;
  function Filters() { state = useEntryFilters([['high', { ...DEFAULT_ENTRY, uid: 5, order: 1 }], ['low', { ...DEFAULT_ENTRY, uid: 1, order: 8 }]]); return null; }
  root = createRoot(container); act(() => root.render(<Filters />));
  expect(state!.filteredEntries.map(([key]) => key)).toEqual(['low', 'high']);
  act(() => state!.controls.setSortMode('uid-desc'));
  act(() => root.unmount()); root = createRoot(container); act(() => root.render(<Filters />));
  expect(state!.controls.sortMode).toBe('uid-desc');
  expect(state!.filteredEntries.map(([key]) => key)).toEqual(['high', 'low']);
});
