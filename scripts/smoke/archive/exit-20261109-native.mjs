// Natural app-window close is the assertion; runner cleanup can only record failure.
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
const port = 9256;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); throw Error('Test port occupied'); }
catch (error) { if (error.message === 'Test port occupied') throw error; }
const out = path.resolve('.cache/s5-1109', randomUUID()), vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, identifier);
const name = '合成退出角色', cardId = 'exit-card', storyId = 'exit-story';
const storyDir = path.join(vault, '角色', name, '故事', '合成退出故事');
const storyFile = path.join(storyDir, '故事.json');
await mkdir(storyDir, { recursive: true }); await mkdir(configDir, { recursive: true });
await writeFile(path.join(vault, '角色', name, '档案.json'), JSON.stringify({ id: cardId, name, tags: [], createdAt: 1, updatedAt: 1, card: { spec: 'chara_card_v3', data: { name, description: 'Synthetic exit fixture', first_mes: '合成退出正文。', extensions: {} } } }));
await writeFile(storyFile, JSON.stringify({ id: storyId, characterId: cardId, title: '合成退出故事', createdAt: 1, updatedAt: 1, markers: [], meta: {}, session: { id: 'exit-chat', title: '合成退出故事', createdAt: 1, user: { name: 'Observer' }, character: { name }, messages: [{ id: 'greeting', role: 'assistant', content: '合成退出正文。' }] } }));
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2, roleplay: { mainProfileId: 'fixture', toolProfileId: 'fixture' } }));
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'exit', vaults: [{ id: 'exit', name: '合成退出测试', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify([{ id: 'fixture', name: '合成连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }]), apiActiveProfile: 'fixture' }));
const checks = [];
const scriptRequests = [];
let step = '', phase = '', app, browser, page, ownedProof, cleaned = false;
const processState = action => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/smoke/exit-process-20261109.ps1', '-Action', action, '-RootPid', String(app.pid), '-ExpectedExe', executable, '-SnapshotFile', ownedProof], { encoding: 'utf8', windowsHide: true }));
const pause = ms => new Promise(r => setTimeout(r, ms));
const report = () => ({ identifier, executable, syntheticOnly: true, generatedMessages: 0, checks, runnerCleanupUsed: cleaned, coreScriptDelayCovered: false });
async function start(debug = true) {
  phase = 'launch';
  ownedProof = path.join(out, `processes-${step}.json`);
  app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: debug ? `--remote-debugging-port=${port}` : '' } });
  if (!debug) { await pause(1500); return; }
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); break; } catch { await pause(400); }
  }
  phase = 'connect-observer';
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  phase = 'wait-window-target';
  await expect.poll(() => browser.contexts()[0]?.pages().length ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
  page = browser.contexts()[0].pages()[0];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/script.js') scriptRequests.push({ step, phase, retry: url.searchParams.has('tt_retry') }); });
  phase = 'wait-main-ui';
  await expect(page.locator('main')).toBeVisible({ timeout: 30000 });
  phase = 'verify-fixture';
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  await page.route(/^https?:\/\/(?!tauri\.localhost(?:\/|$))/, route => route.abort());
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
}
async function closeNaturally(osMessage = false) {
  phase = 'snapshot-before-close';
  const before = processState('snapshot'), started = Date.now();
  phase = 'request-close';
  if (osMessage) processState('close');
  else await page.getByRole('button', { name: '关闭窗口', exact: true }).click({ noWaitAfter: true, timeout: 5000 });
  phase = 'wait-native-exit';
  while (app.exitCode === null && Date.now() - started < 15000) await pause(150);
  const rootExitMs = app.exitCode === null ? null : Date.now() - started;
  // A CDP observer can retain WebView processes. For a connected (not launched)
  // browser, Playwright close disconnects its socket; it does not send Browser.close.
  // Disconnect only AFTER STE has exited itself, so it cannot fabricate that result.
  if (app.exitCode !== null && browser) { await browser.close().catch(() => {}); browser = undefined; }
  let after = processState('remaining');
  for (let i = 0; after.remainingProcesses && !after.rootAlive && i < 5; i++) { await pause(500); after = processState('remaining'); }
  let cdpListening = false;
  try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) }); cdpListening = true; } catch { /* released */ }
  const row = { step, before, after, cdpListening, exitCode: app.exitCode, rootExitMs, elapsedMs: Date.now() - started, passed: app.exitCode === 0 && after.remainingProcesses === 0 && !cdpListening };
  checks.push(row);
  console.log(JSON.stringify({ step, passed: row.passed, rootExitMs, remainingProcesses: after.remainingProcesses }));
  if (!row.passed) throw Error('Natural exit assertion failed');
}
async function enterChat() {
  phase = 'enter-chat';
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('button', { name: '继续 合成退出故事', exact: true }).click();
  return page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
}
try {
  if (!process.argv.includes('--script-only')) {
  step = 'home-without-debugger'; await start(false); await closeNaturally(true);
  for (const label of ['home-titlebar', 'home-wm-close']) { step = label; await start(); await closeNaturally(label.endsWith('wm-close')); }
  step = 'chat-edit-close'; await start();
  let frame = await enterChat();
  await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled({ timeout: 20000 });
  await frame.locator('#chat .mes').first().hover();
  await frame.locator('#chat .mes .mes_edit').first().click();
  await frame.locator('#chat .edit_textarea').fill('合成退出时保存的编辑。');
  await closeNaturally();
  const saved = JSON.parse(await readFile(storyFile, 'utf8'));
  expect(saved.session.messages[0].content).toBe('合成退出时保存的编辑。');
  checks.at(-1).persistedEdit = true;
  step = 'chat-reopen-close'; await start(); frame = await enterChat();
  await expect(frame.locator('#chat')).toContainText('合成退出时保存的编辑。', { timeout: 20000 });
  await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
  await closeNaturally(true);
  }
  // Core ES-module requests were not intercepted in this WebView build. Keep the
  // explicit diagnostic switch, but do not pass that failed injection as coverage.
  const delays = process.argv.includes('--script-only')
    ? [['loading-script', '/script.js']]
    : [['loading-template', '/scripts/templates/help.html']];
  for (const [label, resource] of delays) {
    step = label; await start();
    let held;
    await page.route('http://tauri.localhost' + resource, route => { held = route; });
    const cdp = await browser.contexts()[0].newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    // Fresh document ensures the requested module is not already in its module map.
    await page.goto('http://tauri.localhost/play/' + storyId);
    phase = 'wait-delayed-resource';
    await expect.poll(() => !!held, { timeout: 15000 }).toBe(true);
    await closeNaturally();
  }
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ ...report(), passed: true }, null, 2));
  console.log(JSON.stringify({ out, ...report(), passed: true }));
} catch (error) {
  const ui = page && !page.isClosed() ? await page.evaluate(() => ({
    closeButtons: document.querySelectorAll('[aria-label="关闭窗口"]').length,
    flushDefined: typeof document.querySelector('iframe[title="SillyTavern 角色扮演"]')?.contentWindow?.__STE_TAVERN_FLUSH__ === 'function',
    startupStage: document.querySelector('iframe[title="SillyTavern 角色扮演"]')?.contentWindow?.__TAURITAVERN_STARTUP_STAGE__ ?? 'not-started',
    scriptResources: document.querySelector('iframe[title="SillyTavern 角色扮演"]')?.contentWindow?.performance.getEntriesByType('resource').map(r => new URL(r.name).pathname).filter(p => /(?:^|\/)(?:script|init|tauri-main)\.js$/.test(p)),
  })).catch(() => ({})) : {};
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ ...report(), failedAt: step, phase, errorType: error.name, ui, scriptRequests }, null, 2));
  console.log(JSON.stringify({ out, failedAt: step, phase, errorType: error.name, ui, scriptRequests, checks, passed: false })); process.exitCode = 1;
} finally {
  // No cleanup occurs until every natural-exit assertion and failure evidence is saved.
  if (app && ownedProof) {
    if (app.exitCode === null) processState('snapshot');
    let proofExists = false;
    try { await readFile(ownedProof); proofExists = true; } catch { /* no launched descendants */ }
    if (proofExists && processState('remaining').remainingProcesses) {
      cleaned = true; processState('cleanup'); await pause(800);
      await writeFile(path.join(out, 'cleanup.json'), JSON.stringify({ testOnly: true, state: processState('remaining') }));
      const failure = JSON.parse(await readFile(path.join(out, 'failure.json'), 'utf8'));
      await writeFile(path.join(out, 'failure.json'), JSON.stringify({ ...failure, runnerCleanupUsed: true }, null, 2));
    }
  }
  if (browser) await browser.close().catch(() => {});
}
