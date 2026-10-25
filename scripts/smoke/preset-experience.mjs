import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
// This optional fixture is collected locally. Community presets are never committed or uploaded.
const samples = JSON.parse(await readFile(process.env.STE_PRESET_SAMPLES ?? '.local/verification/2026-10-26-experience/preset-samples.json', 'utf8'));
const output = '.cache/preset-experience';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const errors = [], passed = [], layouts = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/https:\/\//, route => route.abort());
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  await page.evaluate(async samples => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const { setTourCompleted } = await import('/src/lib/tour-steps.ts');
    const fixture = await performanceFixture(1, 1), vault = createVault(fixture.fs);
    for (const [index, sample] of samples.entries()) await vault.repo('presets').put({ id: `real-${index}`, title: sample.title, preset: parsePreset(sample.raw), createdAt: 1000 + index, updatedAt: 1000 + index });
    window.experience = { vault, fs: fixture.fs };
    setActiveVault(vault); setTourCompleted('home'); setTourCompleted('preset');
  }, samples);
  await navigate('/presets');
  const catalog = page.locator('[data-preset-catalog]');
  await expect(catalog.locator('[data-preset-series]').first()).toBeVisible();
  await expect(catalog.getByRole('checkbox')).toHaveCount(0);
  await expect(catalog.getByRole('combobox')).toHaveCount(1);
  expect(await catalog.innerText()).not.toContain('未分类作者');
  expect(await catalog.innerText()).not.toContain('未标模型');
  for (const [key, label] of [['cocoa','深咖啡'],['ink','墨黑'],['midnight','深夜蓝'],['cream','米色典雅']]) {
    await page.getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await catalog.getByRole('heading', { name: '预设库', exact: true }).click();
    const geometry = await catalog.evaluate(el => ({ width: el.clientWidth, overflow: el.scrollWidth > el.clientWidth + 1, cards: el.querySelectorAll('[data-preset-series]').length }));
    expect(geometry.overflow).toBe(false); layouts.push({ theme: key, ...geometry });
    await page.screenshot({ path: `${output}/library-${key}.png` });
  }
  passed.push(`${samples.length} 份真实旧预设的隔离展示：自动名称/模型/版本、版本聚合、无常驻选择圈、四主题布局`);
  await catalog.getByRole('button', { name: 'Gemini', exact: true }).click();
  expect(await catalog.locator('[data-preset-series]').count()).toBeLessThan(layouts[0].cards);
  await catalog.getByRole('button', { name: '全部模型', exact: true }).click();
  await catalog.getByRole('button', { name: '批量管理', exact: true }).click();
  await expect(catalog.getByRole('checkbox', { name: /^选择 / })).toHaveCount(samples.length);
  await catalog.getByRole('checkbox', { name: /^选择 / }).first().check();
  await expect(catalog.getByRole('button', { name: '整理所选', exact: true })).toBeEnabled();
  await catalog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(catalog.getByRole('checkbox')).toHaveCount(0);
  const itemTitle = samples[0].title;
  await catalog.getByRole('button', { name: `查看预设 ${itemTitle}`, exact: true }).click();
  const detail = page.locator('[data-preset-details]');
  await expect(detail).toBeVisible(); await expect(detail.locator('input,textarea')).toHaveCount(0);
  await page.screenshot({ path: `${output}/detail-read.png` });
  await detail.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByLabel('作者', { exact: true }).fill('演示整理作者');
  await page.getByLabel('我的使用笔记').fill('便于自用的版本，保留原始内容。');
  await detail.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(detail.getByRole('button', { name: '整理资料', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await window.experience.vault.repo('presets').get('real-0')).catalog.notes)).toContain('便于自用');
  const download = page.waitForEvent('download');
  await detail.getByRole('button', { name: '导出取用包', exact: true }).click();
  const zip = unzipSync(await readFile(await (await download).path()));
  expect(Object.values(zip).some(bytes => strFromU8(bytes).includes('World_Builder'))).toBe(true);
  await detail.getByRole('button', { name: '复制后 DIY', exact: true }).click();
  await expect(page.getByRole('tab', { name: '提示词', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('assetId')).not.toBe('real-0');
  await page.getByRole('button', { name: '返回预设库', exact: true }).click();
  passed.push('实际旧预设：模型筛选、批量模式、阅读详情、整理保存、ZIP 取用和独立 DIY');

  await page.getByRole('button', { name: '导入预设', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('input:not([type="file"]),textarea')).toHaveCount(0);
  await page.getByLabel('选择预设和附带文件').setInputFiles([
    { name: '[Claude]社区示例_v2.1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(samples[0].raw)) },
    { name: '说明.md', mimeType: 'text/markdown', buffer: Buffer.from('# 作者安装说明\n\n|步骤|操作|\n|---|---|\n|1|导入预设|') },
  ]);
  await expect(page.getByLabel('版本号', { exact: true })).toHaveValue('v2.1');
  await expect(page.getByLabel('适配模型', { exact: true })).toHaveValue('Claude');
  expect(await page.getByLabel('作者发布说明').inputValue()).toContain('作者安装说明');
  await page.screenshot({ path: `${output}/import-confirm.png` });
  await dialog.getByRole('button', { name: '导入 1 份预设', exact: true }).click();
  await expect(detail.getByRole('heading', { name: '社区示例', exact: true })).toBeVisible();
  await expect(detail.locator('table')).toBeVisible();
  passed.push('导入先选文件；文件名版本/模型及说明自动填入，确认入库后说明表格可读');
  for (const width of [1024, 720, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await expect(detail).toBeVisible();
    await page.screenshot({ path: `${output}/detail-${width}.png` });
  }
  await catalog.getByRole('button', { name: '关闭预设资料', exact: true }).click();
  await expect(catalog.locator('[data-preset-series]').first()).toBeVisible();
  passed.push('1024 / 720 / 390 视口下详情与返回列表可达，无全页横向溢出');
  expect(errors).toEqual([]);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.txt`, (await page.locator('body').innerText()).slice(0, 16000));
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, layouts, samples: samples.length, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed, samples: samples.length, layouts }));
