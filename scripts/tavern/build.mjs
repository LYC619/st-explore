import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  isWithin, loadPinnedSource, PROJECT_ROOT, readAsset, safeRelativePath, sha256, sourceAssetEntries,
} from './source.mjs';
import { prepareCacheDirectories, prepareCacheDirectory, revalidateCompilerCacheDirectories } from './cache.mjs';

export const REQUIRED_BUNDLES = [
  'dist/lib.core.bundle.js',
  'dist/lib.optional.bundle.js',
  'scripts/extensions/agent-system/dist/index.bundle.js',
  'scripts/tauri/setting/dist/settings.bundle.js',
  'scripts/tauri/setting/dist/dev-logs.bundle.js',
  'scripts/tauri/setting/dist/sync.bundle.js',
];

/** The root lock is the installation authority; upstream's lock supplies reviewed direct versions. */
export async function validateBuildDependencies(projectRoot, source) {
  const { parse } = await import('yaml');
  const [upstreamPackage, upstreamLock, rootPackage, rootLock] = await Promise.all([
    readFile(path.join(source.vendorRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(source.vendorRoot, 'pnpm-lock.yaml'), 'utf8').then(parse),
    readFile(path.join(projectRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'package-lock.json'), 'utf8').then(JSON.parse),
  ]);
  const versions = {};
  const imports = upstreamLock.importers['.'];
  for (const name of ['@rspack/core', ...Object.keys(upstreamPackage.dependencies)]) {
    const locked = (name === '@rspack/core' ? imports.devDependencies : imports.dependencies)[name];
    const declared = (name === '@rspack/core' ? upstreamPackage.devDependencies : upstreamPackage.dependencies)[name];
    if (locked.specifier !== declared) throw new Error(`Upstream dependency specifier/lock mismatch: ${name}`);
    const version = String(locked.version).split('(', 1)[0];
    const rootDeclared = rootPackage.dependencies?.[name] ?? rootPackage.devDependencies?.[name];
    if (rootDeclared !== version || rootLock.packages[`node_modules/${name}`]?.version !== version) {
      throw new Error(`Root package/lock must pin ${name}@${version} from upstream`);
    }
    versions[name] = version;
  }
  for (const [name, version] of Object.entries(versions)) {
    const installed = JSON.parse(await readFile(path.join(projectRoot, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== version) throw new Error(`Installed ${name} differs from root lock; run npm ci`);
  }
  return versions;
}

export function adaptRspackConfigs(originalConfigs, { vendorRoot, cacheRoot, fingerprint }) {
  return originalConfigs.map((original) => {
    const sourceRoot = path.join(vendorRoot, 'src');
    if (!isWithin(sourceRoot, original.output.path) || original.output.path === sourceRoot) {
      throw new Error(`Upstream output path is outside a frontend output directory: ${original.output.path}`);
    }
    const outputRelative = path.relative(sourceRoot, original.output.path);
    return {
      ...original,
      context: vendorRoot,
      // Only manifest-listed assets are delivered; never recursively clean a cache path.
      output: { ...original.output, path: path.join(cacheRoot, 'bundles', outputRelative), clean: false },
      cache: {
        ...original.cache,
        version: sha256(`${original.cache.version}\n${fingerprint}`),
        buildDependencies: [
          ...original.cache.buildDependencies,
          path.resolve(vendorRoot, '../../package-lock.json'),
          fileURLToPath(import.meta.url),
        ],
        storage: { ...original.cache.storage, directory: path.join(cacheRoot, 'rspack', original.name) },
      },
    };
  });
}

/**
 * Single composition seam for later STE host overlays. New files are explicit;
 * replacing a pinned URL additionally requires that source's reviewed hash.
 * Middleware and production copying consume the exact same resulting map.
 */
export function composeAssets(originalAssets, generatedAssets, overlays = []) {
  const assets = new Map(originalAssets);
  for (const asset of generatedAssets) {
    if (assets.has(asset.url)) throw new Error(`Generated/source URL collision: ${asset.url}`);
    assets.set(asset.url, asset);
  }
  for (const { asset, expectedSha256 } of overlays) {
    const original = assets.get(asset.url);
    if (!original || original.sha256 !== expectedSha256) throw new Error(`Host overlay upstream hash mismatch: ${asset.url}`);
    assets.set(asset.url, asset);
  }
  return assets;
}

async function readBuildManifest(manifestPath, generatedRoot, fingerprint) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.fingerprint !== fingerprint || !Array.isArray(manifest.files)) return null;
    if (REQUIRED_BUNDLES.some((name) => !manifest.files.some((entry) => entry.path === name))) return null;
    const names = new Set();
    for (const file of manifest.files) {
      if (!safeRelativePath(file.path) || names.has(file.path.toLowerCase())) return null;
      names.add(file.path.toLowerCase());
      await readAsset({ root: generatedRoot, ...file });
    }
    return manifest;
  } catch {
    // Missing, stale, or edited generated files are rebuilt from verified inputs.
    return null;
  }
}

async function compileBundles(configs, generatedRoot, { prepareCache, revalidateCache }) {
  const { rspack } = await import('@rspack/core');
  await prepareCache();
  const compiler = rspack(configs);
  for (const child of compiler.compilers ?? [compiler]) {
    child.hooks.beforeRun.tapPromise('STEValidatedCache', revalidateCache);
    child.hooks.emit.tapPromise('STEValidatedCache', revalidateCache);
  }
  try {
    const stats = await new Promise((resolve, reject) => {
      compiler.run((error, result) => error ? reject(error) : resolve(result));
    });
    if (!stats || stats.hasErrors()) {
      throw new Error(`Original Tavern bundle build failed:\n${stats?.toString({ all: false, errors: true, errorDetails: true }) ?? 'No compiler stats'}`);
    }
    if (stats.hasWarnings()) console.warn(stats.toString({ all: false, warnings: true }));
    const files = [];
    for (const child of stats.stats ?? [stats]) {
      const outputRoot = child.compilation.outputOptions.path;
      for (const asset of child.compilation.getAssets()) {
        const file = path.relative(generatedRoot, path.join(outputRoot, asset.name)).split(path.sep).join('/');
        if (!safeRelativePath(file)) throw new Error(`Generated output escapes its root: ${file}`);
        const bytes = await readFile(path.join(generatedRoot, file));
        files.push({ path: file, sha256: sha256(bytes), size: bytes.length });
      }
    }
    if (REQUIRED_BUNDLES.some((name) => !files.some((entry) => entry.path === name))) throw new Error('Original compiler omitted a required Tavern bundle');
    return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  } finally {
    // Closing a persistent compiler can write its cache too.
    await revalidateCache();
    await new Promise((resolve, reject) => compiler.close((error) => error ? reject(error) : resolve()));
  }
}

export async function prepareTavern(projectRoot = PROJECT_ROOT) {
  const cacheRoot = await prepareCacheDirectory(projectRoot);
  const source = await loadPinnedSource(projectRoot);
  const versions = await validateBuildDependencies(projectRoot, source);
  const generatedRoot = path.join(cacheRoot, 'bundles');
  const manifestPath = path.join(cacheRoot, 'build-manifest.json');
  const rootLockHash = sha256(await readFile(path.join(projectRoot, 'package-lock.json')));
  const fingerprint = sha256(JSON.stringify({
    sourceManifest: source.manifestHash,
    rootLock: rootLockHash,
    wrapper: sha256(await readFile(fileURLToPath(import.meta.url))),
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    rspack: versions['@rspack/core'],
  }));
  await prepareCacheDirectory(projectRoot);
  let manifest = await readBuildManifest(manifestPath, generatedRoot, fingerprint);
  await prepareCacheDirectory(projectRoot);
  const reused = Boolean(manifest);
  if (!manifest) {
    const { default: originalConfigs } = await import(pathToFileURL(path.join(source.vendorRoot, 'rspack.config.js')).href);
    const configs = adaptRspackConfigs(originalConfigs, { vendorRoot: source.vendorRoot, cacheRoot, fingerprint });
    const compilerDirectories = configs.flatMap((config) => [config.output.path, config.cache.storage.directory]).map((directory) => {
      if (!isWithin(cacheRoot, directory)) throw new Error(`Unsafe Tavern cache compiler directory outside its root: ${directory}`);
      return path.relative(cacheRoot, directory).split(path.sep).join('/');
    });
    const files = await compileBundles(configs, generatedRoot, {
      prepareCache: () => prepareCacheDirectories(projectRoot, compilerDirectories),
      revalidateCache: () => revalidateCompilerCacheDirectories(projectRoot, compilerDirectories),
    });
    manifest = {
      schemaVersion: 1, fingerprint, sourceCommit: source.provenance.commit,
      sourceManifestSha256: source.manifestHash, rootLockSha256: rootLockHash,
      nodeVersion: process.versions.node, rspackVersion: versions['@rspack/core'], files,
    };
    await prepareCacheDirectory(projectRoot);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await prepareCacheDirectory(projectRoot);
  const generatedAssets = manifest.files.map((file) => ({ root: generatedRoot, ...file, url: `/${file.path}` }));
  // Add reviewed STE host-generated entries/overlays at this seam; never edit vendor/src.
  const assets = composeAssets(sourceAssetEntries(source), generatedAssets);
  return { assets, source, cacheRoot, generatedRoot, manifest, reused };
}
