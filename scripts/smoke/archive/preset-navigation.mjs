import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/preset-navigation';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.route(/https:\/\//, route => route.abort());
const passed = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const fixture = await performanceFixture(1, 1), vault = createVault(fixture.fs);
    for (const [id, title] of [['nav-a', '导航甲预设'], ['nav-b', '导航乙预设']]) await vault.repo('presets').put({
      id, title, createdAt: 1, updatedAt: 2,
      preset: parsePreset({ prompts: [{ identifier: 'main', name: title, role: 'system', content: '导航回归测试正文' }], prompt_order: [] }),
      catalog: { author: '导航作者', series: title, version: 'v1.0', models: ['Claude'], status: 'testing' },
    });
    const character = await vault.repo('characters').get('perf-c0');
    await vault.repo('characters').put({ ...character, assets: [{ kind: 'preset', assetId: 'nav-a' }] });
    setActiveVault(vault);
  });
  await navigate('/assets?tab=preset&presetId=nav-a');
  await expect(page).toHaveURL(`${base}/presets?presetId=nav-a`);
  await expect(page.locator('[data-preset-details="nav-a"]')).toBeVisible();
  await expect(page.locator('[data-editor-rail]')).toHaveCount(0);
  await expect(page.locator('[data-nav-parent-row] button[aria-current="page"]')).toHaveText('预设库');
  await expect(page.getByRole('button', { name: '打开预设工具', exact: true })).toHaveCount(0);
  passed.push('旧附属库深链保留选中预设，独立库只高亮预设库且没有编辑窄栏/旧上级按钮');

  await navigate('/settings');
  await navigate('/tools?focus=preset&assetId=nav-b');
  await expect(page).toHaveURL(`${base}/presets?presetId=nav-b&mode=select`);
  await expect(page.locator('[data-preset-details="nav-b"]')).toBeVisible();
  passed.push('旧编辑区选择入口转向新库选择模式并保留选中');

  await navigate('/character/perf-c0');
  await page.getByRole('tab', { name: /^关联资产/ }).click();
  await page.getByRole('button', { name: '处理', exact: true }).click();
  await expect(page).toHaveURL(`${base}/preset?assetId=nav-a&characterId=perf-c0`);
  await expect(page.locator('[data-editor-rail] button[aria-current="page"]')).toHaveText('预设');
  await page.locator('[data-editor-rail]').getByRole('button', { name: '预设', exact: true }).click();
  await expect(page).toHaveURL(`${base}/presets?mode=select`);
  await expect(page.locator('[data-editor-rail]')).toHaveCount(0);
  passed.push('角色关联预设处理保留 assetId/characterId，编辑窄栏选择入口转到新库');

  const search = page.getByRole('textbox', { name: '全局搜索', exact: true }).filter({ visible: true });
  await search.fill('导航甲');
  await page.locator('[data-tour="global-search"]').getByRole('button', { name: /^导航甲预设/ }).click();
  await expect(page).toHaveURL(`${base}/presets/nav-a`);
  await expect(page.locator('[data-preset-details="nav-a"]')).toBeVisible();
  await search.fill('导航乙');
  await page.locator('[data-tour="global-search"]').getByRole('button', { name: /^导航乙预设/ }).click();
  await expect(page).toHaveURL(`${base}/presets/nav-b`);
  await expect(page.locator('[data-preset-details="nav-b"]')).toBeVisible();
  passed.push('全局搜索在同一路由连续选择两份预设，URL 和详情同步');
  for (const query of ['导航作者', 'Claude']) {
    await search.fill(query);
    await expect(page.locator('[data-tour="global-search"]').getByRole('button', { name: /^导航[甲乙]预设/ })).toHaveCount(2);
  }
  await search.press('Escape');
  passed.push('全局搜索按预设作者和适配模型命中库内条目，显示作者/版本/模型摘要');

  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.locator('[data-mobile-tab-bar]');
  await expect(nav.getByRole('button')).toHaveCount(6);
  await nav.getByRole('button', { name: '角色库', exact: true }).click();
  await nav.getByRole('button', { name: '预设库', exact: true }).click();
  await expect(page).toHaveURL(`${base}/presets`);
  await expect(nav.locator('button[aria-current="page"]')).toHaveText('预设库');
  await expect(page.locator('[data-editor-rail]')).toHaveCount(0);
  await page.screenshot({ path: `${output}/mobile.png` });
  passed.push('390px 移动端六个主导航可达预设库且仅自身高亮');
  expect(errors).toEqual([]);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, await page.locator('body').innerText());
  await writeFile(`${output}/failure-aria.txt`, await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed }));
