// Uses only a receipt-verified independent build and newly created synthetic data.
// Never attach to a pre-existing app, inspect real libraries or launch formal builds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir, stat, utimes, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = process.argv[2];
const executable = await requireIsolatedNativeArtifact(identifier);
const root = path.resolve('.cache/native-closeout', randomUUID());
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'fixture.json'), JSON.stringify({ identifier, synthetic: true }));
const temporary = path.join(root, 'temp'); await mkdir(temporary);
const normal = path.join(root, 'normal'), newer = path.join(root, 'newer');
for (const [directory, version] of [[normal, 2], [newer, 3]]) {
  await mkdir(directory);
  await writeFile(path.join(directory, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: version, updatedAt: 1 }));
}
const report = { identifier, receipt: process.env.STE_NATIVE_TEST_RECEIPT, syntheticRoot: root, checks: [], status: 'running' };
const resultFile = path.join(root, 'result.json');
const save = () => writeFile(resultFile, JSON.stringify(report, null, 2));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 30000) {
  for (const end = Date.now() + timeout; Date.now() < end;) { if (await check()) return; await pause(100); }
  throw new Error('bounded wait expired');
}
async function digest(directory) {
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push([path.relative(directory, full), createHash('sha256').update(await readFile(full)).digest('hex')]);
    }
  }
  await walk(directory); return files;
}
const exists = async file => !!await stat(file).catch(() => null);
let stage = 'setup', child, browser, page, closed, locker, lockClosed, owned = false;
async function check(name, action) {
  stage = name; const started = Date.now(); const detail = await action();
  report.checks.push({ name, status: 'passed', seconds: (Date.now() - started) / 1000, ...detail });
  await save(); console.log(`PASS ${name}`);
}
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
async function allocatePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function start() {
  const port = await allocatePort();
  child = spawn(executable, [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
    TEMP: temporary, TMP: temporary,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=http://127.0.0.1:${port}`,
  } });
  closed = new Promise(resolve => child.once('close', resolve));
  let launchError; child.once('error', error => { launchError = error; });
  await until(async () => {
    if (launchError || child.exitCode !== null) throw new Error('isolated process failed to start');
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  }, 120000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => !!window.__TAURI__?.core);
  page.setDefaultTimeout(20000);
  const environment = await invoke('get_environment_info');
  assert.equal(path.basename(environment.nominalPath.replace(/\\/g, '/')), identifier);
  if (environment.resolvedPath) assert.equal(path.basename(environment.resolvedPath.replace(/\\/g, '/')), identifier);
  report.environment = { status: environment.status, nominalPath: environment.nominalPath,
    resolvedPath: environment.resolvedPath, packageIdentity: environment.packageIdentity };
  const oldRoot = await invoke('config_get', { key: 'vaultRoot' });
  assert.ok(oldRoot === null || path.resolve(oldRoot).toLowerCase().startsWith(path.resolve('.cache/native-closeout').toLowerCase() + path.sep));
  owned = true;
  // IPC exists before bootstrap finishes normalizing the saved registry.
  // Do not race that startup write with installation of the next synthetic fixture.
  await expect(page.locator('[data-vault-switcher]').or(page.getByRole('button', { name: '选择文件夹', exact: true })).first()).toBeVisible({ timeout: 60000 });
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['tauri.localhost', 'ipc.localhost', '127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort();
  });
  return environment;
}
async function stop() {
  if (!child || child.exitCode !== null) { await browser?.close().catch(() => {}); return; }
  await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
  await until(() => child.exitCode !== null, 15000);
  await closed; await browser?.close().catch(() => {});
}
const profiles = [{ id: `normal-${path.basename(root)}`, name: '合成正常库', path: normal, createdAt: 1, lastUsedAt: 1 },
  { id: `newer-${path.basename(root)}`, name: '合成新版库', path: newer, createdAt: 1, lastUsedAt: 1 }];
async function setActive(id) {
  const selected = profiles[id === 'normal' ? 0 : 1];
  await invoke('config_set', { key: 'vaultRoot', value: selected.path });
  await invoke('config_set', { key: 'vaultRegistry', value: { version: 1, activeId: selected.id, vaults: profiles } });
}
async function settings(section) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: section, exact: true }).click();
}
const fakeKey = 'sk-SYNTHETIC-CLOSEOUT-SECRET', fakeName = 'SYNTHETIC-CLOSEOUT-CARD', fakeBody = 'SYNTHETIC-CLOSEOUT-PRIVATE-BODY';
let probeCount = 0, probeAuthorized = false;
const service = createServer(async (request, response) => {
  probeCount++; probeAuthorized = request.headers.authorization === `Bearer ${fakeKey}`;
  for await (const _chunk of request) { /* synthetic probe only, never log request bodies */ }
  response.writeHead(401, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { message: fakeBody } }));
});
try {
  // Prove a dead PID without guessing one; the runner's own PID remains live.
  const expired = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' });
  const expiredPid = expired.pid; await new Promise(resolve => expired.once('close', resolve));
  const names = { stale: `ste-st-import-${expiredPid}-1`, live: `ste-st-import-${process.pid}-2`, fresh: `ste-st-import-${expiredPid}-3`,
    malformed: 'ste-st-import-not-a-pid-4', linked: `ste-st-import-${expiredPid}-5` };
  const oldTime = new Date(Date.now() - 48 * 3600000);
  for (const key of ['stale', 'live', 'fresh', 'malformed']) {
    const directory = path.join(temporary, names[key]); await mkdir(directory); await writeFile(path.join(directory, 'synthetic.txt'), 'fixture');
    if (key !== 'fresh') await utimes(directory, oldTime, oldTime);
  }
  const linkedTarget = path.join(root, 'linked-target'); await mkdir(linkedTarget); await writeFile(path.join(linkedTarget, 'synthetic.txt'), 'fixture');
  await utimes(linkedTarget, oldTime, oldTime);
  stage = 'setup-synthetic-junction';
  await symlink(linkedTarget, path.join(temporary, names.linked), 'junction');
  let environment;
  await check('isolated-start-and-stale-import-cleanup', async () => {
    environment = await start();
    await until(async () => !await exists(path.join(temporary, names.stale)));
    for (const key of ['live', 'fresh', 'malformed', 'linked']) assert.ok(await exists(path.join(temporary, names[key])));
    assert.ok(await exists(path.join(linkedTarget, 'synthetic.txt')));
    return { removed: 1, retained: 4, linkedTargetPreserved: true };
  });
  await check('configure-synthetic-vault-and-restart', async () => {
    await setActive('normal'); await stop(); environment = await start();
    await expect(page.locator('[data-vault-switcher]')).toHaveAttribute('aria-label', '当前文件库：合成正常库');
    await expect(page.locator('[data-app-error]')).toHaveCount(0);
  });
  await check('library-chat-world-entrypoints', async () => {
    await page.getByRole('button', { name: '角色库', exact: true }).first().click(); await expect(page).toHaveURL(/\/library$/);
    await page.getByRole('button', { name: '聊天', exact: true }).first().click(); await expect(page).toHaveURL(/\/play$/);
    await page.getByRole('button', { name: /山海之间/ }).click(); await expect(page).toHaveURL(/\/worlds$/);
    await expect(page.getByRole('heading', { name: '让世界，自己生长。' })).toBeVisible();
    await expect(page.locator('[data-app-error]')).toHaveCount(0);
    await page.getByRole('button', { name: '返回聊天', exact: true }).click();
  });
  const newerBefore = await digest(newer);
  await check('newer-vault-switch-refusal', async () => {
    await page.locator('[data-vault-switcher]').click();
    await page.locator('[data-vault-switcher-menu]').getByRole('button', { name: /合成新版库/ }).click();
    await expect(page.getByText('这个库被更新版本的 STE 使用过，请用新版本打开', { exact: true })).toBeVisible();
    assert.equal((await invoke('config_get', { key: 'vaultRegistry' })).activeId, profiles[0].id);
    assert.equal(path.resolve(await invoke('config_get', { key: 'vaultRoot' })), normal);
    assert.deepEqual(await digest(newer), newerBefore); await page.keyboard.press('Escape');
    return { filesUnchanged: newerBefore.length };
  });
  await check('newer-vault-startup-refusal-and-recovery', async () => {
    await setActive('newer'); await stop(); await start();
    await expect(page.getByRole('alert')).toHaveText('这个库被更新版本的 STE 使用过，请用新版本打开');
    await expect(page.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
    assert.deepEqual(await digest(newer), newerBefore);
    await page.screenshot({ path: path.join(root, 'newer-vault.png') });
    await setActive('normal'); await stop(); environment = await start();
    await expect(page.locator('[data-vault-switcher]')).toHaveAttribute('aria-label', '当前文件库：合成正常库');
    return { filesUnchanged: newerBefore.length, recovered: true };
  });
  await check('configuration-lock-timeout-ui-and-retry', async () => {
    await settings('AI 配置');
    await page.evaluate(() => {
      window.__closeoutNotices = [];
      const start = Date.now();
      const read = () => {
        const statuses = ['另一个 STE 窗口正在写配置，请稍后再试', '切换失败', '请稍后重试', '正在切换连接作用域，完成前暂不能保存。'];
        for (const status of statuses) if (document.body.innerText.includes(status) && !window.__closeoutNotices.some(item => item.status === status)) {
          window.__closeoutNotices.push({ status, elapsedMs: Date.now() - start });
        }
      };
      new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const configDir = await realpath(environment.nominalPath);
    locker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/smoke/native-config-lock.ps1'),
      '-ConfigDir', configDir, '-Identifier', identifier, '-RunRoot', root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    lockClosed = new Promise(resolve => locker.once('close', resolve));
    let ready = false; locker.stdout.on('data', value => { if (String(value).includes('LOCK_READY')) ready = true; });
    await until(() => ready || locker.exitCode !== null); assert.ok(ready);
    const started = Date.now(); await page.getByRole('switch', { name: '本库单独配置', exact: true }).click();
    await expect(page.getByText('另一个 STE 窗口正在写配置，请稍后再试', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    const elapsedMs = Date.now() - started; assert.ok(elapsedMs >= 4500 && elapsedMs < 15000);
    await writeFile(path.join(root, 'release-lock'), 'release'); await lockClosed;
    // The failed scope change can now be retried through the same visible control.
    await page.getByRole('switch', { name: '本库单独配置', exact: true }).click();
    await expect(page.getByRole('switch', { name: '本库单独配置', exact: true })).toBeChecked();
    return { elapsedMs };
  });
  await check('native-http-classified-probe', async () => {
    await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByRole('textbox', { name: '提供商名称', exact: true }).fill('合成原生服务');
    await page.getByRole('textbox', { name: 'API 接口地址', exact: true }).fill(`http://127.0.0.1:${service.address().port}/v1/chat/completions`);
    await page.locator('#api-model-name').fill('synthetic'); await page.getByLabel('API Key', { exact: true }).fill(fakeKey);
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('button', { name: '测试连通', exact: true }).click();
    await expect(page.getByText(/密钥无效或没有访问权限/)).toBeVisible();
    await expect(page.getByText(/HTTP 401；已尝试 1 次/)).toBeVisible();
    await expect(page.getByText(fakeBody, { exact: true })).toHaveCount(0);
    assert.equal(probeCount, 1); assert.equal(probeAuthorized, true);
    return { requests: probeCount, classification: 'auth', nativeTransport: true };
  });
  await check('diagnostic-file-and-environment-signals', async () => {
    const failed = await invoke('vault_read_text', { root: normal, path: `${fakeName}/missing.json` }).then(() => false, () => true); assert.ok(failed);
    await invoke('write_diagnostic_event', { event: { event: 'frontend_error', operation: 'error', source: fakeBody, path: fakeName, host: fakeKey, category: fakeKey } });
    await settings('关于与引导');
    await expect(page.locator('[data-build-identity]')).toBeVisible();
    await expect(page.locator('[data-config-location]')).toHaveCount(0);
    assert.equal(environment.logAvailable, true);
    const logDir = await page.evaluate(() => window.__TAURI__.path.appLogDir());
    assert.ok(logDir.replace(/\\/g, '/').split('/').includes(identifier));
    const logs = (await readdir(logDir)).filter(file => /^ste(?:\.[12])?\.log$/.test(file)); assert.ok(logs.length > 0 && logs.length <= 3);
    const text = (await Promise.all(logs.map(file => readFile(path.join(logDir, file), 'utf8')))).join('\n');
    for (const secret of [fakeKey, fakeName, fakeBody]) assert.equal(text.includes(secret), false);
    assert.ok(text.includes('vault_read_text')); assert.ok(text.includes('"timeout"')); assert.ok(text.includes('"401"') || text.includes(':401'));
    await page.screenshot({ path: path.join(root, 'about-native.png') });
    return { environmentStatus: environment.status, resolvedPathDiffers: environment.resolvedPath?.replace(/^\\\\\?\\/, '').toLowerCase() !== environment.nominalPath.toLowerCase(),
      hasPackageIdentity: !!environment.packageIdentity, logFiles: logs.length, secretMatches: 0 };
  });
  await check('native-close', async () => { await stop(); return { exited: true }; });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = { stage, kind: error.name, code: error.code,
    runnerLine: error.stack?.match(/closeout-native\.mjs:(\d+:\d+)/)?.[1] };
  if (owned) report.notices = await page.evaluate(() => window.__closeoutNotices).catch(() => undefined);
  if (owned) await page?.screenshot({ path: path.join(root, 'failed-synthetic.png') }).catch(() => {});
  console.error(`FAIL ${stage} (${error.name}${error.code ? `/${error.code}` : ''}, line ${report.failure.runnerLine ?? 'unknown'})`); process.exitCode = 1;
} finally {
  if (locker && locker.exitCode === null) { await writeFile(path.join(root, 'release-lock'), 'release'); await lockClosed; }
  if (child && child.exitCode === null) { await stop().catch(() => { child.kill(); }); }
  await browser?.close().catch(() => {}); service.closeAllConnections(); service.close();
  await save(); console.log(`Native evidence: ${root}`);
}
