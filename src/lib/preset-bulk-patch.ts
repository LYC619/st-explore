import type { PresetCatalog } from '@/types/preset';
import { cleanPresetTags, catalogWithTags } from './preset-tag-values';

export interface PresetBulkPatch {
  author?: string;
  series?: string;
  items?: Record<string, { name: string; version: string }>;
  models: Record<string, boolean>;
  tags: Record<string, boolean>;
}

export function applyPresetBulkPatch(catalog: PresetCatalog = {}, patch: PresetBulkPatch): PresetCatalog {
  const next = { ...catalog };
  if (patch.author !== undefined) {
    next.author = patch.author.trim();
  }
  if (patch.series !== undefined) {
    next.series = patch.series.trim();
    next.seriesConfirmed = true;
  }
  for (const key of ['models', 'tags'] as const) {
    if (!Object.keys(patch[key]).length) continue;
    const values = new Set(next[key] ?? []);
    for (const [value, included] of Object.entries(patch[key])) {
      if (included) values.add(value);
      else values.delete(value);
    }
    next[key] = key === 'tags' ? cleanPresetTags([...values]) : [...values];
    if (key === 'models') next.modelsConfirmed = true;
  }
  return Object.keys(patch.tags).length ? catalogWithTags(next, next.tags ?? []) : next;
}
