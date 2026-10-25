import type { WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';
import type { RegexCollectionItem } from '@/types/regex';
import { inspectPresetScripts, summarizePresetCatalog, type PresetCatalogSummary } from './preset-catalog';
import { classifyAssetSource, type AssetSource } from './asset-source';
import { inferPresetIdentity, type PresetIdentity } from './preset-presentation';

export type IndexedAssetStore = 'worldbooks' | 'presets' | 'regexes';
export type IndexedAsset = WorldBookItem | PresetItem | RegexCollectionItem;

/** Display fields only; editing/exporting must obtain the full asset by ID. */
export interface AssetIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  entryCount: number;
  autoSaved?: boolean;
  sourceModifiedAt?: number;
  catalog?: PresetCatalogSummary;
  packageFileCount?: number;
  regexCount?: number;
  scriptCount?: number;
  presetIdentity?: PresetIdentity;
  source?: AssetSource;
}

export function toAssetIndex(item: IndexedAsset | AssetIndexEntry): AssetIndexEntry {
  const entryCount = 'worldbook' in item ? Object.keys(item.worldbook.entries ?? {}).length
    : 'preset' in item ? item.preset.prompts.length
    : 'rules' in item ? item.rules.length : item.entryCount;
  return {
    id: item.id, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, entryCount,
    autoSaved: 'autoSaved' in item ? item.autoSaved : undefined,
    sourceModifiedAt: 'sourceModifiedAt' in item ? item.sourceModifiedAt : undefined,
    ...('preset' in item ? { source: classifyAssetSource({ derived: !!item.derived, autoSaved: item.autoSaved, fromST: !!item.sourcePath }) }
      : 'source' in item ? { source: item.source } : {}),
    ...('preset' in item ? { catalog: summarizePresetCatalog(item.catalog), packageFileCount: item.packageFiles?.length ?? 0, regexCount: item.preset.regexRules?.length ?? 0, scriptCount: inspectPresetScripts(item.preset.originalData).length }
      : 'catalog' in item ? { catalog: item.catalog, packageFileCount: 'packageFileCount' in item ? item.packageFileCount : undefined } : {}),
    ...(!('preset' in item) && 'regexCount' in item ? { regexCount: item.regexCount, scriptCount: item.scriptCount } : {}),
    ...('preset' in item ? { presetIdentity: inferPresetIdentity(item.title, item.preset.originalData) }
      : 'presetIdentity' in item ? { presetIdentity: item.presetIdentity } : {}),
  };
}
