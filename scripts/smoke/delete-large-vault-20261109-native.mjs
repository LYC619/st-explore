// Times real character deletions in an isolated build on a synthetic ~445 MB vault.
// Navigation stays in-app so the vault index and caches survive between deletions.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = 'com.ste.explorer.feedback1109';
const executable = await requireIsolatedNativeArtifact(identifier);
const running = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'ConvertTo-Json -Compress -InputObject @(Get-Process STE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path)'], { encoding: 'utf8', windowsHide: true }));
if (running.some(p => p?.toLowerCase() === executable.toLowerCase())) throw Error('Test artifact already running');
const port = 9258;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); throw Error('Test port occupied'); }
catch (error) { if (error.message === 'Test port occupied') throw error; }
const out = path.resolve('.cache/large-vault-1109', randomUUID()), vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, identifier);
const fixture = JSON.parse(execFileSync(process.execPath, ['scripts/smoke/large-vault-fixture-20261109.mjs', vault], { encoding: 'utf8' }).trim().split('\n').at(-1));
await mkdir(configDir, { recursive: true });
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'large', vaults: [{ id: 'large', name: '合成大库', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify([{ id: 'fixture', name: '合成连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }]), apiActiveProfile: 'fixture' }));
const pause = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
let app, browser, page, ownedProof = path.join(out, 'processes.json');
const processState = action => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/smoke/exit-process-20261109.ps1', '-Action', action, '-RootPid', String(app.pid), '-ExpectedExe', executable, '-SnapshotFile', ownedProof], { encoding: 'utf8', windowsHide: true }));
try {
  const launched = Date.now();
  app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); break; } catch { await pause(400); } }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
  page = browser.contexts()[0].pages()[0];
  await expect(page.locator('main')).toBeVisible({ timeout: 120000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  const route = target => page.evaluate(p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, target);
  for (let i = 0; i < 3; i++) {
    const id = `bench-char-${i}`;
    await route(`/character/${id}`);
    await expect(page.getByRole('button', { name: '操作', exact: true })).toBeVisible({ timeout: 300000 });
    await page.getByRole('button', { name: '操作', exact: true }).click();
    await page.getByRole('button', { name: '删除角色卡', exact: true }).click();
    const started = Date.now();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page).toHaveURL(/\/library$/, { timeout: 900000 });
    rows.push({ id, confirmToLibraryMs: Date.now() - started, sinceLaunchMs: Date.now() - launched });
    console.log(JSON.stringify(rows.at(-1)));
  }
  processState('snapshot');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click({ noWaitAfter: true, timeout: 5000 });
  const closing = Date.now();
  while (app.exitCode === null && Date.now() - closing < 30000) await pause(150);
  const result = { identifier, executable, syntheticOnly: true, fixture, rows, exitedNaturally: app.exitCode === 0 };
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ out, rows, exitedNaturally: result.exitedNaturally }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ identifier, executable, rows, error: String(error).slice(0, 400) }, null, 2));
  console.log(JSON.stringify({ out, rows, error: String(error).slice(0, 400) })); process.exitCode = 1;
} finally {
  if (app) {
    if (app.exitCode === null) processState('snapshot');
    let proofExists = false;
    try { await readFile(ownedProof); proofExists = true; } catch { /* nothing launched */ }
    if (proofExists && processState('remaining').remainingProcesses) { processState('cleanup'); await pause(800); }
  }
  if (browser) await browser.close().catch(() => {});
}
