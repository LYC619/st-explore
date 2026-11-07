import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const out = '.cache/1105-performance', vault = path.resolve(out, 'vault');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
const page = browser.contexts()[0].pages()[0], errors = [], samples = [];
const cdp = await browser.contexts()[0].newCDPSession(page);
page.on('pageerror', e => errors.push(e.message));
const nav = route => page.evaluate(route => { history.pushState(null, '', route); dispatchEvent(new PopStateEvent('popstate')); }, route);
const memory = () => {
  const result = execFileSync('pwsh', ['-NoProfile', '-Command', `$p=Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*com.ste.explorer.playtest1105*' }; $p | ForEach-Object { $m=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($m){[pscustomobject]@{pid=$m.Id;privateBytes=$m.PrivateMemorySize64;workingSet=$m.WorkingSet64}} } | ConvertTo-Json -Compress`], { encoding: 'utf8' }).trim();
  return result ? JSON.parse(result) : [];
};
const instrument = () => {
  window.__VAULT_PERF__ = { started: performance.now(), calls: {}, durations: {}, readChars: 0, writeChars: 0, storyReads: 0, storyWrites: 0 };
  const original = window.fetch;
  window.fetch = async function(input, options) {
    const url = typeof input === 'string' ? input : input.url;
    if (!url?.includes('ipc.localhost/vault_')) return original.call(this, input, options);
    const command = new URL(url).pathname.slice(1), state = window.__VAULT_PERF__, start = performance.now();
    let args; try { args = JSON.parse(options?.body || '{}'); } catch { args = {}; }
    state.calls[command] = (state.calls[command] || 0) + 1;
    if (command === 'vault_read_text' && args.path?.endsWith('/故事.json')) state.storyReads++;
    if (command === 'vault_write_text') { state.writeChars += args.content?.length || 0; if (args.path?.endsWith('/故事.json')) state.storyWrites++; }
    const response = await original.call(this, input, options);
    state.durations[command] = (state.durations[command] || 0) + performance.now() - start;
    if (command === 'vault_read_text') {
      const text = response.text.bind(response);
      response.text = async () => { const value = await text(); state.readChars += value.length; return value; };
      const json = response.json.bind(response);
      response.json = async () => { const value = await json(); if (typeof value === 'string') state.readChars += value.length; return value; };
    }
    return response;
  };
};
const snapshot = () => page.evaluate(() => ({ ...window.__VAULT_PERF__, elapsed: performance.now() - window.__VAULT_PERF__?.started, frames: document.querySelectorAll('iframe').length, hosts: window.__STE_TAVERN_HOSTS__?.size ?? 0, domNodes: document.querySelectorAll('*').length, jsHeap: performance.memory?.usedJSHeapSize }));
try {
  await page.addInitScript(instrument);
  await writeFile(out + '/native-runtime-descriptors.json', JSON.stringify(await page.evaluate(() => ({
    tauri: Object.keys(window.__TAURI_INTERNALS__ || {}), invoke: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__ || {}, 'invoke'),
    ipc: Object.keys(window.ipc || {}), postMessage: Object.getOwnPropertyDescriptor(window.ipc || {}, 'postMessage')
  })), null, 2));
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
  const storyFiles = [];
  async function walk(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else if (entry.name === '故事.json') storyFiles.push({ file, size: (await stat(file)).size }); } }
  await walk(path.join(vault, '角色')); storyFiles.sort((a,b) => b.size-a.size);
  const largest = JSON.parse(await readFile(storyFiles[0].file, 'utf8'));
  const target = JSON.parse(await readFile(path.join(vault, '角色/我的双胞胎老婆/故事/第1-6卷 小总结版/故事.json'), 'utf8'));
  const targetOriginal = await readFile(path.join(vault, '角色/我的双胞胎老婆/故事/第1-6卷 小总结版/故事.json'), 'utf8');
  await writeFile(out + '/target-before.json', targetOriginal);
  // First launch has no index; use explicit reload for reproducible instrumentation.
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const cachePath = '.ste-control/index/story-summaries-v2.json';
  if ((await invoke('vault_stat', { root: vault, path: cachePath })).exists) await invoke('vault_remove_file', { root: vault, path: cachePath });
  for (const phase of ['cold', 'reopen']) {
    const start = Date.now(); await page.reload({ waitUntil: 'domcontentloaded' }); await nav('/library');
    await expect(page.locator('[data-character-id]').first()).toBeVisible({ timeout: 120000 });
    samples.push({ phase, visibleMs: Date.now() - start, metrics: await snapshot(), memory: memory() });
  }
  const enter = async (story, phase) => { const start = Date.now(); await nav('/story/' + story.id); await expect(page.locator('[data-chat-story-name]')).toBeVisible({ timeout: 120000 }); samples.push({ phase, visibleMs: Date.now()-start, floors: story.session.messages.length, metrics: await snapshot(), memory: memory() }); };
  await enter(largest, 'largest-reader');
  for (let index = 0; index < 8; index++) {
    await nav('/library'); await expect(page.locator('[data-character-id]').first()).toBeVisible();
    await enter(target, 'reader-cycle-' + index);
    await nav('/beautify'); await page.locator('#beautify-story').selectOption(target.id); await expect(page.locator('[data-frontend-workbench]')).toBeVisible();
    const chatStart = Date.now();
    await nav('/play/' + target.id); const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
    await expect(tavern.locator('#send_textarea')).toBeVisible({ timeout: 120000 });
    await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled({ timeout: 120000 });
    samples.push({ phase: 'chat-cycle-' + index, visibleMs: Date.now() - chatStart, metrics: await snapshot(), memory: memory() });
    // Close through the product action so the host and iframe release their state.
    await page.getByRole('button', { name: '关闭聊天', exact: true }).click();
    await expect(page.locator('iframe[title="SillyTavern 角色扮演"]')).toHaveCount(0, { timeout: 30000 });
    samples.push({ phase: 'closed-cycle-' + index, metrics: await snapshot(), memory: memory() });
  }
  await cdp.send('HeapProfiler.collectGarbage');
  samples.push({ phase: 'closed-after-diagnostic-gc', metrics: await snapshot(), memory: memory(), heap: await cdp.send('Runtime.getHeapUsage') });
  const saved = JSON.parse(await readFile(path.join(vault, '角色/我的双胞胎老婆/故事/第1-6卷 小总结版/故事.json'), 'utf8'));
  expect(hash(saved.session), 'session integrity hash').toBe(hash(JSON.parse(targetOriginal).session));
  expect(hash(saved.branches ?? []), 'branch integrity hash').toBe(hash(JSON.parse(targetOriginal).branches ?? []));
  await mkdir(out, { recursive: true }); await writeFile(out + '/native-result.json', JSON.stringify({ boundary: 'Windows WebView2 + real Rust IPC + copied library', samples, errors, sourceSessionAndBranchesUnchanged: true }, null, 2));
  console.log(JSON.stringify({ phases: samples.length, errors, sourceSessionAndBranchesUnchanged: true }));
} catch (error) {
  const state = await page.evaluate(() => ({ url: location.pathname, alerts: [...document.querySelectorAll('[role="alert"],[role="alertdialog"]')].map(e => e.textContent?.slice(0,1200)),
    hostCount: window.__STE_TAVERN_HOSTS__?.size, tauri: Object.keys(window.__TAURI_INTERNALS__ || {}),
    invokeDescriptor: { writable: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__ || {}, 'invoke')?.writable, configurable: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__ || {}, 'invoke')?.configurable },
    ipcDescriptor: { writable: Object.getOwnPropertyDescriptor(window.ipc || {}, 'postMessage')?.writable, configurable: Object.getOwnPropertyDescriptor(window.ipc || {}, 'postMessage')?.configurable } }));
  await writeFile(out + '/native-failure.json', JSON.stringify({ message: error.message.slice(0,3000), state, samples, errors }, null, 2)); console.error(error.message.slice(0,3000)); process.exitCode = 1;
}
finally { await browser.close(); }
