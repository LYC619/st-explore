import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const zoom = process.env.STE_SMOKE_ZOOM === '2';
const output = `.cache/preset-series-workbench${zoom ? '-zoom200' : ''}`;
await mkdir(output, { recursive: true });
let browser, page;
if (zoom) {
  const extension = resolve(`${output}/zoom-extension`);
  await mkdir(extension, { recursive: true });
  await writeFile(`${extension}/manifest.json`, JSON.stringify({ manifest_version: 3, name: 'Isolated STE zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  await writeFile(`${extension}/worker.js`, `chrome.tabs.onUpdated.addListener((id, change, tab) => { if (tab.url?.startsWith(${JSON.stringify(base)}) && change.status === 'complete') chrome.tabs.setZoom(id, 2); });`);
  browser = await chromium.launchPersistentContext(`${output}/profile-${Date.now()}`, { headless: true, channel: 'msedge', viewport: { width: 1440, height: 960 }, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  page = await browser.newPage();
} else {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
}
const passed = [], errors = [], requests = [], layouts = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/https:\/\//, async route => {
  if (!route.request().url().startsWith('https://fixture.invalid/')) return route.abort();
  requests.push(route.request().postDataJSON());
  await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"浏览器试用回复"}}]}\n\ndata: [DONE]\n\n' });
});
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  if (zoom) { await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2); layouts.push(await page.evaluate(() => ({ zoom: 2, dpr: devicePixelRatio, cssWidth: innerWidth, cssZoom: getComputedStyle(document.documentElement).zoom }))); }
  await page.evaluate(async () => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const { DEFAULT_ENTRY } = await import('/src/types/worldbook.ts');
    const { persistProfiles } = await import('/src/components/ai-tools/api-profiles.ts');
    const fixture = await performanceFixture(1, 1), vault = createVault(fixture.fs);
    for (let i = 1; i <= 4; i++) await vault.repo('presets').put({ id: `series-${i}`, title: `原文件-Claude-v${i}.json`, createdAt: i, updatedAt: i,
      catalog: { name: i < 3 ? '星海叙事' : `独立预设${i}`, author: '作者甲', series: i < 3 ? '星海系列' : `独立系列${i}`, version: `v${i}`, models: ['Claude'], tags: ['类型/角色'], releaseNotes: '# 作者说明\n适合长篇叙事，支持角色与世界书。', notes: '我的使用笔记摘要。' },
      preset: parsePreset({ temperature: 0.31, prompts: [{ identifier: 'main', name: '主提示词', content: `版本 ${i} {{char}}` }, { identifier: 'off', name: '禁用块', content: '不应发送' }, ...['charDescription','worldInfoBefore','worldInfoAfter','chatHistory'].map(identifier => ({ identifier, marker: true }))],
        prompt_order: [{ character_id: 100000, order: ['main','off','charDescription','worldInfoBefore','worldInfoAfter','chatHistory'].map(identifier => ({ identifier, enabled: identifier !== 'off' })) }] }),
      packageFiles: [{ id: `note-${i}`, kind: 'notes', name: '说明.md', text: '附件原文' }],
    });
    await vault.repo('worldbooks').put({ id: 'fixture-world', title: '港城世界书', createdAt: 1, updatedAt: 1, worldbook: { entries: { '0': { ...DEFAULT_ENTRY, uid: 0, key: ['港城'], content: '港城世界条目' } } } });
    setActiveVault(vault);
    persistProfiles([{ id: 'a', name: '测试服务甲', apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture-a', model: 'alpha', favoriteModels: ['beta'] },
      { id: 'b', name: '测试服务乙', apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture-b', model: 'gamma' }], 'a');
    window.seriesFixture = { vault, fs: fixture.fs };
  });
  await navigate('/presets');
  const catalog = page.locator('[data-preset-catalog]');
  await expect(catalog.locator('[data-preset-series]')).toHaveCount(3);
  await expect(catalog.getByRole('checkbox')).toHaveCount(0);
  await expect(catalog).toContainText('作者说明 ·'); await expect(catalog).toContainText('笔记 ·');
  for (const [theme, name] of zoom ? [] : [['cocoa','深咖啡'], ['ink','墨黑'], ['midnight','深夜蓝'], ['cream','米色典雅']]) {
    await page.getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click(); await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await catalog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `${output}/library-${theme}.png` }); layouts.push({ theme, width: 1440 });
  }
  await catalog.getByRole('button', { name: '批量管理', exact: true }).click();
  await catalog.getByRole('button', { name: '选择 星海叙事', exact: true }).click();
  await expect(catalog).toContainText('已选 2 份');
  await catalog.getByRole('button', { name: '整理所选', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '统一作者', exact: true }).check();
  await dialog.getByLabel('批量作者').fill('新作者');
  await dialog.getByRole('checkbox', { name: 'Gemini', exact: true }).check();
  await dialog.getByRole('button', { name: '保存到所选预设', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(async () => (await window.seriesFixture.vault.repo('presets').get('series-1')).catalog.author)).toBe('新作者');
  await catalog.getByRole('button', { name: '完成', exact: true }).click();
  passed.push(`${zoom ? '真实200%缩放' : '四主题'}、系列聚合、两类摘要、直接点击整张卡片批量选择和保存`);

  await catalog.getByRole('button', { name: zoom ? '管理标签' : '管理预设标签', exact: true }).click();
  await dialog.getByLabel('新建预设标签分组').fill('自用');
  await dialog.getByRole('button', { name: '添加分组', exact: true }).click();
  await dialog.getByLabel('新建预设标签', { exact: true }).fill('常用');
  await dialog.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(dialog).toContainText('常用');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  expect(await page.evaluate(async () => JSON.parse(await window.seriesFixture.fs.readText('库信息.json')).schemaVersion)).toBe(2);
  passed.push('标签分组新增、标签保存与原库信息共存');

  await catalog.getByLabel('搜索预设').fill('星海');
  await catalog.getByRole('button', { name: 'v1', exact: true }).click();
  await expect(page).toHaveURL(`${base}/presets/series-1`);
  let detail = page.locator('[data-preset-details="series-1"]');
  await expect(detail).toBeVisible();
  await expect(page.getByLabel('预设信息与版本')).toContainText('星海系列');
  await detail.getByRole('button', { name: '整理资料', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('星海第一版');
  const version2 = page.getByRole('button', { name: '切换版本 v2 原文件-Claude-v2.json', exact: true });
  await version2.click(); await expect(page.getByRole('alertdialog')).toHaveCount(1);
  await page.getByRole('button', { name: '返回继续整理', exact: true }).click();
  await expect(page.getByLabel('名称', { exact: true })).toHaveValue('星海第一版');
  await detail.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(detail.getByRole('button', { name: '整理资料', exact: true })).toBeVisible();
  await version2.click(); await expect(page).toHaveURL(`${base}/presets/series-2`);
  detail = page.locator('[data-preset-details="series-2"]');
  await page.screenshot({ path: `${output}/series-detail.png` });
  await detail.getByRole('tab', { name: '试用', exact: true }).click();
  const playground = page.getByRole('region', { name: '预设试用', exact: true });
  await expect(playground).toBeVisible(); expect(requests).toHaveLength(0);
  await playground.getByRole('button', { name: /^切换模型/ }).click();
  await page.getByRole('button', { name: '使用 测试服务乙 的 gamma', exact: true }).click();
  await playground.getByText('挂载角色与世界书', { exact: true }).click();
  await playground.getByLabel('试用角色卡', { exact: true }).selectOption('perf-c0');
  await playground.getByLabel('试用世界书', { exact: true }).selectOption('fixture-world');
  await playground.getByLabel('试用消息', { exact: true }).fill('请介绍港城');
  await playground.getByRole('button', { name: '发送', exact: true }).click();
  await expect(playground.getByRole('log')).toContainText('浏览器试用回复');
  expect(requests).toHaveLength(1); expect(requests[0].model).toBe('gamma');
  const payload = JSON.stringify(requests[0]);
  for (const text of ['版本 2', '保留完整卡片正文', '港城世界条目', '请介绍港城']) expect(payload).toContain(text);
  expect(payload).not.toContain('不应发送');
  expect(await page.evaluate(async () => (await import('/src/components/ai-tools/api-profiles.ts')).getActiveProfile().id)).toBe('a');
  expect(await page.evaluate(async () => (await window.seriesFixture.vault.repo('archiveStories').list()).length)).toBe(1);
  await page.screenshot({ path: `${output}/playground.png` });
  passed.push('真实详情入口、名称与系列分开、未保存换版保护、局部模型切换和角色/世界书实际请求组装');

  // Keep the tab's draft and response while looking back at the author's notes.
  await detail.getByRole('tab', { name: '概览', exact: true }).click();
  await detail.getByRole('tab', { name: '试用', exact: true }).click();
  await expect(playground.getByRole('log')).toContainText('浏览器试用回复');

  for (const width of zoom ? [] : [800, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(playground.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/playground-${width}.png` }); layouts.push({ width, page: 'playground' });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: '返回预设库', exact: true }).click();
  await expect(catalog.getByLabel('搜索预设')).toHaveValue('星海');
  await catalog.getByRole('button', { name: '预览', exact: true }).click();
  await catalog.getByRole('button', { name: 'v1', exact: true }).click();
  await expect(page).toHaveURL(`${base}/presets?presetId=series-1`);
  await expect(page.getByLabel('预设资料', { exact: true })).toBeVisible();
  await catalog.getByRole('button', { name: '打开完整详情', exact: true }).click();
  await expect(page).toHaveURL(`${base}/presets/series-1`);
  await page.locator('[data-preset-details]').getByRole('button', { name: '复制后 DIY', exact: true }).click();
  await expect(page).toHaveURL(/\/preset\?assetId=.*&from=detail/);
  await page.getByRole('button', { name: '返回系列详情', exact: true }).click();
  await expect(page).toHaveURL(/\/presets\/preset_/);
  passed.push(`试用标签往返保留对话、${zoom ? '200%布局' : '窄屏'}、返回搜索恢复、预览和完整详情、DIY编辑返回详情`);
  await page.getByRole('button', { name: '更多预设操作', exact: true }).click();
  await page.getByRole('button', { name: '导入同系列新版', exact: true }).click();
  await page.getByLabel('选择预设和附带文件').setInputFiles({ name: '星海-Claude-v5.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ prompts: [{ identifier: 'main', name: '导入内容', content: '导入新版' }], prompt_order: [] })) });
  await expect(page.getByLabel('系列', { exact: true })).toHaveValue('星海系列');
  await page.getByLabel('名称', { exact: true }).fill('新导入名称');
  await page.getByRole('button', { name: '导入 1 份预设', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.locator('[data-preset-details] h2').filter({ hasText: /^新导入名称$/ })).toBeVisible();
  await page.getByRole('tab', { name: '试用', exact: true }).click();
  await page.getByRole('region', { name: '预设试用' }).getByRole('button', { name: /^切换模型/ }).click();
  await page.getByRole('button', { name: '管理服务', exact: true }).click();
  await expect(page).toHaveURL(`${base}/settings`);
  await expect(page.getByLabel('提供商名称')).toBeVisible();
  passed.push('详情导入新版继承系列且自动进入新版本；管理服务直达AI配置');
  expect(errors).toEqual([]);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, errors, requests: requests.length, layouts }, null, 2));
  console.log(JSON.stringify({ passed, errors, layouts }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, `${error.stack}\n${await page.locator('body').innerText()}`);
  throw error;
} finally { await browser.close(); }
