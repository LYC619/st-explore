import { readPresetTagPreferences, writePresetTagPreferences } from './archive-db';
import { getVaultEpoch } from './vault/active';
import { listAssetIndex } from './asset-index';
import { updatePreset } from './preset-db';
import { KeyedSerialQueue } from './keyed-serial-queue';

export interface PresetTagPreferences {
  id: string; updatedAt: number; categories: string[]; tags: string[]; hidden: string[];
}
const ID = 'preset-tags';
const queue = new KeyedSerialQueue();
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];
export function defaultPresetTags(): PresetTagPreferences {
  return { id: ID, updatedAt: 0, categories: ['类型', '风格'], tags: ['类型/通用', '类型/角色', '类型/写作', '类型/越狱', '风格/轻量', '风格/长篇', '风格/沉浸'], hidden: [] };
}
export async function loadPresetTags(): Promise<PresetTagPreferences> {
  return (await readPresetTagPreferences()) ?? defaultPresetTags();
}
export function presetTagParts(tag: string) {
  const index = tag.indexOf('/');
  return index > 0 ? { category: tag.slice(0, index), label: tag.slice(index + 1) } : { category: '未分类', label: tag };
}
/** Capture the vault before enqueueing; renames affect preset tags, never character tags. */
export async function savePresetTags(next: PresetTagPreferences, expected: PresetTagPreferences, rename?: { from: string; to?: string }): Promise<void> {
  const epoch = getVaultEpoch();
  return queue.enqueue(`${epoch}:${ID}`, async () => {
    const check = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，请重新打开标签管理'); };
    check();
    const current = await loadPresetTags();
    if (current.updatedAt !== expected.updatedAt) throw new Error('标签已在其他位置修改，请关闭后重新打开');
    if (rename) {
      const items = await listAssetIndex('presets');
      for (const item of items) {
        check();
        if (!item.catalog?.tags?.includes(rename.from)) continue;
        // Read and mutate the latest record inside the normal preset write queue.
        await updatePreset(item.id, latest => ({ ...latest, autoSaved: false, catalog: {
          ...latest.catalog, updatedAt: Date.now(), tags: unique((latest.catalog?.tags ?? []).flatMap(tag => tag === rename.from ? rename.to ? [rename.to] : [] : [tag])),
        } }));
      }
    }
    check();
    await writePresetTagPreferences({ ...next, id: ID, updatedAt: Math.max(Date.now(), current.updatedAt + 1), categories: unique(next.categories), tags: unique(next.tags), hidden: unique(next.hidden) }, current.updatedAt);
  });
}
