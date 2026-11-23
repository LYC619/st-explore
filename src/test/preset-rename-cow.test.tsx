import { expect, it } from 'vitest';
import { db, editInput, fixture, mount, save, setupNavigation } from '@/test/asset-navigation-test-support';
setupNavigation();
it('renaming a preset through the character editor persists the entered name in its new private copy', async () => {
  await mount('preset', '?assetId=A&characterId=char1');
  await editInput(document.querySelector('input[aria-label="预设名称"]')!, 'Synthetic renamed preset');
  await save('preset');
  expect(db.preset.save).toHaveBeenCalledTimes(1);
  expect(db.preset.save.mock.calls[0][0].title).toBe('Synthetic renamed preset');
});
it('renaming also reaches an existing character-specific copy', async () => {
  const base = fixture('preset', 'A');
  db.preset.all.mockResolvedValue([base, { ...base, id: 'private', title: 'Old private name',
    derived: { derivedFrom: 'A', characterId: 'char1', diverged: true, createdAt: 1, updatedAt: 1 } }]);
  await mount('preset', '?assetId=A&characterId=char1');
  await editInput(document.querySelector('input[aria-label="预设名称"]')!, 'Synthetic renamed private');
  await save('preset');
  expect(db.preset.save.mock.calls[0][0]).toMatchObject({ id: 'private', title: 'Synthetic renamed private' });
});
