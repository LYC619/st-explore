import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  cargoLockPackageBlocks,
  replaceCargoLockVersion,
  syncVersion,
} from './sync-version.mjs';

const filesFor = (root) => [
  'package-lock.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src/components/GlobalSettings.tsx',
  'public/sw.js',
].map((file) => join(root, file));

async function makeFixture({ eol = '\n', malformed = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ste-version-'));
  await Promise.all([
    mkdir(join(root, 'src-tauri'), { recursive: true }),
    mkdir(join(root, 'src/components'), { recursive: true }),
    mkdir(join(root, 'public'), { recursive: true }),
  ]);
  const write = async (file, content) => {
    const full = join(root, file);
    await writeFile(full, content.replaceAll('\n', eol));
  };
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }, null, 2));
  await write('package-lock.json', JSON.stringify({
    name: 'fixture',
    version: '0.0.1',
    packages: { '': { name: 'fixture', version: '0.0.1' } },
  }, null, 2));
  await write('src-tauri/tauri.conf.json', JSON.stringify({ version: '0.0.1' }, null, 2));
  await write('src-tauri/Cargo.toml', [
    '[package]',
    'name = "ste-explorer"',
    'version = "0.0.1"',
    '',
    '[dependencies]',
    'sample = "9.9.9"',
  ].join('\n'));
  await write('src-tauri/Cargo.lock', [
    'version = 3',
    '',
    '[[package]]',
    'name = "third-party"',
    'version = "8.8.8"',
    '',
    '[[package]]',
    'name = "ste-explorer"',
    'version = "0.0.1"',
    'dependencies = ["third-party"]',
    '',
    '[metadata]',
    '"checksum" = "keep-me"',
  ].join('\n'));
  await write('src/components/GlobalSettings.tsx', [
    "export const APP_VERSION = 'v0.0.1';",
    'export const unrelated = "version = v0.0.1";',
    malformed ? "export const APP_VERSION = 'v0.0.2';" : '',
  ].join('\n'));
  await write('public/sw.js', "const CACHE_VERSION = 'v0.0.1';\n");
  return root;
}

async function snapshot(paths) {
  return Promise.all(paths.map(async (file) => [file, await readFile(file, 'utf8')]));
}

test('check reports drift without writing and write is idempotent', async () => {
  const root = await makeFixture();
  try {
    const paths = filesFor(root);
    const before = await snapshot(paths);
    const check = await syncVersion(root, 'check');
    assert.equal(check.changedFiles.length, paths.length);
    assert.deepEqual(await snapshot(paths), before);

    const written = await syncVersion(root, 'write');
    assert.deepEqual(written.changedFiles.sort(), paths.sort());
    assert.deepEqual((await syncVersion(root, 'check')).changedFiles, []);
    assert.deepEqual((await syncVersion(root, 'write')).changedFiles, []);

    const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
    assert.equal(packageLock.version, '1.2.3');
    assert.equal(packageLock.packages[''].version, '1.2.3');
    assert.equal(JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version, '1.2.3');
    assert.match(await readFile(join(root, 'src/components/GlobalSettings.tsx'), 'utf8'), /APP_VERSION = 'v1\.2\.3'/);
    assert.match(await readFile(join(root, 'public/sw.js'), 'utf8'), /CACHE_VERSION = 'v1\.2\.3'/);
    const cargoLock = await readFile(join(root, 'src-tauri/Cargo.lock'), 'utf8');
    assert.match(cargoLock, /name = "third-party"\nversion = "8\.8\.8"/);
    assert.match(cargoLock, /name = "ste-explorer"\nversion = "1\.2\.3"/);
    assert.match(cargoLock, /\[metadata\]\n"checksum" = "keep-me"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed markers fail before writing any target', async () => {
  const root = await makeFixture({ malformed: true });
  try {
    const paths = filesFor(root);
    const before = await snapshot(paths);
    await assert.rejects(() => syncVersion(root, 'write'), /APP_VERSION/);
    assert.deepEqual(await snapshot(paths), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Cargo.lock replacement preserves line endings, metadata, and third-party versions', () => {
  for (const eol of ['\n', '\r\n']) {
    const lock = [
      'version = 3',
      '',
      '[[package]]',
      'name = "ste-explorer"',
      'version = "0.0.1"',
      '',
      '[[package]]',
      'name = "third-party"',
      'version = "8.8.8"',
      '',
      '[metadata]',
      '"checksum" = "keep-me"',
      '',
    ].join(eol);
    const result = replaceCargoLockVersion(lock, '1.2.3');
    assert.equal((result.match(/version =/g) ?? []).length, 3);
    assert.match(result, new RegExp(`name = "ste-explorer"${eol}version = "1\\.2\\.3"`));
    assert.match(result, new RegExp(`name = "third-party"${eol}version = "8\\.8\\.8"`));
    assert.match(result, new RegExp(`\\[metadata\\]${eol}"checksum" = "keep-me"`));
    assert.equal(result.endsWith(eol), true);
  }
});

test('Cargo.lock self package must be unique and have one version field', () => {
  const duplicate = [
    '[[package]]',
    'name = "ste-explorer"',
    'version = "0.0.1"',
    '',
    '[[package]]',
    'name = "ste-explorer"',
    'version = "0.0.2"',
  ].join('\n');
  assert.equal(cargoLockPackageBlocks(duplicate).length, 2);
  assert.throws(() => replaceCargoLockVersion(duplicate, '1.2.3'), /expected one ste-explorer package/);
  const missing = '[[package]]\nname = "ste-explorer"\n';
  assert.throws(() => replaceCargoLockVersion(missing, '1.2.3'), /self version/);
  const repeated = '[[package]]\nname = "ste-explorer"\nversion = "0.0.1"\nversion = "0.0.2"\n';
  assert.throws(() => replaceCargoLockVersion(repeated, '1.2.3'), /self version/);
});
