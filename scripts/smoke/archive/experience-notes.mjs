import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/experience-notes';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], passed = [], geometry = {};
page.on('pageerror', error => errors.push(error.message));
await page.route(/https:\/\//, route => route.abort());
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
const longTitle = '一条不该挤占阅读空间但必须完整保留的长备注标题'.repeat(5);
const chooseNote = title => page.getByRole('navigation', { name: '切换备注', exact: true }).getByRole('button', { name: new RegExp(title) }).click();
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  await page.evaluate(async longTitle => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { setCurrentVaultId } = await import('/src/lib/vault/vault-scope.ts');
    const { setTourCompleted } = await import('/src/lib/tour-steps.ts');
    const first = await performanceFixture(2, 1), vaultA = createVault(first.fs);
    const a = await vaultA.repo('characters').get('perf-c0');
    a.notes = [
      { id: 'older', at: 1, body: `# ${longTitle}\n\n**完整原文**\n\n${'这是一段用于验证实际滚动的回顾正文。\n\n'.repeat(45)}## 重逢\n\n第一处\n\n${'中间段落。\n\n'.repeat(25)}## 重逢\n\n第二处\n\n**最后仍然保留**` },
      { id: 'newer', at: 2, body: '# A 最新短备注\n\n另一篇' },
    ];
    await vaultA.repo('characters').put(a);
    const b = await vaultA.repo('characters').get('perf-c1');
    b.notes = [{ id: 'older', at: 1, body: '# B 较早备注' }, { id: 'newer', at: 2, body: '# B 最新备注' }];
    await vaultA.repo('characters').put(b);
    const second = await performanceFixture(1, 1), vaultB = createVault(second.fs);
    const other = await vaultB.repo('characters').get('perf-c0');
    other.notes = [{ id: 'older', at: 1, body: '# 库二较早备注' }, { id: 'newer', at: 2, body: '# 库二最新备注' }];
    await vaultB.repo('characters').put(other);
    window.experienceNotes = { vaultA, vaultB, fs: first.fs };
    setCurrentVaultId('experience-notes-a'); setActiveVault(vaultA);
    setTourCompleted('home'); setTourCompleted('library');
  }, longTitle);

  // Review is a persisted library view, not a URL query flag.
  await navigate('/library');
  await page.getByRole('button', { name: '回顾', exact: true }).click();
  await page.locator('[data-library-review]').waitFor();
  await page.getByRole('button', { name: '选择性能角色0', exact: true }).click();
  await page.getByRole('tab', { name: '备注', exact: true }).click();
  await expect(page.locator('[data-notes-browser] h1')).toHaveText('A 最新短备注');
  await chooseNote(longTitle);
  const nav = page.getByRole('navigation', { name: '备注目录', exact: true });
  const heading = page.getByRole('heading', { name: longTitle, exact: true });
  await expect(heading).toHaveCSS('text-overflow', 'ellipsis');
  await expect(heading).toHaveAttribute('title', longTitle);
  const sidebar = page.getByRole('complementary', { name: '备注导航', exact: true });
  const sideBox = await sidebar.boundingBox(), contentBox = await heading.boundingBox();
  expect(sideBox.x).toBeGreaterThan(contentBox.x + contentBox.width);
  const lastHeading = page.getByRole('heading', { name: '重逢', exact: true }).last();
  expect((await lastHeading.boundingBox()).y).toBeGreaterThan(1000);
  await page.screenshot({ path: `${output}/review-notes-desktop.png` });
  await nav.getByRole('button', { name: '重逢', exact: true }).last().click();
  await expect.poll(() => page.locator('[data-review-scroll]').evaluate(node => node.scrollTop)).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => {
    const target = document.activeElement, rect = target.getBoundingClientRect();
    return target.textContent === '重逢' && rect.top >= 0 && rect.bottom < innerHeight;
  })).toBe(true);
  await page.screenshot({ path: `${output}/review-notes-jump.png` });
  passed.push('实际角色库回顾入口：右侧切篇和目录、长标题省略、重复标题带动正文滚动');

  await page.getByRole('button', { name: '新建备注', exact: true }).click();
  const editor = page.getByRole('dialog');
  expect((await editor.boundingBox()).width).toBeGreaterThan(850);
  expect((await page.getByLabel('备注正文').boundingBox()).height).toBeGreaterThan(400);
  await page.getByLabel('备注正文').fill('# 回顾新建验收\n\n- **保存完整原文**');
  await editor.getByRole('button', { name: '预览', exact: true }).click();
  await expect(editor.locator('strong')).toHaveText('保存完整原文');
  await page.screenshot({ path: `${output}/review-note-editor.png` });
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.experienceNotes.vaultA.repo('characters').get('perf-c0')).notes.length)).toBe(3);
  await expect(page.locator('[data-notes-browser] h1')).toHaveText('回顾新建验收');
  await chooseNote(longTitle);
  await page.getByRole('button', { name: '选择性能角色1', exact: true }).click();
  await expect(page.locator('[data-notes-browser] h1')).toHaveText('B 最新备注');
  await page.getByRole('button', { name: '选择性能角色0', exact: true }).click();
  await expect(page.locator('[data-notes-browser] h1')).toHaveText(longTitle);
  await navigate('/settings'); await navigate('/library');
  await expect(page.locator('[data-notes-browser] h1')).toHaveText(longTitle);
  await page.evaluate(async () => {
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { setCurrentVaultId } = await import('/src/lib/vault/vault-scope.ts');
    setCurrentVaultId('experience-notes-b'); setActiveVault(window.experienceNotes.vaultB);
  });
  await page.getByRole('tab', { name: '备注', exact: true }).click();
  await expect(page.locator('[data-notes-browser] h1')).toHaveText('库二最新备注');
  await page.evaluate(async () => {
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { setCurrentVaultId } = await import('/src/lib/vault/vault-scope.ts');
    setCurrentVaultId('experience-notes-a'); setActiveVault(window.experienceNotes.vaultA);
  });
  await expect(page.locator('[data-notes-browser] h1')).toHaveText(longTitle);
  passed.push('大备注编辑器预览和真实存储保存；切卡、返回和切库选择隔离');

  await page.setViewportSize({ width: 390, height: 844 });
  await sidebar.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: `${output}/review-notes-mobile.png` });
  await nav.getByRole('button', { name: '重逢', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => {
    const target = document.activeElement, rect = target.getBoundingClientRect();
    return target.textContent === '重逢' && rect.top >= 0 && rect.bottom < innerHeight;
  })).toBe(true);
  passed.push('窄屏回顾备注导航在正文上方，标题可实际跳转且页面不横向溢出');

  await page.setViewportSize({ width: 1440, height: 700 });
  await navigate('/character/perf-c0');
  const rail = page.locator('[data-character-info-rail="rail"]');
  await expect(rail).toHaveAttribute('data-info-collapsed', 'false');
  const scroller = rail.locator('[data-character-info-scroll]');
  const railMetrics = () => rail.evaluate(outer => {
    const node = outer.querySelector('[data-character-info-scroll]');
    return { width: outer.getBoundingClientRect().width, scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollbar: getComputedStyle(node).scrollbarWidth, track: getComputedStyle(node, '::-webkit-scrollbar').display };
  });
  await expect(rail).not.toContainText('收起信息栏');
  const fold = page.getByRole('button', { name: '折叠角色卡图与信息', exact: true });
  const railBox = await rail.boundingBox(), foldBox = await fold.boundingBox();
  expect(railBox.y + railBox.height - foldBox.y - foldBox.height).toBe(8);
  expect(railBox.x + railBox.width - foldBox.x - foldBox.width).toBe(3); // Includes the outer 1px border.
  await page.screenshot({ path: `${output}/info-expanded.png` });
  geometry.expanded = await railMetrics();
  expect(geometry.expanded.scrollHeight).toBeGreaterThan(geometry.expanded.clientHeight);
  expect(geometry.expanded.scrollbar).toBe('none'); expect(geometry.expanded.track).toBe('none');
  await scroller.hover(); await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await scroller.focus(); await page.keyboard.press('Home');
  await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(() => scroller.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(1);
  const actionBox = await rail.getByRole('button', { name: '操作', exact: true }).boundingBox();
  expect(actionBox.y).toBeGreaterThan(0); expect(actionBox.y + actionBox.height).toBeLessThan(700);
  expect(actionBox.x + actionBox.width).toBeLessThan((await fold.boundingBox()).x);
  await rail.getByRole('button', { name: '操作', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '角色卡操作' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '折叠角色卡图与信息', exact: true }).click();
  geometry.collapsed = await railMetrics(); expect(geometry.collapsed.width).toBe(36);
  expect(geometry.collapsed.scrollHeight).toBeLessThanOrEqual(geometry.collapsed.clientHeight);
  await page.screenshot({ path: `${output}/info-collapsed.png` });
  await page.getByRole('button', { name: '展开角色卡图与信息', exact: true }).click();
  for (const [key, label] of [['cocoa', '深咖啡'], ['ink', '墨黑'], ['midnight', '深夜蓝'], ['cream', '米色典雅']]) {
    await page.getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', key);
    const value = await railMetrics(); expect(value.scrollbar).toBe('none'); expect(value.track).toBe('none');
    await page.screenshot({ path: `${output}/info-${key}.png` });
  }
  await page.getByRole('button', { name: '折叠角色卡图与信息', exact: true }).click();
  await navigate('/library'); await navigate('/character/perf-c0');
  await expect(rail).toHaveAttribute('data-info-collapsed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  const stacked = page.locator('[data-character-info-rail="stacked"]');
  await expect(stacked).toHaveAttribute('data-info-collapsed', 'true');
  await page.getByRole('button', { name: '展开角色卡图与信息', exact: true }).click();
  await fold.scrollIntoViewIfNeeded();
  const mobileAction = await stacked.getByRole('button', { name: '操作', exact: true }).boundingBox();
  const mobileFold = await fold.boundingBox();
  expect(mobileAction.y + mobileAction.height).toBeLessThan(mobileFold.y);
  expect(mobileFold.y + mobileFold.height).toBeLessThan(844);
  await page.screenshot({ path: `${output}/info-mobile.png` });
  await stacked.getByRole('button', { name: '操作', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '角色卡操作' })).toBeVisible();
  await page.keyboard.press('Escape');
  await fold.click();
  await expect(stacked).toHaveCSS('height', '40px');
  passed.push('信息栏无顶部按钮横排，右下角箭头不盖操作；折叠36px并恢复，短窗口滚轮/Home/End可达，四主题和390px窄屏实测');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed, geometry }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.txt`, (await page.locator('body').innerText()).slice(0, 24000));
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, geometry, errors }, null, 2));
  await browser.close();
}
