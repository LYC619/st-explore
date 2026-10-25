import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/global-ui-consistency';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.route(/https:\/\//, route => route.abort());
const errors = [], passed = [], themes = [];
page.on('pageerror', error => errors.push(error.message));
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const fixture = await performanceFixture(1, 2), vault = createVault(fixture.fs);
    for (const kind of ['volume', 'diary']) for (let i = 1; i <= 12; i++) await vault.repo('summaries').put({
      id: `${kind}-${i}`, volumeNumber: i, title: `${kind === 'volume' ? '总结' : '日记'}第 ${i} 卷`, kind,
      bookId: 'perf-s0-0', bookTitle: '性能故事0-0', floorStart: 0, floorEnd: 47,
      content: `## 第 ${i} 卷记录\n\n${'这里记录故事中的关键选择，供正常回顾和批量整理切换验证。'.repeat(18)}`, createdAt: i, updatedAt: i,
    });
    setActiveVault(vault);
  });
  await navigate('/character/perf-c0');
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await page.getByRole('combobox').filter({ hasText: '性能故事' }).click();
  await page.getByRole('option', { name: '性能故事0-0', exact: true }).click();
  const choices = page.getByRole('checkbox', { name: /^选择记录 / });
  await expect(page.getByText('总结第 1 卷', { exact: true })).toBeVisible();
  await expect(choices).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^加入世界书/ })).toHaveCount(0);
  for (const [key, label] of [['cocoa', '深咖啡'], ['ink', '墨黑'], ['midnight', '深夜蓝'], ['cream', '米色典雅']]) {
    await page.getByRole('button', { name: '主题', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', key);
    const style = await page.evaluate(() => {
      const scroll = [...document.querySelectorAll('*')].filter(el => {
        const css = getComputedStyle(el);
        return ['auto', 'scroll'].includes(css.overflowY) && el.clientWidth > 400 && el.scrollHeight > el.clientHeight + 60;
      }).sort((a, b) => b.clientWidth - a.clientWidth)[0];
      if (!scroll) throw new Error('Missing actual scrollable content');
      const css = getComputedStyle(scroll);
      return { scheme: getComputedStyle(document.documentElement).colorScheme, width: css.scrollbarWidth, colors: css.scrollbarColor, thumb: getComputedStyle(scroll, '::-webkit-scrollbar-thumb').backgroundColor };
    });
    expect(style.scheme).toBe(key === 'cream' ? 'light' : 'dark');
    expect(style.width).toBe('thin');
    expect(style.colors).not.toBe('auto');
    expect(style.colors).toContain('rgba(0, 0, 0, 0)');
    expect(style.thumb).not.toBe('rgba(0, 0, 0, 0)');
    themes.push({ theme: key, ...style });
    await page.screenshot({ path: `${output}/records-${key}.png` });
  }
  passed.push('真实总结浏览：无常驻选择圈及空批量动作；四主题原生滚动条和 color-scheme 跟随切换');
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await expect(choices).toHaveCount(12);
  await choices.first().check();
  await expect(page.getByRole('button', { name: '加入世界书（1）', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '全选当前记录', exact: true }).check();
  await expect(page.getByRole('button', { name: '加入世界书（12）', exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/records-batch.png` });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(choices).toHaveCount(0);
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await expect(choices.first()).not.toBeChecked();
  await choices.first().check();
  await page.getByRole('button', { name: '日记', exact: true }).click();
  await expect(choices).toHaveCount(0);
  await page.getByRole('button', { name: '批量管理', exact: true }).click();
  await expect(choices.first()).not.toBeChecked();
  passed.push('真实记录批量管理：进入、单选、全选、完成清空、重新进入与切换日记清空');
  expect(errors).toEqual([]);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  await writeFile(`${output}/failure.txt`, await page.locator('body').innerText());
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, themes, errors }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed, themes }));
