import { expect, it } from 'vitest';
import { button, click, db, dialog, editInput, go, mount, navigationTests, save } from './asset-navigation-test-support';

navigationTests('regex');

it('treats title-only edits as dirty and establishes a new title baseline after saving', async () => {
  await mount('regex');
  const input = document.querySelector<HTMLInputElement>('input[placeholder^="规则集名称"]')!;
  await editInput(input, 'Renamed A');
  await go('?assetId=B');
  expect(dialog()).not.toBeNull();
  await click(button('取消', dialog()!));
  expect(input.value).toBe('Renamed A');
  await save('regex');
  expect(db.regex.save.mock.calls.at(-1)![0]).toMatchObject({ id: 'A', title: 'Renamed A' });
  await go('?assetId=B');
  expect(dialog()).toBeNull();
});
