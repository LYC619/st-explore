import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { getArchiveSchemaVersion, getLibraryTagPreferences, saveLibraryTagPreferences, saveRoleplayPreferences, getRoleplayPreferences, setArchiveSchemaVersion, writePresetTagPreferences } from '@/lib/archive-db';
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
    catalog: { tags: ['用途/角色', '保留'], notes: '笔记' } };
  await getCurrentRepo<PresetItem>('presets').put(item);
  const original = defaultPresetTags();
  await savePresetTags({ ...original, tags: [...original.tags, '用途/人物'] }, original, { from: '用途/角色', to: '用途/人物' });
  expect((await getPreset('p'))?.catalog?.tags).toEqual(['用途/人物', '保留']);
  expect((await getPreset('p'))?.preset).toEqual(item.preset);
  await expect(savePresetTags(original, original)).rejects.toThrow('其他位置修改');
  const current = await loadPresetTags();
  await savePresetTags({ ...current, tags: current.tags.filter(t => t !== '用途/人物') }, current, { from: '用途/人物' });
  expect((await getPreset('p'))?.catalog).toMatchObject({ tags: ['保留'], notes: '笔记' });
  setActiveVault(createVault(createMemFs()));
  expect(await loadPresetTags()).toEqual(defaultPresetTags());
});

it('migrates legacy definitions individually, preserves all new defaults and keeps deleted default groups deleted after reopening', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  await writePresetTagPreferences({ id: 'preset-tags', updatedAt: 3, categories: ['类型', '风格', '收藏'],
    tags: ['类型/角色', '风格/沉浸', '状态/使用中', '状态/已停用', '收藏/精选'], hidden: ['状态/使用中'] }, 0);
  const migrated = await loadPresetTags();
  expect(migrated.categories).toEqual(['收藏', '状态', '评价']);
  expect(migrated.tags).toEqual(expect.arrayContaining(['状态/在用', '状态/备用', '状态/过期', '评价/优秀', '评价/良好', '评价/及格', '收藏/精选']));
  expect(migrated.tags).not.toContain('类型/角色');
  expect(migrated.tags).not.toContain('状态/使用中');
  expect(migrated.hidden).toEqual(['状态/在用']);
  await savePresetTags({ ...migrated, categories: migrated.categories.filter(c => c !== '状态'), tags: migrated.tags.filter(t => !t.startsWith('状态/')) }, migrated, { from: '状态', category: true });
  setActiveVault(createVault(fs));
  expect((await loadPresetTags()).categories).not.toContain('状态');
  expect((await loadPresetTags()).tags.some(t => t.startsWith('状态/'))).toBe(false);
});

it('deleting legacy status removes its fallback and keeps unrelated preset data', async () => {
  setActiveVault(createVault(createMemFs()));
  await getCurrentRepo<PresetItem>('presets').put({ id: 'legacy', title: '旧预设', createdAt: 1, updatedAt: 1,
    preset: parsePreset({ prompts: [], prompt_order: [] }), catalog: { status: 'active', notes: '保留笔记' } });
  const prefs = await loadPresetTags();
  await savePresetTags({ ...prefs, tags: prefs.tags.filter(t => t !== '状态/在用') }, prefs, { from: '状态/在用' });
  expect((await getPreset('legacy'))?.catalog).toMatchObject({ status: 'unreviewed', tags: [], notes: '保留笔记' });
});
