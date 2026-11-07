import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { writeFile } from 'node:fs/promises';
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 4229, strictPort: true } });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], sourceRequests = [], workerRequests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => { if (req.url().includes('/src/')) sourceRequests.push(req.url()); if (/simulation.worker/.test(req.url())) workerRequests.push(req.url()); });
try {
  await page.goto('http://127.0.0.1:4229/play');
  await page.getByRole('button', { name: /原生世界 · 无需模型/ }).click();
  await page.getByRole('button', { name: '开辟新世界', exact: true }).click();
  await page.getByRole('button', { name: '启程', exact: true }).click();
  await expect(page.getByTestId('world-tick')).toContainText('第 0 步');
  await page.getByRole('button', { name: '干预', exact: true }).click();
  await page.getByRole('button', { name: '确认并推进', exact: true }).click();
  await expect(page.getByTestId('world-tick')).toContainText('第 1 步');
  await expect(page.getByLabel('追踪人物摘要')).toContainText('暴雨封渡');
  await page.reload(); await expect(page.getByTestId('world-tick')).toContainText('第 1 步');
  await page.getByRole('button', { name: '推进一步', exact: true }).click(); await expect(page.getByTestId('world-tick')).toContainText('第 2 步');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '推进一步', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]); expect(sourceRequests).toEqual([]); expect(workerRequests.length).toBeGreaterThan(0);
  await writeFile('.cache/play-world-b01/production.json', JSON.stringify({ errors, sourceRequests, workerRequests, result: '生产入口、Worker、干预、保存重开与390px通过' }, null, 2));
  console.log('production: entry, worker, rain, reopen, 390px passed');
} finally { await browser.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
