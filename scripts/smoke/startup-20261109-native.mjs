// S4 investigation: verified independent binary and synthetic vault only.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = process.env.STE_S4_IDENTIFIER ?? 'com.ste.explorer.feedback1109';
const verify = process.argv.includes('--verify');
const executable = await requireIsolatedNativeArtifact(identifier);
const running = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'ConvertTo-Json -Compress -InputObject @(Get-Process STE -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path)'], { encoding: 'utf8', windowsHide: true }));
if (running.some(p => p?.toLowerCase() === executable.toLowerCase())) throw Error('Test binary is already running');
const port = 9254;
let occupied = false;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* port unused */ }
if (occupied) throw Error('Test port occupied');
const out = path.resolve('.cache/s4-1109', randomUUID());
const vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, identifier);
const name = '合成启动角色', cardId = 'startup-card';
await mkdir(path.join(vault, '角色', name), { recursive: true });
await writeFile(path.join(vault, '角色', name, '档案.json'), JSON.stringify({ id: cardId, name, tags: [], createdAt: 1, updatedAt: 1, card: { spec: 'chara_card_v3', data: { name, description: 'Synthetic startup fixture', first_mes: '合成启动正文。', extensions: {} } } }));
for (const id of ['a', 'b']) {
  const dir = path.join(vault, '角色', name, '故事', `合成故事${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '故事.json'), JSON.stringify({ id: `startup-${id}`, characterId: cardId, title: `合成故事${id}`, createdAt: 1, updatedAt: 1, markers: [], meta: {}, session: { id: `chat-${id}`, title: `合成故事${id}`, createdAt: 1, user: { name: 'Observer' }, character: { name }, messages: [{ id: `greeting-${id}`, role: 'assistant', content: `合成启动正文${id}。` }] } }));
}
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2, roleplay: { mainProfileId: 'fixture', toolProfileId: 'fixture' } }));
await mkdir(configDir, { recursive: true });
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'startup', vaults: [{ id: 'startup', name: '合成启动测试', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify([{ id: 'fixture', name: '合成连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }]), apiActiveProfile: 'fixture' }));
const app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
let browser, page, verified = false;
const trace = [], checks = [], errors = [];
let run = '', assetHash;
const report = () => ({ identifier, executable, assetHash, syntheticOnly: true, generatedMessages: 0, checks, trace, errors });
try {
  let connected = false;
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); connected = true; break; }
    catch { await new Promise(r => setTimeout(r, 500)); }
  }
  if (!connected) throw Error('Independent CDP unavailable');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  await page.goto('http://tauri.localhost/');
  await expect(page.locator('main')).toBeVisible({ timeout: 60000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  verified = true;
  await page.route(/^https?:\/\/(?!tauri\.localhost(?:\/|$))/, route => route.abort());
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
  page.on('pageerror', () => errors.push({ run, type: 'pageerror' }));
  await page.exposeBinding('__s4Trace', (_, value) => trace.push({ run, ...value }));
  const raw = await page.evaluate(() => fetch('/script.js').then(r => r.text()));
  assetHash = createHash('sha256').update(raw).digest('hex');
  const frame = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const open = async (id = 'a') => {
    await page.goto(`http://tauri.localhost/play/startup-${id}`);
    await expect(frame.locator('#chat')).toContainText(`合成启动正文${id}。`, { timeout: 60000 });
    await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled({ timeout: 15000 });
    expect(await page.evaluate(() => window.__STE_TAVERN_HOSTS__?.size)).toBe(1);
  };
  run = 'untouched';
  const start = Date.now();
  await open(); checks.push({ run, readyMs: Date.now() - start });
  let source = raw;
  const begin = source.indexOf('async function firstLoadInit('), end = source.indexOf('\nasync function fixViewport()', begin);
  if (begin < 0 || end < 0) throw Error('Startup seam missing');
  let body = source.slice(begin, end);
  const waits = [
    'initPresetManager()', 'initSystemMessages()', 'applySettingsSnapshot(bootstrapSnapshot.settings)',
    'checkOpenRouterAuth()', 'getUserAvatars(true, user_avatar)', 'applyCharactersSnapshot(bootstrapSnapshot.characters)',
    'printCharacters(true)', 'getBackgrounds()', 'initPersonas()', 'initSlashCommandAutoComplete()',
    'extensionsDiscoveryPromise', 'activateRequiredChatSurfaceExtensions()',
    'eventSource.emit(event_types.EXTENSION_SETTINGS_LOADED)', 'eventSource.emit(event_types.APP_INITIALIZED)',
    'fixViewport()', 'eventSource.emit(event_types.APP_READY)',
  ];
  for (const [i, expr] of waits.entries()) {
    if (!body.includes(`await ${expr}`)) throw Error(`Missing wait ${i}`);
    body = body.replace(`await ${expr}`, `await globalThis.__S4_WAIT__(${JSON.stringify(expr)}, () => ${expr})`);
  }
  body = body.replace('await activateStartupSystemExtensions({', 'await globalThis.__S4_WAIT__("activateStartupSystemExtensions", () => activateStartupSystemExtensions({').replace('parallelism: startupExtensionParallelism,\n            });', 'parallelism: startupExtensionParallelism,\n            }));');
  const helper = `globalThis.__S4_WAIT__ = async (step, action) => { void globalThis.__s4Trace({ step, state: 'begin', at: performance.now() }); try { const result = await action(); void globalThis.__s4Trace({ step, state: 'end', at: performance.now() }); return result; } catch (error) { void globalThis.__s4Trace({ step, state: 'failed', at: performance.now() }); throw error; } };\n`;
  source = source.slice(0, begin) + helper + body + source.slice(end);
  // Final checks use only compiled assets; tracing is confined to diagnosis.
  if (!verify) await page.route('http://tauri.localhost/script.js', route => route.fulfill({ body: source, contentType: 'text/javascript' }));
  for (let i = 0; i < 5; i++) {
    run = `${verify ? 'compiled' : 'traced'}-${i}`; const start = Date.now();
    await open(i % 2 === 0 ? 'a' : 'b'); checks.push({ run, readyMs: Date.now() - start });
  }
  if (process.argv.includes('--storage-block') || verify) {
    // Reproduce a genuine IndexedDB upgrade blocked by another open connection.
    // This store belongs only to the hash-verified independent test app.
    run = 'blocked-text-completion-cache';
    await page.goto('http://tauri.localhost/');
    await expect(page.locator('main')).toBeVisible();
    await page.evaluate(async () => {
      const name = 'SillyTavern_TextCompletions';
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = resolve; request.onerror = () => reject(Error('fixture delete failed'));
        request.onblocked = () => reject(Error('test fixture still has an open connection'));
      });
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('s4-marker').put('preserved', 'fixture');
        request.onsuccess = () => { window.__s4Blocker = request.result; resolve(); };
        request.onerror = () => reject(Error('fixture connection failed'));
      });
    });
    await page.getByRole('button', { name: '聊天', exact: true }).click();
    await page.getByRole('button', { name: '继续 合成故事a', exact: true }).click();
    if (verify) {
      await expect(frame.locator('#chat')).toContainText('合成启动正文a。', { timeout: 15000 });
      await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => window.__s4Blocker.version)).toBe(1);
      checks.push({ run, readyWhileCacheBlocked: true });
    } else {
      await expect(page.getByRole('button', { name: '重新加载酒馆', exact: true })).toBeVisible({ timeout: 25000 });
      expect(await frame.locator('#chat .mes').count()).toBe(0);
      checks.push({ run, blockedAt: trace.filter(item => item.run === run).at(-1)?.step, status: await page.locator('header [role="status"]').innerText() });
    }
    await page.evaluate(() => window.__s4Blocker.close());
    await expect(frame.locator('#chat')).toContainText('合成启动正文a。', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
    checks.push({ run, recoveredAfterUnblock: true });
    expect(await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('SillyTavern_TextCompletions');
        req.onsuccess = () => resolve(req.result); req.onerror = reject;
      });
      try { return await new Promise((resolve, reject) => {
        const req = db.transaction('s4-marker').objectStore('s4-marker').get('fixture');
        req.onsuccess = () => resolve(req.result); req.onerror = reject;
      }); } finally { db.close(); }
    })).toBe('preserved');
  }
  if (verify) {
    const hostCount = () => page.evaluate(() => window.__STE_TAVERN_HOSTS__?.size ?? 0);
    async function holdResource(resource, action) {
      let held;
      const matcher = 'http://tauri.localhost' + resource;
      const handler = route => { if (!held) held = route; else return route.continue(); };
      await page.route(matcher, handler);
      try {
        await page.goto('http://tauri.localhost/play/startup-a');
        await expect.poll(() => !!held, { timeout: 15000 }).toBe(true);
        await action();
      } finally {
        await page.unroute(matcher, handler);
        // Let an old response arrive only after its document has been replaced.
        await held?.continue().catch(() => {});
      }
      expect(await hostCount()).toBe(1);
      await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
    }
    run = 'delayed-extension-reload';
    await holdResource('/scripts/extensions/regex/index.js', async () => {
      await expect(page.locator('header [role="status"]')).toHaveText('启动中：启动内置扩展…');
      await expect(page.getByRole('button', { name: '重新加载酒馆', exact: true })).toBeVisible({ timeout: 25000 });
      expect(await frame.locator('#chat .mes').count()).toBe(0);
      const oldSrc = await page.locator('iframe[title="SillyTavern 角色扮演"]').getAttribute('src');
      await page.evaluate(() => { window.__s4OldHost = [...window.__STE_TAVERN_HOSTS__.values()][0]; });
      await page.getByRole('button', { name: '重新加载酒馆', exact: true }).click();
      await expect(frame.locator('#chat')).toContainText('合成启动正文a。', { timeout: 15000 });
      expect(await page.locator('iframe[title="SillyTavern 角色扮演"]').getAttribute('src')).not.toBe(oldSrc);
      await page.evaluate(() => { window.__s4OldHost.startup('S4 stale callback', true); window.__s4OldHost.ready(); delete window.__s4OldHost; });
      await expect(page.getByRole('alert')).toHaveCount(0);
    });
    checks.push({ run, slowNoticeAndReload: true, retiredCallbackIgnored: true, hosts: await hostCount() });
    run = 'delayed-template-close-switch';
    await holdResource('/scripts/templates/help.html', async () => {
      await expect(page.locator('header [role="status"]')).toHaveText('启动中：读取内置界面模板…');
      await page.getByRole('button', { name: '关闭聊天', exact: true }).click();
      await expect(page.locator('iframe[title="SillyTavern 角色扮演"]')).toHaveCount(0);
      expect(await hostCount()).toBe(0);
      await page.getByRole('button', { name: '继续 合成故事b', exact: true }).click();
      await expect(frame.locator('#chat')).toContainText('合成启动正文b。', { timeout: 15000 });
    });
    checks.push({ run, closedThenOpenedOtherStory: true, hosts: await hostCount() });
    run = 'helper-read-failure-retry';
    const helperMatcher = 'http://tauri.localhost/ste/helper-lodash.js';
    await page.route(helperMatcher, route => route.abort());
    await page.goto('http://tauri.localhost/play/startup-a');
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '过程', exact: true })).toBeDisabled();
    await page.unroute(helperMatcher);
    await page.getByRole('button', { name: '重新加载酒馆', exact: true }).click();
    await expect(frame.locator('#chat')).toContainText('合成启动正文a。', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await hostCount()).toBe(1);
    checks.push({ run, failureVisibleAndRetrySucceeded: true });
  }
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ ...report(), passed: true }, null, 2));
  console.log(JSON.stringify({ out, passed: true, checks, errors, assetHash }));
} catch (error) {
  const state = verified ? { status: await page.locator('header [role="status"]').innerText().catch(() => ''), traceCount: trace.length } : {};
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ ...report(), error: String(error), state }, null, 2));
  console.log(JSON.stringify({ out, passed: false, error: String(error), state, last: trace.slice(-6) })); process.exitCode = 1;
} finally { if (browser) await browser.close().catch(() => {}); if (app.exitCode === null) app.kill(); }
