import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { adaptRspackConfigs, composeAssets, prepareTavern, validateBuildDependencies } from './build.mjs';
import { loadPinnedSource, PROJECT_ROOT } from './source.mjs';

test('relocates original compiler paths while preserving original entries and compiler behavior', () => {
  const vendorRoot = join(PROJECT_ROOT, 'vendor/tauritavern');
  const cacheRoot = join(PROJECT_ROOT, '.cache/tavern');
  const plugin = {};
  const original = {
    name: 'vendor-libs', mode: 'production', target: ['web', 'es2020'],
    entry: { 'lib.core': './src/lib-bundle-core.js', 'lib.optional': './src/lib-bundle-optional.js' },
    output: { path: join(vendorRoot, 'src/dist'), filename: '[name].bundle.js', module: true, clean: true },
    optimization: { moduleIds: 'deterministic', chunkIds: 'deterministic' },
    cache: { type: 'persistent', version: 'original', buildDependencies: ['original-input'], storage: { type: 'filesystem', directory: 'original-cache' } },
    plugins: [plugin],
  };
  const [adapted] = adaptRspackConfigs([original], { vendorRoot, cacheRoot, fingerprint: 'root-lock-fingerprint' });
  assert.equal(adapted.context, vendorRoot);
  assert.equal(adapted.entry, original.entry);
  assert.equal(adapted.target, original.target);
  assert.equal(adapted.output.path, join(cacheRoot, 'bundles/dist'));
  assert.equal(adapted.output.module, true);
  assert.equal(adapted.output.clean, false, 'manifest delivery does not need destructive directory cleaning');
  assert.equal(adapted.optimization.moduleIds, 'deterministic');
  assert.equal(adapted.plugins[0], plugin);
  assert.notEqual(adapted.cache.version, original.cache.version);
  assert.equal(adapted.cache.storage.directory.startsWith(cacheRoot), true);
  assert.equal(original.output.path, join(vendorRoot, 'src/dist'));
  assert.equal(original.cache.storage.directory, 'original-cache');
});

test('refuses an upstream output directory outside the frontend tree', () => {
  const vendorRoot = join(PROJECT_ROOT, 'vendor/tauritavern');
  assert.throws(() => adaptRspackConfigs([{ name: 'bad', output: { path: join(PROJECT_ROOT, 'public') } }], {
    vendorRoot, cacheRoot: join(PROJECT_ROOT, '.cache/tavern'), fingerprint: 'fixture',
  }), /outside|output|escape/i);
});

test('root dependency versions match the upstream lock and installed packages', async () => {
  const source = await loadPinnedSource(PROJECT_ROOT);
  const versions = await validateBuildDependencies(PROJECT_ROOT, source);
  assert.equal(versions['@rspack/core'], '2.0.8');
  assert.equal(versions.fflate, '0.8.2');
  assert.equal(versions.vue, '3.5.33');
});

test('a root lock drift is rejected before running an upstream compiler', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-dependencies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await loadPinnedSource(PROJECT_ROOT);
  const lock = JSON.parse(await readFile(join(PROJECT_ROOT, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/@rspack/core'] = { version: '0.0.0' };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(join(root, 'package.json'), await readFile(join(PROJECT_ROOT, 'package.json')));
  await assert.rejects(validateBuildDependencies(root, source), /lock.*@rspack\/core|@rspack\/core.*lock/i);
});

test('composing generated assets never silently replaces a pinned raw module', () => {
  const original = { url: '/script.js', root: 'vendor', path: 'src/script.js', sha256: 'original', size: 1 };
  const assets = new Map([['/script.js', original]]);
  assert.throws(() => composeAssets(assets, [{ url: '/script.js', root: 'generated', path: 'script.js', sha256: 'new', size: 1 }]), /collision|override/i);
  assert.equal(assets.get('/script.js'), original);
  const result = composeAssets(assets, [{ url: '/dist/lib.core.bundle.js', root: 'generated', path: 'dist/lib.core.bundle.js', sha256: 'new', size: 1 }]);
  assert.equal(result.size, 2);
  assert.equal(result.get('/script.js'), original);
});

test('the single host overlay seam requires the expected original hash', () => {
  const original = { url: '/script.js', root: 'vendor', path: 'src/script.js', sha256: 'original', size: 1 };
  const replacement = { url: '/script.js', root: 'generated', path: 'script.js', sha256: 'host-patch', size: 1 };
  const assets = new Map([['/script.js', original]]);
  assert.throws(() => composeAssets(assets, [], [{ asset: replacement, expectedSha256: 'wrong-upstream-version' }]), /hash|upstream/i);
  const result = composeAssets(assets, [], [{ asset: replacement, expectedSha256: 'original' }]);
  assert.equal(result.get('/script.js'), replacement);
  assert.equal(assets.get('/script.js'), original);
});

async function cacheEscapeFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-compiler-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await cp(join(PROJECT_ROOT, 'vendor/tauritavern'), join(project, 'vendor/tauritavern'), { recursive: true });
  await writeFile(join(project, 'package.json'), await readFile(join(PROJECT_ROOT, 'package.json')));
  await writeFile(join(project, 'package-lock.json'), await readFile(join(PROJECT_ROOT, 'package-lock.json')));
  await symlink(join(PROJECT_ROOT, 'node_modules'), join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { root, project };
}

for (const boundary of ['.cache', '.cache/tavern', '.cache/tavern/bundles/dist']) {
  test(`rejects the ${boundary} junction before compiler cleaning or writes`, async (t) => {
    const { root, project } = await cacheEscapeFixture(t);
    const outside = join(root, 'outside-cache');
    const sentinelDirectory = boundary === '.cache' ? join(outside, 'tavern/bundles/dist')
      : boundary === '.cache/tavern' ? join(outside, 'bundles/dist') : outside;
    await mkdir(sentinelDirectory, { recursive: true });
    const sentinel = join(sentinelDirectory, 'review-sentinel.txt');
    await writeFile(sentinel, 'outside project: preserve this file');
    const linked = join(project, boundary);
    await mkdir(join(linked, '..'), { recursive: true });
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    let failure;
    try {
      await prepareTavern(project);
    } catch (error) {
      failure = error;
    }
    assert.equal(await readFile(sentinel, 'utf8').catch(() => null), 'outside project: preserve this file', 'compiler must not delete the outside sentinel');
    assert.deepEqual(await readdir(sentinelDirectory), ['review-sentinel.txt'], 'compiler must not write outside the project');
    assert.match(failure?.message ?? '', /cache.*(?:symlink|junction|outside|escape)/i);
  });
}

test('rejects a cache junction even when it contains a valid reusable manifest', async (t) => {
  const { root, project } = await cacheEscapeFixture(t);
  const unlisted = join(project, '.cache/tavern/bundles/dist/unlisted.txt');
  await mkdir(join(unlisted, '..'), { recursive: true });
  await writeFile(unlisted, 'keep unlisted cache files without serving them');
  const initial = await prepareTavern(project);
  assert.equal(initial.reused, false);
  assert.equal(await readFile(unlisted, 'utf8'), 'keep unlisted cache files without serving them');
  assert.equal(initial.assets.has('/dist/unlisted.txt'), false);
  const outside = join(root, 'outside-cache');
  await rename(join(project, '.cache/tavern'), outside);
  await writeFile(join(outside, 'review-sentinel.txt'), 'preserve cached files outside the project');
  const manifestBefore = await readFile(join(outside, 'build-manifest.json'));
  await symlink(outside, join(project, '.cache/tavern'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareTavern(project), /cache.*(?:symlink|junction|outside|escape)/i);
  assert.deepEqual(await readFile(join(outside, 'build-manifest.json')), manifestBefore);
  assert.equal(await readFile(join(outside, 'review-sentinel.txt'), 'utf8'), 'preserve cached files outside the project');
});
