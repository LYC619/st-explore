import { getCurrentRepo } from '@/lib/repo';
import { toAssetIndex, type AssetIndexEntry, type IndexedAsset, type IndexedAssetStore } from './asset-index-entry';

/** Vault reads cached projections; IDB still reads full records, then drops payloads. */
export async function listAssetIndex(store: IndexedAssetStore): Promise<AssetIndexEntry[]> {
  return (await getCurrentRepo<IndexedAsset>(store).listLight()).map(toAssetIndex);
}
