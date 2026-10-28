import type { RemoveOptions } from '@/lib/repo';
import { generatePresetId, type PresetCatalog, type PresetItem } from '@/types/preset';
import { createRepo, getCurrentRepo } from '@/lib/repo';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { getVaultEpoch } from './vault/active';
import { normalizePresetCatalog, presetContentFingerprint } from './preset-catalog';
import { stableJson } from './roleplay/fingerprint';
import { getPresetPresentation, presetName, presetSeriesKey } from './preset-presentation';
import { catalogWithTags, getPresetTags } from './preset-tag-values';

const repo = createRepo<PresetItem>('presets');
const queue = new KeyedSerialQueue();
const seriesQueue = new KeyedSerialQueue();

export async function updatePreset(id: string, change: (latest: PresetItem) => PresetItem): Promise<PresetItem> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return seriesQueue.enqueue(`${epoch}:series`, () => queue.enqueue(`${epoch}:${id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    const latest = await target.get(id);
    if (!latest) throw new Error('预设已不存在，请刷新列表');
    const next = change(latest);
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    // Tags are series metadata. Apply to the destination series after a regroup,
    // retaining each version's own content, model, name and notes.
    const tagsChanged = stableJson(next.catalog?.tags ?? getPresetTags(next.catalog)) !== stableJson(latest.catalog?.tags ?? getPresetTags(latest.catalog));
    if (tagsChanged) next.catalog = catalogWithTags(next.catalog ?? {}, next.catalog?.tags ?? []);
    const explicitTags = tagsChanged || next.catalog?.status !== latest.catalog?.status;
    const seriesChanged = presetSeriesKey(next) !== presetSeriesKey(latest);
    const peers = explicitTags || seriesChanged ? (await target.listLight()).filter(item => item.id !== id && presetSeriesKey(item) === presetSeriesKey(next)) : [];
    const tags = explicitTags ? getPresetTags(next.catalog) : seriesChanged && peers.length ? getPresetTags(peers[0].catalog) : getPresetTags(next.catalog);
    if (explicitTags || seriesChanged) next.catalog = catalogWithTags(next.catalog ?? {}, tags);
    if (next.catalog?.name?.trim() && next.catalog.name !== latest.catalog?.name) next.title = next.catalog.name.trim();
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put(next);
    for (const peer of peers) await queue.enqueue(`${epoch}:${peer.id}`, async () => {
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，系列标签同步已停止');
      const current = await target.get(peer.id);
      if (!current || presetSeriesKey(current) !== presetSeriesKey(next)) return;
      await target.put({ ...current, autoSaved: false, catalog: { ...catalogWithTags(current.catalog ?? {}, tags), updatedAt: Date.now() } });
    });
    return next;
  }));
}

/** Import joins the same series metadata queue as edits, so a new version cannot revive a retired series. */
export async function saveImportedPreset(item: PresetItem, options: { tagsExplicit?: boolean; epoch?: number } = {}): Promise<PresetItem> {
  const epoch = options.epoch ?? getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  const assertCurrent = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，本批剩余项目已停止'); };
  return seriesQueue.enqueue(`${epoch}:series`, () => queue.enqueue(`${epoch}:${item.id}`, async () => {
    assertCurrent();
    const existing = await target.get(item.id);
    assertCurrent();
    // A failed-save retry keeps its candidate ID. Recover a completed write without overwriting later edits.
    if (existing) {
      if (presetContentFingerprint(existing.preset) !== presetContentFingerprint(item.preset)) throw new Error('预设已在其他位置修改，请重新选择文件');
      return existing;
    }
    const series = presetSeriesKey(item);
    const peers = (await target.listLight()).filter(peer => peer.id !== item.id && presetSeriesKey(peer) === series);
    assertCurrent();
    const tags = !options.tagsExplicit && peers.length ? getPresetTags(peers[0].catalog) : getPresetTags(item.catalog);
    const next = { ...item, catalog: normalizePresetCatalog(catalogWithTags(item.catalog ?? {}, tags)) };
    if (options.tagsExplicit) for (const peer of peers) await queue.enqueue(`${epoch}:${peer.id}`, async () => {
      assertCurrent();
      const current = await target.get(peer.id);
      assertCurrent();
      if (!current || presetSeriesKey(current) !== series || stableJson(getPresetTags(current.catalog)) === stableJson(tags)) return;
      await target.put({ ...current, autoSaved: false, catalog: { ...catalogWithTags(current.catalog ?? {}, tags), updatedAt: Date.now() } });
    });
    assertCurrent();
    await target.put(next);
    assertCurrent();
    return next;
  }));
}

export function updatePresetCatalog(id: string, patch: Partial<PresetCatalog>, expected?: PresetCatalog): Promise<PresetItem> {
  return updatePreset(id, latest => {
    if (expected && stableJson(latest.catalog ?? {}) !== stableJson(expected)) throw new Error('管理资料已在其他位置修改，请重新打开后再保存');
    let catalog: PresetCatalog = { ...latest.catalog, ...patch, updatedAt: Date.now() };
    if (Object.hasOwn(patch, 'tags')) catalog = catalogWithTags(catalog, patch.tags ?? []);
    else if (Object.hasOwn(patch, 'status')) {
      catalog = catalogWithTags(catalog, [...getPresetTags(latest.catalog).filter(tag => !tag.startsWith('状态/')), ...getPresetTags({ status: patch.status })]);
    }
    return { ...latest, autoSaved: false, catalog: normalizePresetCatalog(catalog) };
  });
}

export function savePresetDetails(base: PresetItem, catalog: PresetCatalog, files: PresetItem['packageFiles']): Promise<PresetItem> {
  return updatePreset(base.id, latest => {
    if (stableJson(latest.catalog ?? {}) !== stableJson(base.catalog ?? {}) || stableJson(latest.packageFiles ?? []) !== stableJson(base.packageFiles ?? [])) {
      throw new Error('管理资料或附件已在其他位置修改。当前输入已保留，请复制需要的内容后重新载入');
    }
    return { ...latest, autoSaved: false, catalog: normalizePresetCatalog({ ...catalog, updatedAt: Date.now() }), packageFiles: files };
  });
}

export function saveEditedPreset(id: string, title: string, preset: PresetItem['preset'], expected?: PresetItem['preset'], expectedName?: string): Promise<PresetItem> {
  return updatePreset(id, latest => {
    if (expected && presetContentFingerprint(latest.preset) !== presetContentFingerprint(expected)) throw new Error('预设内容已在其他位置修改，请先导出草稿，再重新打开');
    if (expectedName !== undefined && presetName(latest) !== expectedName.trim()) throw new Error('预设名称已在其他位置修改，请重新打开后再保存');
    const renamed = title.trim() !== (latest.catalog?.name?.trim() || latest.title.trim());
    return { ...latest, title, preset, catalog: renamed ? { ...latest.catalog, name: title.trim() || undefined } : latest.catalog, autoSaved: false, updatedAt: Date.now() };
  });
}

export async function createPresetDiy(id: string, draft?: { title: string; preset: PresetItem['preset'] }): Promise<PresetItem> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  const base = await target.get(id);
  if (!base) throw new Error('来源预设不存在');
  const now = Date.now();
  const identity = getPresetPresentation(base);
  const item: PresetItem = {
    id: generatePresetId(), title: `${(draft?.title ?? base.title).replace(/(?:\s*·\s*DIY)+\s*$/i, '')} · DIY`, preset: structuredClone(draft?.preset ?? base.preset),
    createdAt: now, updatedAt: now, autoSaved: false, packageFiles: structuredClone(base.packageFiles),
    catalog: { ...base.catalog, name: identity.displayName, series: identity.series || identity.displayName, originId: base.id, variant: [...(base.catalog?.variant?.split('·').map(value => value.trim()).filter(value => value && value.toUpperCase() !== 'DIY') ?? []), 'DIY'].join(' · '), favorite: false, status: 'testing', notes: '', updatedAt: now },
  };
  if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
  await target.put(item);
  return item;
}

export async function getAllPresets(): Promise<PresetItem[]> {
  return repo.list();
}

export async function getPreset(id: string): Promise<PresetItem | undefined> {
  return repo.get(id);
}

export async function savePreset(item: PresetItem): Promise<void> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return queue.enqueue(`${epoch}:${item.id}`, async () => {
    const latest = await target.get(item.id);
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put({ ...item, autoSaved: latest?.autoSaved === false ? false : item.autoSaved,
      catalog: latest?.catalog ?? item.catalog, packageFiles: latest?.packageFiles ?? item.packageFiles });
  });
}

export async function deletePreset(id: string, options?: RemoveOptions): Promise<void> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return queue.enqueue(`${epoch}:${id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.remove(id, options);
  });
}

/**
 * 只保留最近 `keep` 份「自动保留」(autoSaved) 的预设，超出的按 updatedAt 由旧到新删除。
 * 用户手动保存(autoSaved 非 true)的不受影响。返回被删除的 id 数组。
 */
export async function pruneAutoSavedPresets(keep = 5): Promise<string[]> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  const candidates = (await target.list()).filter(item => item.autoSaved).slice(keep);
  const removed: string[] = [];
  for (const item of candidates) await queue.enqueue(`${epoch}:${item.id}`, async () => {
    if (epoch !== getVaultEpoch()) return;
    const latest = await target.get(item.id);
    // Marking an old import must protect it even if pruning read its old flag first.
    if (!latest?.autoSaved || epoch !== getVaultEpoch()) return;
    await target.remove(item.id);
    removed.push(item.id);
  });
  return removed;
}
