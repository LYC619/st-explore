import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { getVaultEpoch, setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { listAssetIndex } from '@/lib/asset-index';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
import { createPresetDiy, getPreset, saveEditedPreset, saveImportedPreset, savePresetDetails, updatePresetCatalog } from '@/lib/preset-db';
import { buildImportedPreset, buildPresetExportFiles, classifyPresetAttachment, exportPresetPackage, openPresetLocation, readPresetPackage } from '@/lib/preset-package';
import { inspectPresetScripts } from '@/lib/preset-catalog';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { saveAssetWithCow } from '@/lib/asset-cow-save';
import type { PresetItem } from '@/types/preset';
import type { ArchiveCharacter } from '@/types/archive';
import { saveTextFile } from '@/lib/roleplay/export-package-file';

vi.mock('@/lib/roleplay/export-package-file', () => ({ saveTextFile: vi.fn(async () => 'saved') }));

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
  it('inherits shared series tags during import while keeping per-version status independent', async () => {
    if (backend === 'idb') setActiveVault(null);
    const repo = getCurrentRepo<PresetItem>('presets'), original = item(); await repo.put(original);
    const added = { ...item(), id: 'imported-v2', catalog: { ...item().catalog, version: 'v2', tags: ['状态/在用'] } };
    await Promise.all([updatePresetCatalog(original.id, { tags: ['状态/过期', '评价/良好', '剧情向'] }), saveImportedPreset(added)]);
    // Shared series tag ('剧情向') syncs to imported-v2, while original's retired status does NOT clobber imported-v2's active status!
    expect((await repo.get(added.id))?.catalog).toMatchObject({ tags: ['状态/在用', '剧情向'], status: 'active', version: 'v2' });
    expect((await repo.get(original.id))?.catalog).toMatchObject({ tags: ['状态/过期', '评价/良好', '剧情向'], status: 'retired' });
    await updatePresetCatalog(added.id, { notes: 'edited after import' });
    expect((await saveImportedPreset(added)).catalog?.notes).toBe('edited after import');
    expect((await repo.list()).filter(entry => entry.id === added.id)).toHaveLength(1);
    const outsider = { ...item(), id: 'different-author', catalog: { ...item().catalog, author: 'another author', tags: ['状态/在用'] } };
    expect((await saveImportedPreset(outsider)).catalog?.tags).toEqual(['状态/在用']);
  });
  it('shares ordinary tags across the same series while keeping status and rating strictly per-version', async () => {
    if (backend === 'idb') setActiveVault(null);
    const repo = getCurrentRepo<PresetItem>('presets');
    const a = item(), b = { ...item(), id: 'preset-b', title: 'second', catalog: { ...item().catalog, version: 'v2', notes: 'second note', tags: ['状态/在用'] } },
      outsider = { ...item(), id: 'outsider', catalog: { ...item().catalog, author: 'other author' } };
    await repo.put(a); await repo.put(b); await repo.put(outsider);
    await updatePresetCatalog(a.id, { tags: ['状态/备用', '评价/优秀', '文风细腻'] });
    expect((await repo.get(a.id))?.catalog).toMatchObject({ tags: ['状态/备用', '评价/优秀', '文风细腻'], status: 'reserve' });
    expect((await repo.get(b.id))?.catalog).toMatchObject({ tags: ['状态/在用', '文风细腻'], version: 'v2', notes: 'second note', status: 'active' });
    expect(await repo.get(outsider.id)).toEqual(outsider);
    await updatePresetCatalog(a.id, { status: 'retired' });
    expect((await repo.get(a.id))?.catalog).toMatchObject({ status: 'retired' });
    expect((await repo.get(b.id))?.catalog).toMatchObject({ tags: ['状态/在用', '文风细腻'], status: 'active' });
    expect((await repo.get(b.id))?.preset).toEqual(b.preset);
  });
  it('saves an explicit editor name into catalog metadata and subsequent exports while keeping metadata-only edits off disk title', async () => {
    if (backend === 'idb') setActiveVault(null);
    const repo = getCurrentRepo<PresetItem>('presets'), original = item();
    original.catalog!.name = 'old configured name'; await repo.put(original);
    await updatePresetCatalog(original.id, { name: 'metadata display alias' });
    expect((await repo.get(original.id))?.title).toBe('作者预设');
    const saved = await saveEditedPreset(original.id, 'new configured name', original.preset, original.preset, 'metadata display alias');
    expect(saved).toMatchObject({ title: 'new configured name', catalog: { name: 'new configured name' } });
    expect(getPresetPresentation(saved).displayName).toBe('new configured name');
    expect(buildPresetExportFiles(saved)).toHaveProperty('new configured name.json');
    await expect(saveEditedPreset(original.id, 'stale editor name', original.preset, original.preset, 'old configured name')).rejects.toThrow('名称已在其他位置修改');
    expect((await repo.get(original.id))?.catalog?.name).toBe('new configured name');
  });
  it('inherits destination-series ordinary tags when regrouping a version without overwriting its own status', async () => {
    if (backend === 'idb') setActiveVault(null);
    const repo = getCurrentRepo<PresetItem>('presets'), original = item();
    original.catalog = { ...original.catalog, status: 'active' };
    const destination = { ...item(), id: 'destination', catalog: { ...item().catalog, series: 'destination', tags: ['状态/过期', '评价/良好', '长文向'], status: 'retired' as const } };
    await repo.put(original); await repo.put(destination);
    await updatePresetCatalog(original.id, { series: 'destination' });
    expect((await repo.get(original.id))?.catalog).toMatchObject({ tags: ['状态/在用', '长文向'], status: 'active' });
    expect((await repo.get(destination.id))?.catalog).toMatchObject({ tags: ['状态/过期', '评价/良好', '长文向'], status: 'retired' });
  });
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

it('round-trips package and catalog through native serialization without 2x normalized bloat', async () => {
  const disk = createMemFs();
  const vault = createVault(disk);
  setActiveVault(vault);
  const original = item(); original.catalog!.notes = 'personal note '.repeat(20000);
  await getCurrentRepo<PresetItem>('presets').put(original);
  const savedPath = (await vault.pathOf('presets', original.id))!;
  const rawDiskJson = JSON.parse(await disk.readText(savedPath));
  expect(rawDiskJson.__ste).not.toHaveProperty('__ste_normalized_v1');
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

it('copies DIY resources without changing the original or carrying retired/rating tags', async () => {
  const original = item();
  original.catalog = { ...original.catalog, tags: ['状态/过期', '评价/优秀', '剧情向'], status: 'retired' };
  await getCurrentRepo<PresetItem>('presets').put(original);
  const copy = await createPresetDiy(original.id);
  expect(copy.id).not.toBe(original.id);
  expect(copy.catalog).toMatchObject({ author: '作者 A', version: 'v1', originId: original.id, favorite: false, notes: '', status: 'testing', tags: ['剧情向'] });
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
  expect(buildImportedPreset(preview.presets[0], {}, []).id).toBe(imported.id);
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

it('reveals the managed preset file without creating an export copy or opening the external source', async () => {
  const fs = createMemFs(), opened = vi.fn(async () => {}), vault = createVault({ ...fs, openPath: opened });
  setActiveVault(vault);
  const original = { ...item(), sourcePath: 'Z:/external-ST/OpenAI Settings/author.json' };
  await getCurrentRepo<PresetItem>('presets').put(original);
  const managedPath = await vault.pathOf('presets', original.id), before = await fs.list('');
  await openPresetLocation(original.id);
  expect(opened).toHaveBeenCalledWith(managedPath, true);
  expect(await fs.list('')).toEqual(before);
  expect(await getPreset(original.id)).toEqual(original);
});

it('saves a single configured-name JSON with embedded resources, no STE metadata and truthful cancellation', async () => {
  const original = item(); original.catalog!.name = 'Configured name';
  await getCurrentRepo<PresetItem>('presets').put(original);
  expect(await exportPresetPackage(original.id, 'json')).toBe('预设 JSON 已导出');
  const saved = vi.mocked(saveTextFile).mock.calls.at(-1)![0];
  expect(saved).toMatchObject({ fileName: 'Configured name.json', extension: 'json' });
  const exported = JSON.parse(saved.text);
  expect(exported).toMatchObject({ futureField: raw.futureField, extensions: { tavern_helper: raw.extensions.tavern_helper, regex_scripts: [expect.objectContaining(raw.extensions.regex_scripts[0])] } });
  expect(exported).not.toHaveProperty('__ste'); expect(exported).not.toHaveProperty('catalog'); expect(exported).not.toHaveProperty('packageFiles');
  vi.mocked(saveTextFile).mockResolvedValueOnce('cancelled');
  expect(await exportPresetPackage(original.id, 'json')).toBeNull();
  expect(await getPreset(original.id)).toEqual(original);
});

it('serializes import against a concurrent series change rather than leaving the new version behind', async () => {
  const repo = getCurrentRepo<PresetItem>('presets'), original = item(); await repo.put(original);
  let entered!: () => void, resume!: () => void;
  const listed = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  const list = repo.listLight.bind(repo);
  vi.spyOn(repo, 'listLight').mockImplementationOnce(async () => { const items = await list(); entered(); await gate; return items; });
  const added = { ...item(), id: 'concurrent-import' }, importing = saveImportedPreset(added);
  await listed;
  const editing = updatePresetCatalog(original.id, { tags: ['剧情向'] });
  resume(); await Promise.all([importing, editing]);
  expect((await repo.get(added.id))?.catalog).toMatchObject({ tags: ['剧情向'] });
  expect((await repo.get(original.id))?.catalog).toMatchObject({ tags: ['剧情向'] });
});

it('stops an import after the vault changes while reading peers, without writing either vault', async () => {
  const repo = getCurrentRepo<PresetItem>('presets'), original = item(); await repo.put(original);
  let entered!: () => void, resume!: () => void;
  const listed = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
  const list = repo.listLight.bind(repo);
  vi.spyOn(repo, 'listLight').mockImplementationOnce(async () => { const items = await list(); entered(); await gate; return items; });
  const epoch = getVaultEpoch(), added = { ...item(), id: 'stale-import' }, importing = saveImportedPreset(added, { epoch, tagsExplicit: true });
  const rejected = expect(importing).rejects.toThrow('资料库已切换');
  await listed; setActiveVault(createVault(createMemFs())); resume(); await rejected;
  expect(await repo.get(added.id)).toBeUndefined(); expect(await repo.get(original.id)).toEqual(original);
  expect(await getCurrentRepo<PresetItem>('presets').list()).toEqual([]);
});
