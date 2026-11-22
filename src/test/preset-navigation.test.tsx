import { expect, it } from 'vitest';
import { button, click, db, dialog, editInput, go, mount, navigationTests, save, tab } from './asset-navigation-test-support';

navigationTests('preset');

it('includes originalData fields in the dirty and saved baselines', async () => {
  await mount('preset');
  await tab('衔接与包裹格式');
  const input = document.querySelector<HTMLTextAreaElement>('textarea')!;
  await editInput(input, 'changed field');
  await go('?assetId=B');
  expect(dialog()).not.toBeNull();
  await click(button('继续编辑', dialog()!));
  await save('preset');
  expect(db.preset.save.mock.calls.at(-1)![0].preset.originalData.impersonation_prompt).toBe('changed field');
  await go('?assetId=B');
  expect(dialog()).toBeNull();
});

it('includes embedded regex rules in the dirty and saved baselines', async () => {
  await mount('preset');
  await tab('正则（1）');
  await click(document.querySelector('[role="tabpanel"][data-state="active"] [role="switch"]'));
  await go('?assetId=B');
  expect(dialog()).not.toBeNull();
  await click(button('继续编辑', dialog()!));
  await save('preset');
  expect(db.preset.save.mock.calls.at(-1)![0].preset.regexRules[0].disabled).toBe(true);
  await go('?assetId=B');
  expect(dialog()).toBeNull();
});
