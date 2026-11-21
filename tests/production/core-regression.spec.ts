import { test, expect } from '@playwright/test';

test.describe('core web regression paths', () => {
  test.use({ serviceWorkers: 'block' });

  test('navigates primary workspace routes without runtime page errors', async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.name));

    await page.goto('/');
    await expect(page.locator('[data-home-columns]')).toBeVisible();

    for (const [label, pattern] of [
      ['角色库', /\/library$/],
      ['预设库', /\/presets$/],
      ['设置', /\/settings$/],
      ['首页', /\/$/],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page).toHaveURL(pattern);
      await expect(page.locator('[data-app-error]')).toHaveCount(0);
    }

    expect(errors).toEqual([]);
  });

  test('creates a rule-mode sandbox world, steps simulation, and persists across reload', async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.name));

    await page.goto('/worlds');
    await page.getByRole('button', { name: '开辟新世界' }).click();
    await page.getByRole('textbox', { name: '世界名' }).fill('合成回归沙盘');
    await page.getByRole('button', { name: '启程', exact: true }).click();

    await expect(page).toHaveURL(/\/worlds\/.+/);
    const stepButton = page.getByRole('button', { name: '推进一步' });
    await expect(stepButton).toBeVisible();
    await stepButton.click();
    await expect(page.getByText(/第 1 步/).first()).toBeVisible();

    const worldUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(worldUrl);
    await expect(page.getByText(/第 1 步/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('probes Anthropic native endpoint through AI settings without leaking keys or remote error text', async ({ page }) => {
    let seenHeaders: Record<string, string> = {};
    const secret = 'sk-ant-synthetic-e2e-secret';
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'api.anthropic.com') {
        seenHeaders = route.request().headers();
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `leaked ${secret}` } }),
        });
      }
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });

    await page.goto('/settings');
    await page.getByRole('button', { name: 'AI 配置', exact: true }).click();
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.getByRole('textbox', { name: '提供商名称', exact: true }).fill('合成 Anthropic');
    await page.getByRole('textbox', { name: 'API 接口地址', exact: true }).fill('https://api.anthropic.com/v1/messages');
    await page.getByLabel('API Key', { exact: true }).fill(secret);
    await page.locator('#api-model-name').fill('claude-sonnet-4-5');
    await page.getByRole('button', { name: '保存配置', exact: true }).click();
    await page.getByRole('button', { name: '测试连通', exact: true }).click();

    await expect(page.getByText(/密钥无效或没有访问权限/)).toBeVisible();
    await expect(page.getByText(/HTTP 401；已尝试 1 次/)).toBeVisible();
    await expect(page.getByText(`leaked ${secret}`, { exact: false })).toHaveCount(0);
    expect(seenHeaders['x-api-key']).toBe(secret);
    expect(seenHeaders['anthropic-version']).toBe('2023-06-01');
    expect(seenHeaders['authorization']).toBeUndefined();
  });
});
