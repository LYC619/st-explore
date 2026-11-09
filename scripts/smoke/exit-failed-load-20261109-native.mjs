// Natural window close after a failed or stalled tavern startup. Synthetic vault only.
// Launches only the isolated artifact; the process helper touches only its own process tree.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = 'com.ste.explorer.feedback1109';
const executable = await requireIsolatedNativeArtifact(identifier);
const running = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'ConvertTo-Json -Compress -InputObject @(Get-Process STE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path)'], { encoding: 'utf8', windowsHide: true }));
if (running.some(p => p?.toLowerCase() === executable.toLowerCase())) throw Error('Test artifact already running');
const port = 9257;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); throw Error('Test port occupied'); }
catch (error) { if (error.message === 'Test port occupied') throw error; }
// A subresource that never answers keeps the frame's load event, and script.js's top-level wait, pending.
const sockets = new Set();
const hang = createServer(() => {}); hang.on('connection', socket => sockets.add(socket));
await new Promise(resolve => hang.listen(0, '127.0.0.1', resolve));
const hangUrl = `http://127.0.0.1:${hang.address().port}/stall.png`;
const out = path.resolve('.cache/s5-failed-load-1109', randomUUID()), vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, identifier);
const name = '合成退出角色', cardId = 'exit-card', storyId = 'exit-story', title = '合成退出故事';
await mkdir(path.join(vault, '角色', name, '故事', title), { recursive: true }); await mkdir(configDir, { recursive: true });
await writeFile(path.join(vault, '角色', name, '档案.json'), JSON.stringify({ id: cardId, name, tags: [], createdAt: 1, updatedAt: 1, card: { spec: 'chara_card_v3', data: { name, description: 'Synthetic exit fixture', first_mes: '合成退出正文。', extensions: {} } } }));
await writeFile(path.join(vault, '角色', name, '故事', title, '故事.json'), JSON.stringify({ id: storyId, characterId: cardId, title, createdAt: 1, updatedAt: 1, markers: [], meta: {}, session: { id: 'exit-chat', title, createdAt: 1, user: { name: 'Observer' }, character: { name }, messages: [{ id: 'greeting', role: 'assistant', content: '合成退出正文。' }] } }));
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2, roleplay: { mainProfileId: 'fixture', toolProfileId: 'fixture' } }));
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'exit', vaults: [{ id: 'exit', name: '合成退出测试', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify([{ id: 'fixture', name: '合成连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }]), apiActiveProfile: 'fixture' }));
const checks = [];
let step = '', phase = '', app, browser, page, ownedProof, cleaned = false;
const processState = action => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/smoke/exit-process-20261109.ps1', '-Action', action, '-RootPid', String(app.pid), '-ExpectedExe', executable, '-SnapshotFile', ownedProof], { encoding: 'utf8', windowsHide: true }));
const pause = ms => new Promise(r => setTimeout(r, ms));
const frameState = () => page.evaluate(() => {
  const frame = document.querySelector('iframe[title="SillyTavern 角色扮演"]');
  return { evaluated: frame?.contentWindow?.__STE_ST_EVALUATED__ === true, readyState: frame?.contentDocument?.readyState, stalled: !!window.__STE_TEST_STALLED__ };
});
async function start() {
  phase = 'launch';
  ownedProof = path.join(out, `processes-${step}.json`);
  app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); break; } catch { await pause(400); }
  }
  phase = 'connect-observer';
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
  page = browser.contexts()[0].pages()[0];
  phase = 'wait-main-ui';
  await expect(page.locator('main')).toBeVisible({ timeout: 30000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
}
async function enterChat() {
  phase = 'enter-chat';
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('button', { name: `继续 ${title}`, exact: true }).click();
}
async function closeNaturally(osMessage) {
  phase = 'snapshot-before-close';
  const before = processState('snapshot'), started = Date.now();
  phase = 'request-close';
  if (osMessage) processState('close');
  else await page.getByRole('button', { name: '关闭窗口', exact: true }).click({ noWaitAfter: true, timeout: 5000 });
  phase = 'wait-native-exit';
  while (app.exitCode === null && Date.now() - started < 15000) await pause(150);
  const rootExitMs = app.exitCode === null ? null : Date.now() - started;
  if (app.exitCode !== null && browser) { await browser.close().catch(() => {}); browser = undefined; }
  let after = processState('remaining');
  for (let i = 0; after.remainingProcesses && !after.rootAlive && i < 5; i++) { await pause(500); after = processState('remaining'); }
  const row = { step, before, after, exitCode: app.exitCode, rootExitMs, passed: app.exitCode === 0 && after.remainingProcesses === 0 };
  checks.push(row);
  console.log(JSON.stringify({ step, passed: row.passed, rootExitMs, remainingProcesses: after.remainingProcesses }));
  if (!row.passed) throw Error('Natural exit assertion failed');
}
try {
  // --stalled-only compares builds on the stalled case alone.
  for (const osMessage of process.argv.includes('--stalled-only') ? [] : [true, false]) {
    step = `failed-bootstrap-${osMessage ? 'wm-close' : 'titlebar'}`; await start();
    phase = 'inject-bootstrap-failure';
    // registerTavernHost keeps an existing registry; its frame reads the host from it.
    await page.evaluate(() => {
      const hosts = new Map(), set = hosts.set.bind(hosts);
      hosts.set = (id, host) => {
        const request = host.request.bind(host);
        host.request = (url, ...rest) => url === '/api/bootstrap'
          ? Promise.resolve(new Response(JSON.stringify({ error: { message: '合成核心数据读取失败' } }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
          : request(url, ...rest);
        return set(id, host);
      };
      window.__STE_TAVERN_HOSTS__ = hosts;
    });
    await enterChat();
    phase = 'wait-startup-failure';
    await expect(page.getByText('合成核心数据读取失败').first()).toBeVisible({ timeout: 60000 });
    checks.push({ step, startupFailedVisibly: true, frame: await frameState() });
    await closeNaturally(osMessage);
  }
  for (const osMessage of [true, false]) {
    step = `stalled-load-${osMessage ? 'wm-close' : 'titlebar'}`; await start();
    phase = 'inject-stalled-resource';
    await page.evaluate(url => {
      const timer = setInterval(() => {
        const doc = document.querySelector('iframe[title="SillyTavern 角色扮演"]')?.contentDocument;
        if (!doc || !doc.URL.includes('/tavern.html') || doc.readyState === 'complete') return;
        const img = doc.createElement('img'); img.src = url; img.alt = ''; doc.documentElement.append(img);
        window.__STE_TEST_STALLED__ = true; clearInterval(timer);
      }, 5);
    }, hangUrl);
    await enterChat();
    phase = 'confirm-stall';
    await expect.poll(async () => (await frameState()).stalled, { timeout: 30000 }).toBe(true);
    await pause(4000);
    const state = await frameState();
    if (state.evaluated || state.readyState === 'complete') throw Error('Stall injection missed: ' + JSON.stringify(state));
    checks.push({ step, stallConfirmed: true, frame: state, hangConnections: sockets.size });
    await closeNaturally(osMessage);
  }
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ identifier, executable, syntheticOnly: true, checks, passed: true }, null, 2));
  console.log(JSON.stringify({ out, passed: true }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ identifier, executable, failedAt: step, phase, error: String(error).slice(0, 400), checks }, null, 2));
  console.log(JSON.stringify({ out, failedAt: step, phase, error: String(error).slice(0, 400), passed: false })); process.exitCode = 1;
} finally {
  if (app && ownedProof) {
    if (app.exitCode === null) processState('snapshot');
    let proofExists = false;
    try { await readFile(ownedProof); proofExists = true; } catch { /* no launched descendants */ }
    if (proofExists && processState('remaining').remainingProcesses) {
      cleaned = true; processState('cleanup'); await pause(800);
      await writeFile(path.join(out, 'cleanup.json'), JSON.stringify({ testOnly: true, runnerCleanupUsed: cleaned, state: processState('remaining') }));
    }
  }
  if (browser) await browser.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  hang.close();
}
