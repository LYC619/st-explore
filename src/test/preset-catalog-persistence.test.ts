// Authored for the next consolidated test batch; not run during the implementation batch.
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { listAssetIndex } from '@/lib/asset-index';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
import { createPresetDiy, getPreset, saveEditedPreset, savePresetDetails, updatePresetCatalog } from '@/lib/preset-db';
import { buildImportedPreset, buildPresetExportFiles, classifyPresetAttachment, exportPresetPackage, readPresetPackage } from '@/lib/preset-package';
import { inspectPresetScripts } from '@/lib/preset-catalog';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import type { PresetItem } from '@/types/preset';
import type { ArchiveCharacter } from '@/types/archive';

const raw = {
  prompts: [{ identifier: 'p', name: 'Opening', role: 'system', content: 'original prompt' }],
  prompt_order: [{ character_id: 100000, order: [{ identifier: 'p', enabled: true }] }],
  extensions: { tavern_helper: { scripts: [{ type: 'script', name: 'helper', content: 'throw new Error("must never execute")', custom: 42 }] },
    regex_scripts: [{ id: 'regex-1', scriptName: 'cleanup', findRegex: 'a', replaceString: 'b', placement: [2] }] },
  futureField: { retain: true },
};
function item(): PresetItem {
  return { id: 'preset-a', title: '作者预设', preset: parsePreset(raw), createdAt: 1, updatedAt: 2, autoSaved: true,
    catalog: { author: '作者 A', series: '系列 A', version: 'v1', models: ['Claude'], releaseNotes: '作者说明', notes: '我的感受', favorite: true },
    packageFiles: [{ id: 'f', name: 'helper.js', kind: 'script', text: 'globalThis.doNotRun = true;' }] };
}
function upload(name: string, text: string): File {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}
beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); setActiveVault(createVault(createMemFs())); });
afterEach(() => { setActiveVault(null); closeDB(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(['vault', 'idb'] as const)('%s preset management persistence', backend => {
  it('keeps catalog edits while saving a previously opened prompt and preserves them after reload', async () => {
    if (backend === 'idb') setActiveVault(null);
    const repo = getCurrentRepo<PresetItem>('presets');
    const original = item(); await repo.put(original);
    await updatePresetCatalog(original.id, { version: 'v2', tags: ['常用'] });
    const edited = structuredClone(original.preset); edited.prompts[0].content = 'edited';
    await saveEditedPreset(original.id, original.title, edited, original.preset);
    const restored = (await repo.get(original.id))!;
    expect(restored).toMatchObject({ autoSaved: false, catalog: { version: 'v2', tags: ['常用'] }, packageFiles: original.packageFiles });
    expect(restored.preset.prompts[0].content).toBe('edited');
    expect(JSON.parse(exportPreset(restored.preset))).toMatchObject({ futureField: raw.futureField, extensions: { tavern_helper: raw.extensions.tavern_helper } });
    await expect(saveEditedPreset(original.id, 'stale', original.preset, original.preset)).rejects.toThrow('其他位置');
    if (backend === 'idb') await repo.remove(original.id);
  });
});

it('round-trips package and catalog through native serialization and projects only bounded metadata', async () => {
  const disk = createMemFs();
  setActiveVault(createVault(disk));
  const original = item(); original.catalog!.notes = 'personal note '.repeat(20000);
  await getCurrentRepo<PresetItem>('presets').put(original);
  setActiveVault(createVault(disk));
  expect(await getPreset(original.id)).toEqual(original);
  const [summary] = await listAssetIndex('presets');
  expect(summary).not.toHaveProperty('preset'); expect(summary).not.toHaveProperty('packageFiles');
  expect(summary.catalog).not.toHaveProperty('notes'); expect(summary.catalog?.noteExcerpt?.length).toBeLessThanOrEqual(180);
  expect(summary).toMatchObject({ packageFileCount: 1, catalog: { author: '作者 A', version: 'v1' } });
});

it('rejects stale metadata saves but does not reject a change limited to prompt content', async () => {
  const original = item(); await getCurrentRepo<PresetItem>('presets').put(original);
  const edited = structuredClone(original.preset); edited.prompts[0].content = 'new body';
  await saveEditedPreset(original.id, original.title, edited, original.preset);
  await savePresetDetails(original, { ...original.catalog, version: 'v2' }, original.packageFiles);
  expect((await getPreset(original.id))?.preset.prompts[0].content).toBe('new body');
  await expect(savePresetDetails(original, { version: 'stale' }, [])).rejects.toThrow('其他位置');
});

it('copies DIY resources without changing the original or carrying a personal evaluation', async () => {
  const original = item(); await getCurrentRepo<PresetItem>('presets').put(original);
  const copy = await createPresetDiy(original.id);
  expect(copy.id).not.toBe(original.id);
  expect(copy.catalog).toMatchObject({ author: '作者 A', version: 'v1', originId: original.id, favorite: false, notes: '', status: 'testing' });
  expect(copy.packageFiles).toEqual(original.packageFiles);
  expect(await getPreset(original.id)).toEqual(original);
});

it('preserves the inferred legacy series when creating a DIY copy without backfilling the original', async () => {
  const original = item(); original.title = '【小猫之神】3.10'; delete original.catalog;
  await getCurrentRepo<PresetItem>('presets').put(original);
  const copy = await createPresetDiy(original.id);
  expect(copy.catalog).toMatchObject({ series: '小猫之神', originId: original.id, variant: 'DIY' });
  const summary = await listAssetIndex('presets');
  for (const id of [original.id, copy.id]) {
    expect(getPresetPresentation(summary.find(entry => entry.id === id)!)).toMatchObject({ series: '小猫之神', version: '3.10' });
  }
  expect(copy.preset).toEqual(original.preset);
  expect(copy.packageFiles).toEqual(original.packageFiles);
  expect(await getPreset(original.id)).toEqual(original);
  for (const variant of ['DIY', '轻量 · DIY']) {
    await updatePresetCatalog(copy.id, { variant });
    const parentCopy = (await getPreset(copy.id))!;
    const secondCopy = await createPresetDiy(copy.id);
    expect(secondCopy.id).not.toBe(copy.id);
    expect(secondCopy.title).toBe('【小猫之神】3.10 · DIY');
    expect(secondCopy.catalog).toMatchObject({ series: '小猫之神', originId: copy.id, variant });
    expect(secondCopy.preset).toEqual(parentCopy.preset);
    expect(secondCopy.packageFiles).toEqual(parentCopy.packageFiles);
    expect(await getPreset(copy.id)).toEqual(parentCopy);
    expect(await getPreset(original.id)).toEqual(original);
  }
});

it('preserves author resources on a character COW copy while leaving the shared record intact', async () => {
  const original = item(), repo = getCurrentRepo<PresetItem>('presets'); await repo.put(original);
  await getCurrentRepo<ArchiveCharacter>('characters').put({ id: 'c', name: '角色', createdAt: 1, updatedAt: 1, assets: [{ kind: 'preset', assetId: original.id }] } as ArchiveCharacter);
  const result = await saveAssetWithCow<PresetItem>({ kind: 'preset', baseId: original.id, characterId: 'c', characterName: '角色',
    title: original.title, content: { preset: original.preset, autoSaved: false }, reload: () => repo.list(), newId: () => 'copy-c', save: value => repo.put(value) });
  const copy = await repo.get(result.targetId);
  expect(copy).toMatchObject({ catalog: { author: '作者 A', notes: '', favorite: false }, packageFiles: original.packageFiles });
  expect(await repo.get(original.id)).toEqual(original);
});

it('classifies companion files without executing code and warns about duplicate content', async () => {
  const original = item(); await getCurrentRepo<PresetItem>('presets').put(original);
  const preview = await readPresetPackage([upload('new.json', JSON.stringify(raw)), upload('readme.md', '安装说明'), upload('helper.json', JSON.stringify(raw.extensions.tavern_helper))]);
  expect(preview.presets[0].duplicateTitles).toContain(original.title);
  expect(preview.files.map(file => file.kind)).toEqual(['notes', 'script']);
  expect(classifyPresetAttachment('regex.json', JSON.stringify(raw.extensions.regex_scripts))).toBe('regex');
  expect(inspectPresetScripts(raw)).toMatchObject([{ name: 'helper', content: 'throw new Error("must never execute")' }]);
  const imported = buildImportedPreset(preview.presets[0], { author: '作者 A', version: 'v2' }, preview.files);
  expect(imported.catalog?.releaseNotes).toContain('安装说明');
  expect(imported.autoSaved).toBe(false);
  expect(buildImportedPreset(preview.presets[0], {}, []).id).toBe(imported.id); // Failed-save retry uses the same identity.
});

it('generates safe ST exports, reuses intact folders, and preserves user-edited export copies', async () => {
  const disk = createMemFs(), opened: string[] = [];
  setActiveVault(createVault({ ...disk, openPath: async path => { opened.push(path); } }));
  const original = item();
  original.packageFiles!.push({ id: 'unsafe-name', name: '../CON.json', kind: 'other', text: '{"keep":true}' });
  await getCurrentRepo<PresetItem>('presets').put(original);
  const exported = buildPresetExportFiles(original);
  expect(Object.keys(exported).some(path => path.split('/').includes('..'))).toBe(false);
  const preset = JSON.parse(exported['作者预设.json']);
  expect(preset).not.toHaveProperty('__ste'); expect(preset).not.toHaveProperty('catalog');
  expect(preset.extensions.tavern_helper).toEqual(raw.extensions.tavern_helper);
  const path = await exportPresetPackage(original.id, 'folder');
  expect(path).toContain('导出/预设/作者 A/系列 A/v1');
  expect(await exportPresetPackage(original.id, 'folder')).toBe(path);
  await disk.writeText(`${path}/作者预设.json`, 'user edited this copy');
  expect(await exportPresetPackage(original.id, 'folder')).not.toBe(path);
  expect(await disk.readText(`${path}/作者预设.json`)).toBe('user edited this copy');
  expect(opened).toHaveLength(3);
  expect(await getPreset(original.id)).toEqual(original);
});
