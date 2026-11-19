// Synthetic native boundary verification. No formal identifier or existing library is opened.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = process.argv[2];
const executable = await requireIsolatedNativeArtifact(identifier);
const root = path.resolve('.cache/native-review-hardening', randomUUID());
const temporary = path.join(root, 'temp'); await mkdir(temporary, { recursive: true });
const vault = path.join(root, 'vault'), source = path.join(root, 'source'), newer = path.join(root, 'newer');
for (const directory of [vault, source, newer]) await mkdir(directory, { recursive: true });
await writeFile(path.join(root, 'fixture.json'), JSON.stringify({ identifier, synthetic: true }));
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 3, updatedAt: 1 }));
await writeFile(path.join(newer, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 999, updatedAt: 1 }));
await writeFile(path.join(source, 'chat.jsonl'), '{"synthetic":true}\n');
await writeFile(path.join(source, 'data.json'), '{"synthetic":true}');
await writeFile(path.join(vault, 'blocked.cmd'), '@echo synthetic');
const report = { identifier, receipt: process.env.STE_NATIVE_TEST_RECEIPT, syntheticRoot: root, checks: [], status: 'running' };
const resultFile = path.join(root, 'result.json');
const save = () => writeFile(resultFile, JSON.stringify(report, null, 2));
const sessions = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end;) { if (await fn()) return; await pause(100); }
  throw Error('bounded wait expired');
}
async function digest(directory) {
  const result = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { result.push([path.relative(directory, full), 'directory']); await walk(full); }
      else result.push([path.relative(directory, full), createHash('sha256').update(await readFile(full)).digest('hex')]);
    }
  }
  await walk(directory); return result;
}
async function start() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  const child = spawn(executable, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
    TEMP: temporary, TMP: temporary,
    WEBVIEW2_USER_DATA_FOLDER: path.join(root, `webview-${randomUUID()}`),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=http://127.0.0.1:${port}`,
  } });
  const session = { child }; sessions.add(session);
  console.log(`START synthetic pid=${child.pid} port=${port}`);
  session.closed = new Promise(resolve => child.once('close', resolve));
  let launchError; child.once('error', error => { launchError = error; });
  await until(async () => {
    if (launchError || child.exitCode !== null) throw Error('isolated process failed to start');
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 120000);
  session.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  console.log('CONNECTED synthetic WebView');
  session.page = session.browser.contexts()[0].pages()[0];
  await session.page.waitForFunction(() => !!window.__TAURI__?.core);
  session.invoke = (command, args) => session.page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
  const environment = await session.invoke('get_environment_info');
  for (const directory of [environment.nominalPath, environment.resolvedPath].filter(Boolean)) {
    assert.equal(path.basename(directory.replace(/\\/g, '/')), identifier);
  }
  session.configDir = environment.nominalPath;
  await session.page.route('**/*', route => ['tauri.localhost', 'ipc.localhost', '127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await expect(session.page.locator('[data-vault-switcher]').or(session.page.getByRole('button', { name: '选择文件夹', exact: true })).first()).toBeVisible({ timeout: 60000 });
  return session;
}
async function stop(session) {
  if (!session) return;
  if (session.child.exitCode === null) {
    await session.page?.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    try { await until(() => session.child.exitCode !== null, 15000); }
    catch { session.child.kill(); }
    await session.closed;
  }
  await session.browser?.close().catch(() => {}); sessions.delete(session);
}
let stage = 'setup';
async function check(name, fn) {
  stage = name; await fn(); report.checks.push({ name, status: 'passed' }); await save(); console.log(`PASS ${name}`);
}
const profiles = [{ id: 'synthetic-normal', name: '合成正常库', path: vault, createdAt: 1, lastUsedAt: 1 },
  { id: 'synthetic-newer', name: '合成新版库', path: newer, createdAt: 1, lastUsedAt: 1 }];
let app;
try {
  await check('verified-independent-configuration', async () => {
    app = await start();
    const previous = await app.invoke('config_get', { key: 'vaultRoot' });
    if (previous !== null) {
      const previousFixture = path.dirname(path.resolve(previous));
      const relative = path.relative(path.resolve('.cache/native-review-hardening'), previousFixture);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      const marker = JSON.parse(await readFile(path.join(previousFixture, 'fixture.json'), 'utf8'));
      assert.equal(marker.identifier, identifier); assert.equal(marker.synthetic, true);
    }
    await assert.rejects(app.invoke('config_set', { key: 'vaultRoot', value: vault }), /选择器授权/);
    const configDir = app.configDir;
    await stop(app);
    // Only this receipt-verified fresh identifier is seeded, while its process is stopped.
    assert.equal(path.basename(configDir), identifier);
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, stRoot: source,
      vaultRegistry: { version: 1, activeId: profiles[0].id, vaults: profiles } }));
    app = await start();
    await expect(app.page.locator('[data-vault-switcher]')).toHaveAttribute('aria-label', '当前文件库：合成正常库');
  });
  await check('source-readonly-and-explicit-jsonl-writeback', async () => {
    const before = await digest(source);
    assert.equal(await app.invoke('vault_read_text', { root: source, path: 'data.json' }), '{"synthetic":true}');
    for (const [command, args] of [
      ['vault_write_text', { path: 'data.json', content: '{}' }],
      ['vault_write_binary', { path: 'data.json', base64: 'e30=' }],
      ['vault_remove_file', { path: 'data.json' }],
      ['vault_rename', { from: 'data.json', to: 'changed.json' }],
      ['vault_mkdir', { path: 'changed' }],
    ]) await assert.rejects(app.invoke(command, { root: source, ...args }), /只允许读取/);
    await assert.rejects(app.invoke('vault_write_abs_binary', { path: path.join(source, 'data.json'), base64: 'e30=' }), /只允许读取/);
    await assert.rejects(app.invoke('vault_write_abs_text', { path: path.join(source, 'data.json'), content: '{}' }));
    assert.deepEqual(await digest(source), before);
    await app.invoke('vault_write_abs_text', { path: path.join(source, 'chat.jsonl'), content: '{"synthetic":"updated"}\n' });
    assert.equal(await readFile(path.join(source, 'chat.jsonl'), 'utf8'), '{"synthetic":"updated"}\n');
  });
  await check('vault-write-link-rejection-and-unsafe-open', async () => {
    await app.invoke('vault_write_text', { root: vault, path: 'roundtrip.json', content: '{"synthetic":1}' });
    assert.equal(await app.invoke('vault_read_text', { root: vault, path: 'roundtrip.json' }), '{"synthetic":1}');
    await app.invoke('vault_write_abs_binary', { path: path.join(vault, 'roundtrip.bin'), base64: 'AQID' });
    assert.deepEqual([...await readFile(path.join(vault, 'roundtrip.bin'))], [1, 2, 3]);
    await symlink(source, path.join(vault, 'linked'), 'junction');
    await assert.rejects(app.invoke('vault_read_abs_text', { path: path.join(vault, 'linked', 'data.json') }));
    await assert.rejects(app.invoke('vault_write_abs_binary', { path: path.join(vault, 'linked', 'data.json'), base64: 'e30=' }));
    await assert.rejects(app.invoke('vault_open_path', { root: vault, path: 'blocked.cmd', reveal: false }));
  });
  await check('newer-library-refused-with-zero-filesystem-change', async () => {
    const before = await digest(newer);
    await app.page.locator('[data-vault-switcher]').click();
    await app.page.locator('[data-vault-switcher-menu]').getByRole('button', { name: /合成新版库/ }).click();
    await expect(app.page.getByText('这个库被更新版本的 STE 使用过，请用新版本打开', { exact: true })).toBeVisible();
    assert.deepEqual(await digest(newer), before);
    assert.equal(path.resolve(await app.invoke('config_get', { key: 'vaultRoot' })), vault);
    await app.page.keyboard.press('Escape');
  });
  await check('independent-process-exclusion-and-release', async () => {
    const second = await start();
    await assert.rejects(second.invoke('vault_stat', { root: vault, path: '' }), /STE_LIBRARY_IN_USE/);
    await stop(app); app = second;
    assert.equal((await app.invoke('vault_stat', { root: vault, path: '' })).exists, true);
    await stop(app); app = await start();
    assert.equal(await app.invoke('vault_read_text', { root: vault, path: 'roundtrip.json' }), '{"synthetic":1}');
  });
  await check('removed-source-and-vault-grants-stay-revoked-after-restart', async () => {
    await app.invoke('config_set', { key: 'stRoot', value: null });
    await assert.rejects(app.invoke('vault_read_text', { root: source, path: 'data.json' }), /未授权/);
    await app.invoke('config_set', { key: 'vaultRoot', value: null });
    await app.invoke('config_set', { key: 'vaultRegistry', value: { version: 1, activeId: null, vaults: [] } });
    await assert.rejects(app.invoke('vault_write_text', { root: vault, path: 'revoked.txt', content: 'synthetic' }), /未授权/);
    await stop(app); app = await start();
    for (const denied of [vault, source]) await assert.rejects(app.invoke('vault_stat', { root: denied, path: '' }), /未授权/);
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failedStage = stage;
  // All inputs and visible content in this process are generated by this fixture.
  report.error = String(error); process.exitCode = 1;
} finally {
  for (const session of [...sessions]) await stop(session);
  await save(); console.log(`RESULT ${report.status}: ${resultFile}`);
}
