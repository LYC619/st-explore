// Synthetic vault only. No formal identifier, user profile or model request.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = 'com.ste.explorer.feedback1109';
const executable = await requireIsolatedNativeArtifact(identifier);
const blocked = process.argv.includes('--expect-blocked');
const port = 9257;
let occupied = false;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* unused */ }
if (occupied) throw Error('Test port occupied');
const out = path.resolve('.cache/existing-paths-1111', randomUUID()), vault = path.join(out, 'vault');
const exact = p => path.toNamespacedPath(p);
const hash = b => createHash('sha256').update(b).digest('hex');
const payloads = [];
await mkdir(vault, { recursive: true });
for (let i = 0; i < 2; i++) {
  const name = `批删合成${i}`, dir = path.join(vault, '角色', name);
  await mkdir(dir, { recursive: true });
  const card = { id: `synthetic-${i}`, name, tags: [], status: '未开始', createdAt: 1, updatedAt: 1, card: { spec: 'chara_card_v3', data: { name, description: 'Synthetic fixture', extensions: {} } } };
  await writeFile(path.join(dir, '档案.json'), JSON.stringify(card));
  for (const [j, suffix] of ['', '.', ' ', '..'].entries()) {
    const relative = `角色/${name}/附件/${'x'.repeat(79)}${suffix}/sample${suffix}.txt${suffix}`;
    const filename = exact(path.join(vault, relative));
    await mkdir(path.dirname(filename), { recursive: true });
    const bytes = Buffer.from(`synthetic-body-${i}-${j}`);
    await writeFile(filename, bytes);
    payloads.push({ relative, sha256: hash(bytes) });
  }
}
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2 }));
const configDir = path.join(process.env.APPDATA, identifier);
await mkdir(configDir, { recursive: true });
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'paths1111', vaults: [{ id: 'paths1111', name: '合成路径测试', path: vault, createdAt: 1, lastUsedAt: 1 }] } }));
const app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
let browser, page;
const checks = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await new Promise(r => setTimeout(r, 300)); } }
  if (!ready) throw Error('Independent native CDP unavailable');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  await page.goto('http://tauri.localhost/');
  await expect(page.locator('main')).toBeVisible({ timeout: 60000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  await page.route(/^https?:\/\/(?!tauri\.localhost(?:\/|$))/, route => route.abort());
  await page.goto('http://tauri.localhost/library');
  await page.getByPlaceholder('搜索角色或标签').fill('批删合成');
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await page.getByRole('button', { name: '全选筛选结果', exact: true }).click();
  await expect(page.getByText('已选 2 个', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  if (blocked) {
    await expect(page.getByText(/文件检查未完成，已停止删除/).first()).toBeVisible({ timeout: 30000 });
    for (const item of payloads) expect(hash(await readFile(exact(path.join(vault, item.relative))))).toBe(item.sha256);
    expect((await readdir(path.join(vault, '.ste/retained')).catch(() => []))).toHaveLength(0);
    checks.push('actual batch-delete entry blocked by legacy suffixes; all fixture bytes unchanged');
  } else {
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 60000 });
    await expect(page.getByText(/文件检查未完成，已停止删除/)).toHaveCount(0);
    const operations = await readdir(path.join(vault, '.ste/retained'));
    expect(operations).toHaveLength(2);
    let count = 0;
    for (const operation of operations) {
      const m = JSON.parse(await readFile(path.join(vault, '.ste/retained', operation, 'manifest.json'), 'utf8'));
      for (const item of payloads.filter(p => m.files.some(f => f.path === p.relative))) {
        expect(hash(await readFile(exact(path.join(vault, '.ste/retained', operation, 'files', item.relative))))).toBe(item.sha256);
        count++;
      }
    }
    expect(count).toBe(payloads.length);
    checks.push('batch deleted 2 cards; all 8 attachments moved with exact names and hashes');
    await page.goto('http://tauri.localhost/settings');
    await page.getByRole('button', { name: '数据与备份', exact: true }).click();
    await page.getByRole('button', { name: '查看回收站', exact: true }).click();
    const recycle = page.getByRole('region', { name: '库内回收站' });
    await expect(recycle.getByRole('button', { name: '恢复到原位置', exact: true })).toHaveCount(2);
    await recycle.getByRole('button', { name: '恢复到原位置', exact: true }).first().click();
    await expect(recycle.getByRole('button', { name: '恢复到原位置', exact: true })).toHaveCount(1);
    await recycle.getByRole('button', { name: '恢复到原位置', exact: true }).click();
    await expect(recycle).toContainText('回收站为空');
    for (const item of payloads) expect(hash(await readFile(exact(path.join(vault, item.relative))))).toBe(item.sha256);
    await page.goto('http://tauri.localhost/library'); await page.reload();
    await page.getByPlaceholder('搜索角色或标签').fill('批删合成');
    await page.getByRole('button', { name: '批量管理', exact: true }).click();
    await page.getByRole('button', { name: '全选筛选结果', exact: true }).click();
    await expect(page.getByText('已选 2 个', { exact: true })).toBeVisible();
    checks.push('restored both cards through recycle UI; all exact paths and bytes survive reload');
  }
  const result = { passed: true, mode: blocked ? 'baseline-blocked' : 'fixed', identifier, executable, checks, fixtureOnly: true, modelRequests: 0 };
  await writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ out, ...result }));
} catch (error) {
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: String(error), checks }));
  throw error;
} finally { await browser?.close().catch(() => {}); if (app.exitCode === null) app.kill(); }
