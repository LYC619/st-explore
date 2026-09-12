import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  loadPinnedSource,
  lookupAsset,
  readAsset,
  sourceAssetEntries,
} from './source.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const vendorRoot = join(projectRoot, 'vendor/tauritavern');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

test('the complete source snapshot matches its pinned provenance and versions', async () => {
  const source = await loadPinnedSource(projectRoot);
  assert.equal(source.provenance.repository, 'https://github.com/Darkatse/TauriTavern.git');
  assert.equal(source.provenance.commit, '9693a4ec47cd4552f90878bccab453f176de0f18');
  assert.equal(source.provenance.sourceTree, '6afe13fd10ac80a3ee5d3cafb53d75100bf96013');
  assert.equal(source.provenance.packageVersion, '2.2.0');
  assert.equal(source.provenance.sillyTavernVersion, '1.18.0');
  assert.deepEqual(source.provenance.localEdits, []);
  assert.ok(source.manifest.files.filter((entry) => entry.path.startsWith('src/')).length > 900);
  assert.equal(source.manifest.files.some((entry) => entry.path.startsWith('src-tauri/')), false);
  assert.match(await readFile(join(vendorRoot, 'LICENSE'), 'utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
});

test('delivers genuine HTML and unchanged raw modules at the required origin-root URLs', async () => {
  const source = await loadPinnedSource(projectRoot);
  const assets = sourceAssetEntries(source);
  const html = (await readAsset(lookupAsset(assets, '/tavern.html'))).toString();
  const originalHtml = await readFile(join(vendorRoot, 'src/index.html'), 'utf8');
  assert.equal(html, originalHtml
    .replace('href="manifest.json"', 'href="tavern.webmanifest"')
    .replace('href="favicon.ico"', 'href="tavern-favicon.ico"'));
  assert.match(html, /<base href="\/">/);
  assert.match(html, /src="init\.js"/);
  assert.match(html, /id="send_form"/);

  for (const url of ['/script.js', '/lib.js', '/init.js', '/tauri-main.js', '/css/fontawesome.min.css', '/scripts/world-info.js', '/locales/zh-cn.json', '/webfonts/fa-solid-900.woff2']) {
    const asset = lookupAsset(assets, url);
    assert.ok(asset, `missing original asset: ${url}`);
    assert.deepEqual(await readAsset(asset), await readFile(join(vendorRoot, `src${url}`)));
  }
});

test('moves upstream metadata conflicts without replacing STE public or root HTML', async () => {
  const assets = sourceAssetEntries(await loadPinnedSource(projectRoot));
  for (const url of ['/', '/index.html', '/favicon.ico', '/manifest.json', '/robots.txt', '/sw.js', '/icon-192.png', '/icon-512.png', '/minimal.html']) {
    assert.equal(lookupAsset(assets, url), null, `STE owns ${url}`);
  }
  assert.deepEqual(await readAsset(lookupAsset(assets, '/tavern-favicon.ico')), await readFile(join(vendorRoot, 'src/favicon.ico')));
  assert.deepEqual(await readAsset(lookupAsset(assets, '/tavern.webmanifest')), await readFile(join(vendorRoot, 'src/manifest.json')));
});

test('lookup accepts query strings but refuses traversal, alternate separators and unknown files', async () => {
  const assets = sourceAssetEntries(await loadPinnedSource(projectRoot));
  assert.equal(lookupAsset(assets, '/lib.js?tt_retry=1'), lookupAsset(assets, '/lib.js'));
  for (const url of [
    '/scripts/../../package.json', '/scripts/%2e%2e/%2e%2e/package.json',
    '/scripts/%252e%252e/package.json', '/scripts%2f..%2fpackage.json',
    '/scripts\\..\\package.json', '/scripts/%5c..%5cpackage.json',
    '/scripts/./world-info.js', '//script.js', '/script.js%00', '/%ZZ',
    '/C:/Windows/win.ini', 'https://example.com/script.js',
    '/scripts/not-pinned.js', '/vendor/tauritavern/package.json',
    '/.cache/tavern/build-manifest.json',
  ]) {
    assert.equal(lookupAsset(assets, url), null, url);
  }
});

test('every read verifies source bytes instead of trusting a previous prepare', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-hash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = Buffer.from('export const pinned = true;');
  const asset = { root, path: 'module.js', sha256: sha256(content), size: content.length, url: '/module.js' };
  await writeFile(join(root, 'module.js'), content);
  assert.deepEqual(await readAsset(asset), content);
  await writeFile(join(root, 'module.js'), 'export const pinned = false;');
  await assert.rejects(readAsset(asset), /hash|size|integrity/i);
});

test('a manifest path cannot escape its approved root even when the bytes have a matching hash', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'allowed'));
  await writeFile(join(root, 'secret.txt'), 'secret');
  for (const path of ['../secret.txt', resolve(root, 'secret.txt'), '..\\secret.txt']) {
    await assert.rejects(readAsset({ root: join(root, 'allowed'), path, sha256: sha256('secret'), size: 6 }), /path|outside|relative|escape/i);
  }
});

test('a directory junction cannot disclose a file outside the approved root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-junction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'allowed'));
  await mkdir(join(root, 'outside'));
  await writeFile(join(root, 'outside/secret.txt'), 'secret');
  await symlink(join(root, 'outside'), join(root, 'allowed/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readAsset({ root: join(root, 'allowed'), path: 'linked/secret.txt', sha256: sha256('secret'), size: 6 }), /outside|escape/i);
});

test('metadata with an unreviewed upstream commit fails before source preparation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-pin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const provenance = JSON.parse(await readFile(join(vendorRoot, 'UPSTREAM.json'), 'utf8'));
  provenance.commit = '0000000000000000000000000000000000000000';
  await mkdir(join(root, 'vendor/tauritavern'), { recursive: true });
  await writeFile(join(root, 'vendor/tauritavern/UPSTREAM.json'), JSON.stringify(provenance));
  await assert.rejects(loadPinnedSource(root), /pin|commit/i);
});

test('the source manifest itself is hashed in provenance', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'vendor/tauritavern'), { recursive: true });
  await writeFile(join(root, 'vendor/tauritavern/UPSTREAM.json'), await readFile(join(vendorRoot, 'UPSTREAM.json')));
  await writeFile(join(root, 'vendor/tauritavern/SOURCE-MANIFEST.json'), '{"files":[]}');
  await assert.rejects(loadPinnedSource(root), /manifest.*hash|manifest.*integrity/i);
});

test('pins real upstream startup defaults without exposing them as static assets', async () => {
  const source = await loadPinnedSource(projectRoot);
  const defaults = source.manifest.files.find((entry) => entry.path === 'default/content/settings.json');
  assert.ok(defaults, 'original startup defaults are required for host bootstrap');
  const settings = JSON.parse((await readAsset({ root: source.vendorRoot, ...defaults })).toString());
  assert.equal(typeof settings, 'object');
  assert.ok(source.manifest.files.some((entry) => entry.path.startsWith('default/content/') && entry.path !== defaults.path));
  const assets = sourceAssetEntries(source);
  assert.equal(lookupAsset(assets, '/default/content/settings.json'), null);
  assert.equal(lookupAsset(assets, '/settings.json'), null);
});
