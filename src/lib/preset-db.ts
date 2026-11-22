import type { RemoveOptions } from '@/lib/repo';
import { generatePresetId, type PresetCatalog, type PresetItem } from '@/types/preset';
import { createRepo, getCurrentRepo } from '@/lib/repo';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { getActiveVault, getVaultEpoch } from './vault/active';
import { normalizePresetCatalog, presetContentFingerprint } from './preset-catalog';
import { stableJson } from './roleplay/fingerprint';
import { getPresetPresentation, presetName, presetSeriesKey } from './preset-presentation';
import { catalogWithTags, getPresetTags, isVersionScopedPresetTag } from './preset-tag-values';

const repo = createRepo<PresetItem>('presets');
export const presetWriteQueue = new KeyedSerialQueue();
const seriesQueue = new KeyedSerialQueue();

function splitPresetTags(tags: string[]): { versionTags: string[]; seriesTags: string[] } {
  const versionTags: string[] = [];
  const seriesTags: string[] = [];
  for (const tag of tags) {
    if (isVersionScopedPresetTag(tag)) versionTags.push(tag);
    else seriesTags.push(tag);
  }
  return { versionTags, seriesTags };
}

export async function updatePreset(id: string, change: (latest: PresetItem) => PresetItem): Promise<PresetItem> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return seriesQueue.enqueue(`${epoch}:series`, () => presetWriteQueue.enqueue(`${epoch}:${id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    const latest = await target.get(id);
    if (!latest) throw new Error('预设已不存在，请刷新列表');
    const next = change(latest);
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');

    // Ordinary tags belong to the series; status (状态/*) and rating (评价/*) belong strictly to each version.
    const latestTags = getPresetTags(latest.catalog);
    const rawNextTags = next.catalog?.tags !== undefined && next.catalog.tags !== latest.catalog?.tags
      ? next.catalog.tags
      : getPresetTags(next.catalog);
    const tagsChanged = stableJson(rawNextTags) !== stableJson(latestTags) || next.catalog?.status !== latest.catalog?.status;
    if (tagsChanged) {
      next.catalog = catalogWithTags(next.catalog ?? {}, rawNextTags);
    }

    const latestSplit = splitPresetTags(latestTags);
    const nextSplit = splitPresetTags(getPresetTags(next.catalog));
    const explicitSeriesTags = stableJson(nextSplit.seriesTags) !== stableJson(latestSplit.seriesTags);
    const seriesChanged = presetSeriesKey(next) !== presetSeriesKey(latest);
    const peers = explicitSeriesTags || seriesChanged
      ? (await target.listLight()).filter(item => item.id !== id && presetSeriesKey(item) === presetSeriesKey(next))
      : [];

    const targetSeriesTags = explicitSeriesTags
      ? nextSplit.seriesTags
      : seriesChanged && peers.length
        ? splitPresetTags(getPresetTags(peers[0].catalog)).seriesTags
        : nextSplit.seriesTags;

    if (explicitSeriesTags || seriesChanged) {
      next.catalog = catalogWithTags(next.catalog ?? {}, [...nextSplit.versionTags, ...targetSeriesTags]);
    }

    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put(next);

    if (explicitSeriesTags) {
      for (const peer of peers) await presetWriteQueue.enqueue(`${epoch}:${peer.id}`, async () => {
        if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，系列标签同步已停止');
        const current = await target.get(peer.id);
        if (!current || presetSeriesKey(current) !== presetSeriesKey(next)) return;
        const peerSplit = splitPresetTags(getPresetTags(current.catalog));
        if (stableJson(peerSplit.seriesTags) === stableJson(targetSeriesTags)) return;
        await target.put({
          ...current,
          autoSaved: false,
          catalog: {
            ...catalogWithTags(current.catalog ?? {}, [...peerSplit.versionTags, ...targetSeriesTags]),
            updatedAt: Date.now(),
          },
        });
      });
    }
    return next;
  }));
}

/** Import joins the same series metadata queue as edits, inheriting only shared series tags while keeping each version's own status/rating. */
export async function saveImportedPreset(item: PresetItem, options: { tagsExplicit?: boolean; epoch?: number } = {}): Promise<PresetItem> {
  const epoch = options.epoch ?? getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  const assertCurrent = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，本批剩余项目已停止'); };
  return seriesQueue.enqueue(`${epoch}:series`, () => presetWriteQueue.enqueue(`${epoch}:${item.id}`, async () => {
    assertCurrent();
    const existing = await target.get(item.id);
    assertCurrent();
    if (existing) {
      if (presetContentFingerprint(existing.preset) !== presetContentFingerprint(item.preset)) throw new Error('预设已在其他位置修改，请重新选择文件');
      return existing;
    }
    const series = presetSeriesKey(item);
    const peers = (await target.listLight()).filter(peer => peer.id !== item.id && presetSeriesKey(peer) === series);
    assertCurrent();
    const ownSplit = splitPresetTags(getPresetTags(item.catalog));
    const inheritedSeriesTags = !options.tagsExplicit && peers.length
      ? splitPresetTags(getPresetTags(peers[0].catalog)).seriesTags
      : ownSplit.seriesTags;
    const mergedTags = [...ownSplit.versionTags, ...inheritedSeriesTags];
    const next = { ...item, catalog: normalizePresetCatalog(catalogWithTags(item.catalog ?? {}, mergedTags)) };

    if (options.tagsExplicit && ownSplit.seriesTags.length >= 0) {
      for (const peer of peers) await presetWriteQueue.enqueue(`${epoch}:${peer.id}`, async () => {
        assertCurrent();
        const current = await target.get(peer.id);
        assertCurrent();
        if (!current || presetSeriesKey(current) !== series) return;
        const peerSplit = splitPresetTags(getPresetTags(current.catalog));
        if (stableJson(peerSplit.seriesTags) === stableJson(ownSplit.seriesTags)) return;
        await target.put({
          ...current,
          autoSaved: false,
          catalog: {
            ...catalogWithTags(current.catalog ?? {}, [...peerSplit.versionTags, ...ownSplit.seriesTags]),
            updatedAt: Date.now(),
          },
        });
      });
    }
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
    const trimmed = title.trim();
    const renamed = trimmed !== (latest.catalog?.name?.trim() || latest.title.trim());
    return {
      ...latest,
      title: renamed ? (trimmed || latest.title) : latest.title,
      preset,
      catalog: renamed ? { ...latest.catalog, name: trimmed || undefined } : latest.catalog,
      autoSaved: false,
      updatedAt: Date.now(),
    };
  });
}

export async function createPresetDiy(id: string, draft?: { title: string; preset: PresetItem['preset'] }): Promise<PresetItem> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  const base = await target.get(id);
  if (!base) throw new Error('来源预设不存在');
  const now = Date.now();
  const identity = getPresetPresentation(base);
  const cleanSeriesTags = getPresetTags(base.catalog).filter(tag => !isVersionScopedPresetTag(tag));
  const item: PresetItem = {
    id: generatePresetId(),
    title: `${(draft?.title ?? base.title).replace(/(?:\s*·\s*DIY)+\s*$/i, '')} · DIY`,
    preset: structuredClone(draft?.preset ?? base.preset),
    createdAt: now,
    updatedAt: now,
    autoSaved: false,
    packageFiles: structuredClone(base.packageFiles),
    catalog: normalizePresetCatalog({
      ...base.catalog,
      name: identity.displayName,
      series: identity.series || identity.displayName,
      originId: base.id,
      variant: [...(base.catalog?.variant?.split('·').map(value => value.trim()).filter(value => value && value.toUpperCase() !== 'DIY') ?? []), 'DIY'].join(' · '),
      tags: cleanSeriesTags,
      favorite: false,
      status: 'testing',
      notes: '',
      updatedAt: now,
    }),
  };
  if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
  await presetWriteQueue.enqueue(`${epoch}:${item.id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put(item);
  });
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
  return presetWriteQueue.enqueue(`${epoch}:${item.id}`, async () => {
    const latest = await target.get(item.id);
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.put({
      ...item,
      autoSaved: latest?.autoSaved === false ? false : item.autoSaved,
      catalog: latest?.catalog ?? item.catalog,
      packageFiles: latest?.packageFiles ?? item.packageFiles,
    });
  });
}

export async function deletePreset(id: string, options?: RemoveOptions): Promise<void> {
  const epoch = getVaultEpoch(), target = getCurrentRepo<PresetItem>('presets');
  return presetWriteQueue.enqueue(`${epoch}:${id}`, async () => {
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开');
    await target.remove(id, options);
  });
}

/** 历史兼容存根：已取消按上限静默删除旧预设的行为。 */
export async function pruneAutoSavedPresets(_keep = 5): Promise<string[]> {
  return [];
}

/** Refresh only preset files, including external edits, additions, moves and deletions. */
export async function refreshPresetFiles(options: { migrateLegacy?: boolean } = {}): Promise<void> {
  if (options.migrateLegacy && getActiveVault()) {
    const result = await organizePresetFolders({ legacyOnly: true });
    if (result.failed.length) throw new Error(`旧预设结构更新未完成，原文件已保留；下次进入会重试。\n${result.failed.join('\n')}`);
    return;
  }
  await getActiveVault()?.refreshAssets?.('presets');
}

/** Migrate flat legacy files on catalog entry; explicit callers may organize all versions. */
export async function organizePresetFolders(options: { legacyOnly?: boolean } = {}): Promise<{ moved: number; unchanged: number; failed: string[] }> {
  const epoch = getVaultEpoch(), vault = getActiveVault(), target = getCurrentRepo<PresetItem>('presets');
  if (!vault) throw new Error('系列文件夹整理需要使用文件库');
  const check = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，系列文件夹整理已停止'); };
  return seriesQueue.enqueue(`${epoch}:series`, async () => {
    check();
    await vault.refreshAssets?.('presets');
    check();
    const items = await target.listLight();
    const result = { moved: 0, unchanged: 0, failed: [] as string[] };
    for (const item of items) await presetWriteQueue.enqueue(`${epoch}:${item.id}`, async () => {
      check();
      try {
        const before = await vault.pathOf('presets', item.id);
        check();
        if (options.legacyOnly && (!before || before.replace(/\\/g, '/').split('/').length !== 3)) {
          result.unchanged++; return;
        }
        const current = await target.get(item.id);
        if (!current) { result.unchanged++; return; }
        check();
        await target.put(current);
        check();
        if (before !== await vault.pathOf('presets', item.id)) result.moved++;
        else result.unchanged++;
      } catch (error) {
        check();
        result.failed.push(`${item.title}：${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return result;
  });
}
