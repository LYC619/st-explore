import { readPresetTagPreferences, writePresetTagPreferences } from './archive-db';
import { getVaultEpoch } from './vault/active';
import { listAssetIndex } from './asset-index';
import { updatePreset } from './preset-db';
import { KeyedSerialQueue } from './keyed-serial-queue';
import { catalogWithTags, cleanPresetTags, getPresetTags, PRESET_RATING_TAGS, PRESET_STATUS_TAGS } from './preset-tag-values';

export interface PresetTagPreferences {
  id: string;
  updatedAt: number;
  categories: string[];
  tags: string[];
  hidden: string[];
  schemaVersion?: number;
  deleted?: string[];
  deletedCategories?: string[];
}
const ID = 'preset-tags';
const queue = new KeyedSerialQueue();
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
// Definitions contain every status/rating option; normalize each separately so
// the per-preset single-choice rule does not discard the other definitions.
const cleanDefinitions = (values: string[]) => unique(values.flatMap(value => cleanPresetTags([value])));
export function defaultPresetTags(): PresetTagPreferences {
  return { id: ID, updatedAt: 0, schemaVersion: 2, categories: ['状态', '评价'], tags: [...PRESET_STATUS_TAGS, ...PRESET_RATING_TAGS], hidden: [] };
}
export async function loadPresetTags(): Promise<PresetTagPreferences> {
  const saved = await readPresetTagPreferences();
  if (!saved) return defaultPresetTags();
  const current = saved.schemaVersion === 2;
  return {
    ...saved,
    schemaVersion: 2,
    categories: unique([...saved.categories.filter(c => !['类型', '风格'].includes(c)), ...(current ? [] : ['状态', '评价'])]),
    tags: unique([...cleanDefinitions(saved.tags), ...(current ? [] : [...PRESET_STATUS_TAGS, ...PRESET_RATING_TAGS])]),
    hidden: cleanDefinitions(saved.hidden),
    ...(saved.deleted ? { deleted: cleanDefinitions(saved.deleted) } : {}),
  };
}
export function presetTagParts(tag: string) {
  const index = tag.indexOf('/');
  return index > 0 ? { category: tag.slice(0, index), label: tag.slice(index + 1) } : { category: '未分类', label: tag };
}
export function getPresetTagOptions(preferences: PresetTagPreferences, assignedTags: string[]): string[] {
  const deleted = new Set(cleanDefinitions(preferences.deleted ?? []));
  return cleanDefinitions([...preferences.tags, ...assignedTags]).filter(tag => !deleted.has(tag)
    && !preferences.deletedCategories?.includes(presetTagParts(tag).category));
}
/** Capture the vault before enqueueing; renames affect preset tags, never character tags. */
export async function savePresetTags(next: PresetTagPreferences, expected: PresetTagPreferences, rename?: { from: string; to?: string; category?: boolean }): Promise<void> {
  const epoch = getVaultEpoch();
  return queue.enqueue(`${epoch}:${ID}`, async () => {
    const check = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开标签管理'); };
    check();
    const current = await loadPresetTags();
    if (current.updatedAt !== expected.updatedAt) throw new Error('标签已在其他位置修改，请关闭后重新打开');
    const matches = (tag: string) => !!rename && (rename.category ? presetTagParts(tag).category === rename.from : tag === rename.from);
    if (rename) {
      const items = await listAssetIndex('presets');
      for (const item of items) {
        check();
        if (!getPresetTags(item.catalog).some(matches)) continue;
        // Read and mutate the latest record inside the normal preset write queue.
        await updatePreset(item.id, latest => {
          check();
          return { ...latest, autoSaved: false, catalog: catalogWithTags({ ...latest.catalog, updatedAt: Date.now() },
            getPresetTags(latest.catalog).flatMap(tag => matches(tag) ? rename.to ? [rename.to] : [] : [tag])) };
        });
      }
    }
    check();
    const deleted = cleanDefinitions([...(next.deleted ?? []), ...(rename && !rename.category && rename.to !== rename.from ? [rename.from] : [])]);
    const deletedCategories = unique([...(next.deletedCategories ?? []), ...(rename?.category ? [rename.from] : [])]);
    await writePresetTagPreferences({ ...next, id: ID, schemaVersion: 2,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1), categories: unique(next.categories),
      tags: cleanDefinitions(next.tags), hidden: cleanDefinitions(next.hidden), deleted, deletedCategories }, current.updatedAt);
  });
}
