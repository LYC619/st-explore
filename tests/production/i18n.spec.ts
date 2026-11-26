import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.use({ serviceWorkers: 'block', locale: 'en-US' });
test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

test('English first visit, Chinese choice, reload, and navigation work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.en.json');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Display', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Language / 语言' });
  await picker.click();
  await page.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI 配置', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json');
  await picker.click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  for (const [label, route] of [['Characters', '/library'], ['Presets', '/presets'], ['Settings', '/settings'], ['Home', '/']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.locator('[data-app-error]')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('changing language in another window preserves an unsaved provider draft', async ({ page, context }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'AI settings', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Provider name', exact: true }).fill('合成草稿 {{char}} &amp;');
  const settings = await context.newPage();
  await settings.goto('/settings');
  // The saved section can be shared, so use its navigation explicitly.
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Display', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Language / 语言' }).click();
  await settings.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('textbox', { name: '提供商名称', exact: true })).toHaveValue('合成草稿 {{char}} &amp;');
  await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
});

test('a synthetic imported card survives a language change and JSON export unchanged', async ({ page, context }) => {
  const data = { name: '合成旅人 {{char}}', description: '合成人设 {{user}} <tag> &amp;', personality: 'Invented', scenario: 'Synthetic stage', first_mes: '虚构开场 {{char}}', mes_example: '', creator_notes: '', tags: ['类型/人物'], creator: 'Synthetic', character_version: '1', alternate_greetings: ['合成备选'], extensions: {} };
  await page.goto('/card-viewer');
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-card.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data })) });
  await expect(page.getByRole('textbox', { name: 'Character name', exact: true })).toHaveValue(data.name);
  const settings = await context.newPage();
  await settings.goto('/settings');
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Display', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Language / 语言' }).click();
  await settings.getByRole('option', { name: '简体中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('textbox', { name: '人设与外观', exact: true })).toHaveValue(data.description);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
  const download = await pending;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  for (const key of ['name', 'description', 'first_mes', 'tags', 'alternate_greetings'] as const) expect(exported.data[key]).toEqual(data[key]);
});

test('language selection fits a narrow screen and supports keyboard use', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Display', exact: true }).click();
  const picker = page.getByRole('combobox', { name: 'Language / 语言' });
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'English', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: '简体中文', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await picker.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.cache/verify/i18n-mobile.png' });
});

test.describe('deep-link language persistence on a zh-CN browser', () => {
  test.use({ locale: 'zh-CN' });
  test('entering via /?lang=en persists English across route changes and page reloads', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('button', { name: 'Characters', exact: true }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Characters', exact: true })).toBeVisible();
  });
});


