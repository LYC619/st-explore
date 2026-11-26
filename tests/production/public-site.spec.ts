import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSite } from '../../scripts/site/build.mjs';

let server: Server;
let base: string;
const folder = path.resolve('.cache/verify/public-site-browser');
test.beforeAll(async () => {
  await buildSite({ out: folder, url: 'https://example.org/project/' });
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/project/')) { res.writeHead(404).end(); return; }
    const relative = url.pathname.slice('/project/'.length) + (url.pathname.endsWith('/') ? 'index.html' : '');
    const file = path.resolve(folder, relative);
    if (!file.startsWith(folder + path.sep)) { res.writeHead(404).end(); return; }
    try {
      const bytes = await readFile(file);
      res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/plain');
      res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Local preview did not start');
  base = `http://127.0.0.1:${address.port}/project/`;
});
test.afterAll(() => {
  server.close();
  server.closeAllConnections();
  server.unref();
});

test.use({ javaScriptEnabled: false });
for (const width of [1280, 390]) test(`public pages work without JavaScript at ${width}px`, async ({ page }) => {
  const failures: string[] = [];
  page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${base}en/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Keep the characters.');
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://example.org/project/en/');
  await page.getByRole('link', { name: '简体中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.getByRole('link', { name: '使用指南', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('从一张卡、一个故事开始');
  await page.getByRole('link', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start with one card and one story');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(failures).toEqual([]);
  await page.goto(`${base}en/`);
  await page.screenshot({ path: `.cache/verify/public-site-${width}.png`, fullPage: true });
});
