import type { RemoveOptions } from '@/lib/repo';
import { generatePresetId, type PresetCatalog, type PresetItem } from '@/types/preset';
import { createRepo, getCurrentRepo } from '@/lib/repo';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { getVaultEpoch } from './vault/active';
import { normalizePresetCatalog, presetContentFingerprint } from './preset-catalog';
import { stableJson } from './roleplay/fingerprint';
import { getPresetPresentation } from './preset-presentation';

const repo = createRepo<PresetItem>('presets');
const queue = new KeyedSerialQueue();

export async function updatePreset(id: string, change: (latest: PresetItem) => PresetItem): Promise<PresetItem> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return queue.enqueue(`${epoch}:${id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    const latest = await target.get(id);
    if (!latest) throw new Error('预设已不存在，请刷新列表');
    const next = change(latest);
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put(next);
    return next;
  });
}

export function updatePresetCatalog(id: string, patch: Partial<PresetCatalog>, expected?: PresetCatalog): Promise<PresetItem> {
  return updatePreset(id, latest => {
    if (expected && stableJson(latest.catalog ?? {}) !== stableJson(expected)) throw new Error('管理资料已在其他位置修改，请重新打开后再保存');
    return { ...latest, autoSaved: false, catalog: normalizePresetCatalog({ ...latest.catalog, ...patch, updatedAt: Date.now() }) };
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

export function saveEditedPreset(id: string, title: string, preset: PresetItem['preset'], expected?: PresetItem['preset']): Promise<PresetItem> {
  return updatePreset(id, latest => {
    if (expected && presetContentFingerprint(latest.preset) !== presetContentFingerprint(expected)) throw new Error('预设内容已在其他位置修改，请先导出草稿，再重新打开');
    return { ...latest, title, preset, autoSaved: false, updatedAt: Date.now() };
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
