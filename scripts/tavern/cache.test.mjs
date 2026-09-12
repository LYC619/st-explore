import assert from 'node:assert/strict';
import { access, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareCacheDirectory, prepareCacheDirectories, revalidateCompilerCacheDirectories } from './cache.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-cache-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  return { root, project };
}

test('creates absent cache and host parents as real in-project directories', async (t) => {
  const { project } = await fixture(t);
  const directory = await prepareCacheDirectory(project, 'host/nested');
  assert.equal(directory, join(project, '.cache/tavern/host/nested'));
  assert.equal(await realpath(directory), join(await realpath(project), '.cache/tavern/host/nested'));
  for (const relative of ['.cache', '.cache/tavern', '.cache/tavern/host', '.cache/tavern/host/nested']) {
    const stat = await lstat(join(project, relative));
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isSymbolicLink(), false);
  }
});

test('validates every requested directory before creating any unsafe path', async (t) => {
  const { root, project } = await fixture(t);
  for (const relative of ['../outside', '/absolute', 'C:/outside', 'host/../../outside', 'host\\outside', 'host//nested']) {
    await assert.rejects(prepareCacheDirectory(project, relative), /cache.*path/i);
  }
  await assert.rejects(prepareCacheDirectories(project, ['host', '../outside']), /cache.*path/i);
  assert.deepEqual(await readdir(root), ['project']);
  await assert.rejects(access(join(project, '.cache')));
});

for (const relative of ['.cache', '.cache/tavern', '.cache/tavern/host', '.cache/tavern/rspack/vendor-libs']) {
  test(`refuses existing ${relative} junctions without writing through them`, async (t) => {
    const { root, project } = await fixture(t);
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'review-sentinel.txt'), 'outside');
    const linked = join(project, relative);
    await mkdir(join(linked, '..'), { recursive: true });
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareCacheDirectory(project, 'host/new-directory'), /cache.*(?:symlink|junction|outside|escape)/i);
    assert.deepEqual(await readdir(outside), ['review-sentinel.txt']);
    assert.equal(await readFile(join(outside, 'review-sentinel.txt'), 'utf8'), 'outside');
  });
}

test('rejects a link installed after an earlier successful preparation', async (t) => {
  const { root, project } = await fixture(t);
  const host = await prepareCacheDirectory(project, 'host');
  const outside = join(root, 'outside');
  await rename(host, outside);
  await writeFile(join(outside, 'review-sentinel.txt'), 'outside');
  await symlink(outside, host, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareCacheDirectory(project, 'host/new-directory'), /cache.*(?:symlink|junction|outside|escape)/i);
  assert.deepEqual(await readdir(outside), ['review-sentinel.txt']);
});

test('rejects a non-directory cache ancestor without replacing it', async (t) => {
  const { project } = await fixture(t);
  await writeFile(join(project, '.cache'), 'preserve file');
  await assert.rejects(prepareCacheDirectory(project, 'host'), /cache.*directory/i);
  assert.equal(await readFile(join(project, '.cache'), 'utf8'), 'preserve file');
});

test('rejects writable cache files hard-linked to an external file', async (t) => {
  const { root, project } = await fixture(t);
  const cache = await prepareCacheDirectory(project);
  const outside = join(root, 'review-sentinel.txt');
  await writeFile(outside, 'outside');
  await link(outside, join(cache, 'build-manifest.json'));
  await assert.rejects(prepareCacheDirectory(project), /cache.*link/i);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('prepares every original compiler output and cache directory in one validation pass', async (t) => {
  const { project } = await fixture(t);
  const relatives = ['bundles/dist', 'bundles/scripts/tauri/setting/dist', 'rspack/vendor-libs'];
  const result = await prepareCacheDirectories(project, relatives);
  assert.equal(result.cacheRoot, join(project, '.cache/tavern'));
  assert.deepEqual(result.directories, relatives.map((relative) => join(result.cacheRoot, relative)));
  for (const directory of result.directories) assert.equal((await lstat(directory)).isDirectory(), true);
});

test('active compiler ancestry rechecks reject an output directory replaced after preparation', async (t) => {
  const { root, project } = await fixture(t);
  const relative = 'bundles/dist';
  const directory = await prepareCacheDirectory(project, relative);
  const outside = join(root, 'outside');
  await rename(directory, outside);
  await writeFile(join(outside, 'review-sentinel.txt'), 'outside');
  await symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(revalidateCompilerCacheDirectories(project, [relative, 'rspack/vendor-libs']), /cache.*(?:symlink|junction|outside|escape)/i);
  assert.deepEqual(await readdir(outside), ['review-sentinel.txt']);
});
