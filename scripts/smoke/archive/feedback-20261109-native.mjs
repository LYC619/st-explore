// Independent compiled identity, synthetic files only; never launch a formal STE binary.
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

const identifier = 'com.ste.explorer.feedback1109';
const executable = await requireIsolatedNativeArtifact(identifier);
const port = 9249;
let occupied = false;
try { await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch { /* unused */ }
if (occupied) throw Error('Independent test port is occupied');
const out = path.resolve('.cache/feedback1109/native', randomUUID()), vault = path.join(out, 'vault');
const configDir = path.join(process.env.APPDATA, identifier);
const cardName = '合成航海员', cardId = 'feedback-card', storyId = 'feedback-story';
const card = { id: cardId, name: cardName, tags: [], createdAt: 1, updatedAt: 1, card: { spec: 'chara_card_v3', data: { name: cardName, description: 'Synthetic test fixture', first_mes: '合成航行记录。', extensions: {} } } };
const story = { id: storyId, characterId: cardId, title: '合成航行', createdAt: 1, updatedAt: 1, markers: [], meta: {}, session: { id: 'fixture-chat', title: '合成航行', createdAt: 1, user: { name: 'Observer' }, character: { name: cardName }, messages: [{ id: 'greeting', role: 'assistant', content: card.card.data.first_mes }] } };
const storyDir = path.join(vault, '角色', cardName, '故事', story.title);
const md = (kind, title) => {
  const fields = { id: `record-${kind}`, kind, title, bookId: storyId, bookTitle: story.title, floorStart: 0, floorEnd: 0, volumeNumber: 1, createdAt: 1, updatedAt: 1 };
  return `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n# 合成远航\n\n船员抵达灯塔，记录天气与潮汐。\n\n${'这是用于阅读排版的虚构记录。'.repeat(30)}`;
};
await mkdir(storyDir, { recursive: true }); await mkdir(configDir, { recursive: true });
await writeFile(path.join(vault, '角色', cardName, '档案.json'), JSON.stringify(card));
await writeFile(path.join(storyDir, '故事.json'), JSON.stringify(story));
await writeFile(path.join(storyDir, '分卷总结·合成总结.md'), md('volume', '合成总结'));
await writeFile(path.join(storyDir, '角色日记·合成日记.md'), md('diary', '合成日记'));
await writeFile(path.join(vault, '库信息.json'), JSON.stringify({ id: 'archive-schema', schemaVersion: 2, roleplay: { mainProfileId: 'fixture', toolProfileId: 'fixture' } }));
await writeFile(path.join(vault, 'fingerprint.bin'), Buffer.alloc(4 * 1024 * 1024, 37));
for (let i = 0; i < 20; i++) {
  const name = `批量合成${i.toString().padStart(2, '0')}`, dir = path.join(vault, '角色', name);
  await mkdir(path.join(dir, '附件'), { recursive: true });
  await writeFile(path.join(dir, '档案.json'), JSON.stringify({ ...card, id: `bulk-${i}`, name, card: { ...card.card, data: { ...card.card.data, name } }, attachments: [{ id: 'fixture-file', title: 'Synthetic binary', path: '附件/data.bin', pathBase: 'character', size: 2097152, addedAt: 1 }] }));
  await writeFile(path.join(dir, '附件/data.bin'), Buffer.alloc(2097152, i));
}
await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ vaultRoot: vault, vaultRegistry: { version: 1, activeId: 'feedback', vaults: [{ id: 'feedback', name: '合成反馈测试', path: vault, createdAt: 1, lastUsedAt: 1 }] }, apiProfiles: JSON.stringify([{ id: 'fixture', name: '合成连接', model: 'fixture', apiKey: '', apiUrl: 'http://127.0.0.1:1/v1' }]), apiActiveProfile: 'fixture' }));
const app = spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
let browser, page, verified = false;
const checks = [], errors = [];
let timings, bulk;
const report = () => ({ identifier, executable, syntheticOnly: true, realRequests: 0, checks, errors, timings, bulk });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); ready = true; break; } catch { await new Promise(r => setTimeout(r, 500)); } }
  if (!ready) throw Error('Test CDP unavailable');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0].pages()[0];
  await page.goto('http://tauri.localhost/');
  await expect(page.locator('main')).toBeVisible({ timeout: 60000 });
  expect(path.resolve(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' })))).toBe(vault);
  verified = true;
  page.on('pageerror', () => errors.push('pageerror'));
  await page.route('https://**/*', route => route.abort());
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
  timings = await page.evaluate(async root => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      let start = performance.now();
      const old = await window.__TAURI_INTERNALS__.invoke('vault_read_binary', { root, path: 'fingerprint.bin' });
      const readBase64Ms = performance.now() - start;
      start = performance.now();
      const digest = await window.__TAURI_INTERNALS__.invoke('vault_fingerprint', { root, path: 'fingerprint.bin' });
      runs.push({ readBase64Ms, fingerprintMs: performance.now() - start, oldIpcChars: old.length, newIpcChars: digest.length, digest });
    }
    return runs;
  }, vault);
  const expectedDigest = createHash('sha256').update(Buffer.alloc(4 * 1024 * 1024, 37)).digest('hex');
  expect(timings.every(row => row.digest === expectedDigest)).toBe(true);
  checks.push('native fingerprint matches raw disk bytes; 4MiB IPC measurement');
  await page.goto(`http://tauri.localhost/character/${cardId}`);
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.getByLabel('记录标题', { exact: true }).fill('修订合成总结');
  await page.getByLabel('记录正文', { exact: true }).fill('# 修订航程\n\n这是保存后的合成总结。');
  await page.getByRole('button', { name: '阅读预览', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('这是保存后的合成总结。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '总结', exact: true }).click();
  await expect(page.locator('.record-reading')).toContainText('这是保存后的合成总结。');
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.getByLabel('记录正文', { exact: true }).fill('不应写入');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑记录', exact: true }).click();
  await expect(page.getByLabel('记录正文', { exact: true })).toHaveValue('不应写入');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.locator('.record-reading')).toContainText('这是保存后的合成总结。');
  checks.push('character summary edit, preview, save, reload, unsaved cancel');
  await page.getByRole('button', { name: '日记', exact: true }).click();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.getByLabel('记录正文', { exact: true }).fill('修订后的合成日记。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const records = await Promise.all((await readdir(storyDir)).filter(f => f.endsWith('.md')).map(f => readFile(path.join(storyDir, f), 'utf8')));
  expect(records.some(s => s.includes('这是保存后的合成总结。'))).toBe(true);
  expect(records.some(s => s.includes('修订后的合成日记。'))).toBe(true);
  checks.push('summary and diary persisted on real isolated disk');
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog.width).toBeLessThanOrEqual(390);
  // Radix's 200ms zoom-in temporarily scales the target; measure the settled layout.
  await expect.poll(async () => (await page.getByRole('button', { name: '保存修改', exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: path.join(out, 'mobile-editor.png') });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  checks.push('390px edit dialog and 44px save target');
  // Use the same real character delete command the player uses.
  await page.getByRole('button', { name: '操作', exact: true }).click();
  await page.getByRole('button', { name: '删除角色卡', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.goto('http://tauri.localhost/settings');
  await page.getByRole('button', { name: '数据与备份', exact: true }).click();
  await page.getByRole('button', { name: '查看回收站', exact: true }).click();
  const recycle = page.getByRole('region', { name: '库内回收站' });
  await expect(recycle).toContainText('档案.json');
  await recycle.getByRole('button', { name: '恢复到原位置', exact: true }).click();
  await expect(recycle).toContainText('回收站为空');
  await page.goto(`http://tauri.localhost/character/${cardId}`);
  await expect(page.getByRole('tab', { name: /^故事/ })).toBeVisible();
  checks.push('real character deletion -> recycle list -> restore -> reopen');
  await page.goto(`http://tauri.localhost/play/${storyId}`);
  const frame = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(frame.locator('#chat')).toContainText('合成航行记录。', { timeout: 60000 });
  await frame.locator('#ai-config-button .drawer-toggle').click();
  const presetFile = { name: '反馈合成预设.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ temperature: 0.7, prompts: [], prompt_order: [], extensions: {} })) };
  await frame.locator('#openai_preset_import_file').setInputFiles(presetFile);
  await expect(frame.locator('#settings_preset_openai option:checked')).toHaveText('反馈合成预设');
  await frame.locator('#delete_oai_preset').click();
  await frame.locator('.popup:visible .popup-button-ok').click();
  await expect(frame.locator('#settings_preset_openai option').filter({ hasText: '反馈合成预设' })).toHaveCount(0);
  await frame.locator('#openai_preset_import_file').setInputFiles(presetFile);
  await expect(frame.locator('#settings_preset_openai option:checked')).toHaveText('反馈合成预设');
  await page.reload();
  await expect(frame.locator('#settings_preset_openai option').filter({ hasText: '反馈合成预设' })).toHaveCount(1, { timeout: 60000 });
  checks.push('embedded ST actual file import -> delete -> same-name import -> reload');
  await page.goto('http://tauri.localhost/library');
  await page.getByPlaceholder('搜索角色或标签').fill('批量合成');
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await page.getByRole('button', { name: '全选筛选结果', exact: true }).click();
  await expect(page.getByText('已选 20 个', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  const bulkStart = performance.now();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 90000 });
  bulk = { characters: 20, attachmentBytes: 20 * 2097152, elapsedMs: performance.now() - bulkStart };
  const operations = await readdir(path.join(vault, '.ste/retained'));
  let verifiedBodies = 0;
  for (const operation of operations) {
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(vault, '.ste/retained', operation, 'manifest.json'), 'utf8')); } catch { continue; }
    if (!manifest.id.startsWith('bulk-')) continue;
    const number = Number(manifest.id.slice(5)), file = manifest.files.find(f => f.path.endsWith('data.bin'));
    const retained = await readFile(path.join(vault, '.ste/retained', operation, 'files', file.path));
    expect(createHash('sha256').update(retained).digest('hex')).toBe(createHash('sha256').update(Buffer.alloc(2097152, number)).digest('hex'));
    verifiedBodies++;
  }
  expect(verifiedBodies).toBe(20);
  checks.push('20-character batch deletion; all 40MiB moved bytes verified');
  expect(errors).toEqual([]);
  await writeFile(path.join(out, 'result.json'), JSON.stringify({ ...report(), passed: true }, null, 2));
  console.log(JSON.stringify({ out, ...report(), passed: true }));
} catch (error) {
  if (verified) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); }
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ ...report(), error: String(error) }, null, 2));
  console.log(JSON.stringify({ out, checks, failed: String(error) })); process.exitCode = 1;
} finally { if (browser) await browser.close().catch(() => {}); if (app.exitCode === null) app.kill(); }
