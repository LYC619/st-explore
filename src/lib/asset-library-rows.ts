import type { RegexCollectionItem } from '@/types/regex';
import type { PresetItem } from '@/types/preset';
import type { WorldBookItem } from '@/types/worldbook';
import type { AssetIndexEntry } from './asset-index-entry';

export interface AssetLibraryRow {
  id: string;
  title: string;
  itemCount: number;
  derived?: boolean;
  autoSaved?: boolean;
  fromST?: boolean;
  stGlobal?: boolean;
  sourceModifiedAt?: number;
  /** STE 中最后一次内容修改，负责卡片展示与排序。 */
  updatedAt: number;
}

interface AssetLibrarySources {
  worldbooks: WorldBookItem[];
  presets: (PresetItem | AssetIndexEntry)[];
  regexes: RegexCollectionItem[];
}

const newestFirst = (a: AssetLibraryRow, b: AssetLibraryRow) => b.updatedAt - a.updatedAt;

export function buildAssetLibraryRows(sources: AssetLibrarySources): {
  worldbook: AssetLibraryRow[];
  preset: AssetLibraryRow[];
  regex: AssetLibraryRow[];
} {
  return {
    worldbook: sources.worldbooks.map((item) => ({
      id: item.id,
      title: item.title,
      itemCount: Object.keys(item.worldbook.entries).length,
      derived: !!item.derived,
      autoSaved: item.autoSaved,
      fromST: !!item.sourcePath,
      stGlobal: item.stGlobal,
      sourceModifiedAt: item.sourceModifiedAt,
      updatedAt: item.updatedAt,
    })).sort(newestFirst),
    preset: sources.presets.map((item) => ({
      id: item.id,
      title: item.title,
      itemCount: 'preset' in item ? item.preset.prompts.length : item.entryCount,
      derived: 'preset' in item ? !!item.derived : item.source === 'derived',
      autoSaved: item.autoSaved,
      fromST: 'preset' in item ? !!item.sourcePath : item.source === 'fromST',
      sourceModifiedAt: item.sourceModifiedAt,
      updatedAt: item.updatedAt,
    })).sort(newestFirst),
    regex: sources.regexes.map((item) => ({
      id: item.id,
      title: item.title,
      itemCount: item.rules.length,
      derived: !!item.derived,
      fromST: !!item.sourcePath,
      updatedAt: item.updatedAt,
    })).sort(newestFirst),
  };
}
