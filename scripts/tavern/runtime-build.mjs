import { prepareTavern, composeAssets } from './build.mjs';
import { createHostAssets } from './host-overlay.mjs';
import { sourceAssetEntries } from './source.mjs';

/** Keep unmodified-source verification separate from STE's explicit runtime overlays. */
export async function prepareTavernRuntime(projectRoot) {
  const result = await prepareTavern(projectRoot);
  const { additions, overlays } = await createHostAssets(result.source);
  const generated = result.manifest.files.map(file => ({ ...file, root: result.generatedRoot, url: '/' + file.path }));
  return { ...result, assets: composeAssets(sourceAssetEntries(result.source), [...generated, ...additions], overlays) };
}
