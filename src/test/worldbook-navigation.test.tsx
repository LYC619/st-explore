import { act } from 'react';
import { expect, it, vi } from 'vitest';
import type { WorldBookItem } from '@/types/worldbook';
import { button, click, db, deferred, dialog, dirty, expectContent, fixture, go, mount, navigationTests, query, save } from './asset-navigation-test-support';

navigationTests('worldbook');

it('keeps the AI handoff as an unsaved draft on first mount', async () => {
  sessionStorage.setItem('ai-worldbook-import', JSON.stringify((fixture('worldbook', 'C') as WorldBookItem).worldbook));
  await mount('worldbook', '', true);
  await expectContent('worldbook', 'C');
  expect(db.worldbook.save).not.toHaveBeenCalled();
});

it('does not let an older save retarget a newly imported worldbook', async () => {
  await mount('worldbook');
  const oldSave = deferred<void>();
  db.worldbook.save.mockReturnValueOnce(oldSave.promise);
  await save('worldbook');
  const imported = fixture('worldbook', 'B') as WorldBookItem;
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [{
    name: 'Imported B.json', text: async () => JSON.stringify(imported.worldbook),
  }] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click(button('替换当前'));
  // The replacement joins the serial writer; it cannot complete the old write.
  expect(db.worldbook.save).toHaveBeenCalledTimes(1);
  await act(async () => oldSave.resolve());
  expect(db.worldbook.save).toHaveBeenCalledTimes(2);
  const importedId = db.worldbook.save.mock.calls[1][0].id;
  await expectContent('worldbook', 'B');
  await save('worldbook');
  expect(db.worldbook.save.mock.calls.at(-1)![0]).toMatchObject({ id: importedId, title: 'Imported B' });
  expect(query().get('assetId')).toBe(importedId);
});

it('a late cross-book move cannot remove entries from the newly accepted book', async () => {
  await mount('worldbook');
  await click(button('批量'));
  await click(button('全选(1)'));
  await click(button('复制/转移'));
  const target = document.querySelector<HTMLElement>('[role="dialog"] [role="combobox"]')!;
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((element) => element.textContent === 'Asset B')!;
  expect(option).toBeTruthy();
  await act(async () => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await click(document.querySelector('#cp-move'));
  const write = deferred<void>();
  db.worldbook.save.mockReturnValueOnce(write.promise);
  await click(button('转移'));
  expect(db.worldbook.save).toHaveBeenCalledTimes(1);
  await go('?assetId=C');
  await expectContent('worldbook', 'C');
  await act(async () => write.resolve());
  await expectContent('worldbook', 'C');
});

it('does not let an old recent-list refresh replace the new save base', async () => {
  await mount('worldbook');
  const refresh = deferred<WorldBookItem[]>();
  db.worldbook.all.mockReturnValueOnce(refresh.promise);
  await click(Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('最近打开')));
  await go('?assetId=B');
  await act(async () => refresh.resolve([fixture('worldbook', 'A') as WorldBookItem]));
  await save('worldbook');
  expect(db.worldbook.save.mock.calls.at(-1)![0]).toMatchObject({ id: 'B', createdAt: 1 });
});

it('keeps recent-list cancellation separate from URL rollback and accepts the chosen list item', async () => {
  // This checks the dirty confirmation before autosave, independent of CPU load.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    await mount('worldbook');
    await dirty('worldbook');
    await click(Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('最近打开')));
    const loadB = () => Array.from(document.querySelectorAll('[role="dialog"] button')).find((element) => element.textContent?.includes('Asset B'));
    await click(loadB());
    await click(button('取消', dialog()!));
    expect(query().get('assetId')).toBe('A');
    expect(document.querySelector('[data-action]')).toHaveAttribute('data-action', 'POP');
    await click(loadB());
    await click(button('确认加载', dialog()!));
    expect(query().get('assetId')).toBe('B');
    await expectContent('worldbook', 'B');
    await save('worldbook');
    expect(db.worldbook.save.mock.calls.at(-1)![0].id).toBe('B');
  } finally { vi.useRealTimers(); }
});
