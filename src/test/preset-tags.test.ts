import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { getArchiveSchemaVersion, getLibraryTagPreferences, saveLibraryTagPreferences, saveRoleplayPreferences, getRoleplayPreferences, setArchiveSchemaVersion } from '@/lib/archive-db';
import { defaultPresetTags, loadPresetTags, savePresetTags } from '@/lib/preset-tags';
import { DEFAULT_LIBRARY_TAG_PREFERENCES } from '@/lib/library-tag-preferences';
import { parsePreset } from '@/lib/preset-parser';
import { getPreset } from '@/lib/preset-db';
import type { PresetItem } from '@/types/preset';

afterEach(() => setActiveVault(null));

it('persists preset tag definitions without replacing the file vault schema, character tags or other preferences', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  await setArchiveSchemaVersion(7);
  await saveLibraryTagPreferences({ ...DEFAULT_LIBRARY_TAG_PREFERENCES, customTags: ['自定义/角色标签'] });
  await saveRoleplayPreferences({});
  const originalRoleplay = await getRoleplayPreferences();
  const prefs = await loadPresetTags();
  await Promise.all([
    savePresetTags({ ...prefs, tags: [...prefs.tags, '测试/新标签'] }, prefs),
    setArchiveSchemaVersion(8),
  ]);
  setActiveVault(createVault(fs));
  expect(await getArchiveSchemaVersion()).toBe(8);
  expect((await getLibraryTagPreferences()).customTags).toEqual(['自定义/角色标签']);
  expect(await getRoleplayPreferences()).toEqual(originalRoleplay);
  expect((await loadPresetTags()).tags).toContain('测试/新标签');
});

it('renames and deletes tags on real presets, preserves bodies and rejects stale definitions', async () => {
  setActiveVault(createVault(createMemFs()));
  const item: PresetItem = { id: 'p', title: 'fixture', createdAt: 1, updatedAt: 2,
    preset: parsePreset({ prompts: [{ identifier: 'main', content: 'body' }], prompt_order: [] }),
    catalog: { tags: ['类型/角色', '保留'], notes: '笔记' } };
  await getCurrentRepo<PresetItem>('presets').put(item);
  const original = defaultPresetTags();
  await savePresetTags({ ...original, tags: original.tags.map(t => t === '类型/角色' ? '类型/人物' : t) }, original, { from: '类型/角色', to: '类型/人物' });
  expect((await getPreset('p'))?.catalog?.tags).toEqual(['类型/人物', '保留']);
  expect((await getPreset('p'))?.preset).toEqual(item.preset);
  await expect(savePresetTags(original, original)).rejects.toThrow('其他位置修改');
  const current = await loadPresetTags();
  await savePresetTags({ ...current, tags: current.tags.filter(t => t !== '类型/人物') }, current, { from: '类型/人物' });
  expect((await getPreset('p'))?.catalog).toMatchObject({ tags: ['保留'], notes: '笔记' });
  setActiveVault(createVault(createMemFs()));
  expect(await loadPresetTags()).toEqual(defaultPresetTags());
});
