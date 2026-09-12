import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { copyAssets, createAssetMiddleware } from './delivery.mjs';
import { sha256 } from './source.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ste-tavern-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'source');
  const outputRoot = join(root, 'output');
  await mkdir(sourceRoot);
  await mkdir(outputRoot);
  const assets = new Map();
  for (const [url, content] of [
    ['/tavern.html', '<!doctype html><title>Tavern</title>'],
    ['/script.js', 'export const original = true;'],
    ['/css/tavern.css', 'body { color: white; }'],
  ]) {
    const path = url.slice(1);
    await mkdir(join(sourceRoot, path, '..'), { recursive: true });
    await writeFile(join(sourceRoot, path), content);
    assets.set(url, { root: sourceRoot, path, url, size: Buffer.byteLength(content), sha256: sha256(content) });
  }
  return { root, sourceRoot, outputRoot, assets };
}

async function serverFor(t, assets) {
  const middleware = createAssetMiddleware(assets);
  const server = createServer((req, res) => middleware(req, res, () => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('STE route');
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method, agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves exact pinned bytes with JavaScript MIME and leaves ordinary STE routes to Vite', async (t) => {
  const { assets } = await fixture(t);
  const get = await serverFor(t, assets);
  const response = await get('/script.js?tt_retry=1');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /javascript/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.body, 'export const original = true;');
  for (const path of ['/', '/index.html', '/favicon.ico', '/manifest.json', '/sw.js', '/library/']) {
    assert.equal((await get(path)).body, 'STE route', path);
  }
});

test('HEAD sends headers without a body and mutation methods cannot reach static files', async (t) => {
  const { assets } = await fixture(t);
  const get = await serverFor(t, assets);
  const response = await get('/script.js', 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(response.body, '');
  assert.ok(Number(response.headers['content-length']) > 0);
  assert.equal((await get('/script.js', 'POST')).status, 405);
});

test('unknown reserved paths, traversal and direct metadata requests never fall through to Vite', async (t) => {
  const { assets } = await fixture(t);
  const get = await serverFor(t, assets);
  for (const path of [
    '/scripts/missing.js', '/css/missing.css', '/dist/missing.js', '/lib/missing.js',
    '/scripts/../../package.json', '/scripts/%2e%2e/%2e%2e/package.json',
    '/scripts/%252e%252e/package.json', '/scripts%2f..%2fpackage.json',
    '/vendor/tauritavern/package.json', '/VENDOR/tauritavern/package.json',
    '/@fs/temporary/vendor/tauritavern/package.json',
    '/.cache/tavern/build-manifest.json', '/default/content/settings.json',
    '/ScRiPtS/tavern/source.mjs', '/scripts\\..\\package.json',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body.includes('STE route'), false, path);
  }
});

test('changed source cannot be served after middleware creation', async (t) => {
  const { sourceRoot, assets } = await fixture(t);
  const get = await serverFor(t, assets);
  await writeFile(join(sourceRoot, 'script.js'), 'tampered');
  const response = await get('/script.js');
  assert.equal(response.status, 500);
  assert.equal(response.body.includes('tampered'), false);
  assert.equal(response.body.includes(sourceRoot), false);
});

test('production copy writes the identical asset set without replacing STE files', async (t) => {
  const { outputRoot, assets } = await fixture(t);
  await writeFile(join(outputRoot, 'index.html'), 'STE app');
  await writeFile(join(outputRoot, 'favicon.ico'), 'STE icon');
  assert.equal(await copyAssets(assets, outputRoot), 3);
  assert.equal(await readFile(join(outputRoot, 'script.js'), 'utf8'), 'export const original = true;');
  assert.equal(await readFile(join(outputRoot, 'index.html'), 'utf8'), 'STE app');
  assert.equal(await readFile(join(outputRoot, 'favicon.ico'), 'utf8'), 'STE icon');
});

test('an existing collision aborts before any asset is copied', async (t) => {
  const { outputRoot, assets } = await fixture(t);
  await writeFile(join(outputRoot, 'script.js'), 'STE owned');
  await assert.rejects(copyAssets(assets, outputRoot), /collision/i);
  assert.equal(await readFile(join(outputRoot, 'script.js'), 'utf8'), 'STE owned');
  await assert.rejects(access(join(outputRoot, 'tavern.html')));
});

test('case-insensitive conflicts and file/directory conflicts fail on every platform', async (t) => {
  const first = await fixture(t);
  await writeFile(join(first.outputRoot, 'SCRIPT.js'), 'STE owned');
  await assert.rejects(copyAssets(first.assets, first.outputRoot), /collision/i);
  const second = await fixture(t);
  await writeFile(join(second.outputRoot, 'css'), 'STE file');
  await assert.rejects(copyAssets(second.assets, second.outputRoot), /collision/i);
  const third = await fixture(t);
  third.assets.set('/SCRIPT.js', { ...third.assets.get('/script.js'), url: '/SCRIPT.js' });
  await assert.rejects(copyAssets(third.assets, third.outputRoot), /collision/i);
});

test('output traversal and junction escapes cannot write outside the build directory', async (t) => {
  const { root, outputRoot, assets } = await fixture(t);
  const invalid = new Map([['/../escape.js', { ...assets.get('/script.js'), url: '/../escape.js' }]]);
  await assert.rejects(copyAssets(invalid, outputRoot), /path|outside|escape/i);
  await mkdir(join(root, 'outside'));
  await symlink(join(root, 'outside'), join(outputRoot, 'css'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(copyAssets(assets, outputRoot), /outside|escape|symlink|junction/i);
  await assert.rejects(access(join(root, 'outside/tavern.css')));
  await assert.rejects(access(join(outputRoot, 'tavern.html')));
});

test('a tampered asset aborts before any production files are written', async (t) => {
  const { sourceRoot, outputRoot, assets } = await fixture(t);
  await writeFile(join(sourceRoot, 'script.js'), 'tampered');
  await assert.rejects(copyAssets(assets, outputRoot), /integrity|hash/i);
  await assert.rejects(access(join(outputRoot, 'tavern.html')));
});
