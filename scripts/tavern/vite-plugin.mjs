import path from 'node:path';
import { prepareTavernRuntime } from './runtime-build.mjs';
import { checkAssetCollisions, copyAssets, createAssetMiddleware } from './delivery.mjs';

/** @returns {import('vite').Plugin} */
export function tavernFrontend() {
  let config;
  let preparation;
  const prepare = () => preparation ??= prepareTavernRuntime(config.root);
  return {
    name: 'ste-pinned-tavern-frontend',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    async configureServer(server) {
      const { assets } = await prepare();
      if (config.publicDir) await checkAssetCollisions(assets, config.publicDir);
      server.middlewares.use(createAssetMiddleware(assets));
    },
    async buildStart() {
      if (config.command === 'build') await prepare();
    },
    async writeBundle(options) {
      if (!options.dir) throw new Error('Tavern frontend requires a Vite output directory');
      const { assets } = await prepare();
      const count = await copyAssets(assets, path.resolve(config.root, options.dir));
      config.logger.info(`Tavern: copied ${count} verified assets alongside the STE app.`);
    },
  };
}
