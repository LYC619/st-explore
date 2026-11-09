// Synthetic vault and dedicated app identifier only; no user vault/config is read.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const out = path.resolve('.cache/connection-1107'), vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, 'com.ste.explorer.chat1107');
const profiles = [
  { id: 'saved-main', name: '已保存的连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' },
  { id: 'other', name: '备用连接', model: 'fixture-other', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' },
];
const card = { id: 'connection-card', name: '连接回归', createdAt: 1, updatedAt: 1, tags: [], card: { spec: 'chara_card_v3', data: { name: '连接回归', first_mes: '连接暂缺仍能阅读这段既有正文。', extensions: {} } } };
const story = { id: 'connection-story', characterId: card.id, title: '连接回归', createdAt: 1, updatedAt: 1, markers: [], meta: {}, session: { id: 'connection-chat', title: '连接回归', createdAt: 1, user: { name: '旅人' }, character: { name: card.name }, messages: [{ id: 'greeting', role: 'assistant', content: card.card.data.first_mes }] } };
const storyDir = path.join(vault, '角色', '连接回归', '故事', '连接回归');
await mkdir(storyDir, { recursive: true }); await mkdir(configDir, { recursive: true });
await writeFile(path.join(vault, '角色', '连接回归', '档案.json'), JSON.stringify(card));
await writeFile(path.join(storyDir, '故事.json'), JSON.stringify(story));
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2, roleplay: { mainProfileId: 'saved-main', toolProfileId: 'saved-main' } }));
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'connection-test', vaults: [{ id: 'connection-test', name: '连接隔离回归', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify(profiles), apiActiveProfile: 'saved-main' }));
const app = spawn(path.resolve('src-tauri/target/debug/STE.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9238' } });
let browser, page;
const errors = [], checks = [];
try {
  let ready = false;
  for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:9238/json/version'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!ready) throw Error('Isolated CDP unavailable');
  browser = await chromium.connectOverCDP('http://127.0.0.1:9238'); page = browser.contexts()[0].pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://tauri.localhost/');
  await expect(page.locator('main')).toBeVisible({ timeout: 60000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  // Lose only the WebView cache after boot, then enter via the ordinary chat list.
  await page.evaluate(() => { localStorage.setItem('ste-play-guide-seen', '1'); localStorage.setItem('st-beautifier-api-profiles', JSON.stringify([{ id: 'stale-default', name: '默认', model: 'default', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }])); });
  await page.getByRole('button', { name: '聊天', exact: true }).click();
  await page.getByRole('button', { name: '继续 连接回归', exact: true }).click();
  const frame = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(frame.locator('#chat')).toContainText(card.card.data.first_mes, { timeout: 60000 });
  await expect(frame.locator('#ste_main_profile')).toHaveValue('saved-main', { timeout: 20000 });
  await expect(frame.locator('#ste_connection_notice')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('st-beautifier-api-profiles')).map(p => p.id))).toEqual(['saved-main', 'other']);
  checks.push('mid-session stale cache restored the exact saved connection on chat entry');
  await page.evaluate(async profiles => {
    await window.__TAURI_INTERNALS__.invoke('config_set', { key: 'apiProfiles', value: JSON.stringify(profiles.slice(1)) });
    await window.__TAURI_INTERNALS__.invoke('config_set', { key: 'apiActiveProfile', value: 'other' });
  }, profiles);
  await page.reload();
  await expect(frame.locator('#chat')).toContainText(card.card.data.first_mes, { timeout: 60000 });
  await expect(frame.locator('#ste_connection_notice')).toBeVisible({ timeout: 20000 });
  await frame.locator('#ste_connection_notice button').click();
  await expect(frame.locator('#ste_main_profile')).toHaveValue('saved-main');
  await frame.locator('#ste_restore_profiles').click();
  await expect(frame.locator('#ste_connection_notice')).toBeVisible();
  await frame.locator('#ste_main_profile').selectOption('other');
  await frame.locator('#ste_tool_profile').selectOption('other');
  await expect(frame.locator('#ste_connection_notice')).toBeHidden();
  await page.reload();
  await expect(frame.locator('#ste_main_profile')).toHaveValue('other', { timeout: 60000 });
  await expect(frame.locator('#chat')).toContainText(card.card.data.first_mes);
  checks.push('genuinely removed connection remains missing; explicit replacement persists to disk');
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(out, 'native.png') });
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ passed: true, checks, errors, syntheticOnly: true, generatedMessages: 0 }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), errors, checks, body: page ? (await page.locator('body').innerText().catch(() => '')).slice(0, 5000) : '' }, null, 2));
  throw error;
} finally { if (browser) await browser.close().catch(() => {}); if (app.exitCode === null) app.kill(); }
