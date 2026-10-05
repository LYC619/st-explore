import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorldbookEntries, type WorldbookEntryActions } from '@/hooks/use-worldbook-entries';
import { DEFAULT_ENTRY, exportWorldBook, type WorldBook } from '@/types/worldbook';
import { ToastAction } from '@/components/ui/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
