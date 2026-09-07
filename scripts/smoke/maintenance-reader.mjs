import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:5187';
const output = path.join(tmpdir(), `ste-maintenance-reader-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', error => errors.push(error.message));
const currentPage = () => page.locator('[data-novel-progress]').textContent().then(text => Number(text.match(/^\d+/)[0]) - 1);
try {
  await page.goto(`${base}/scripts/smoke/maintenance-reader.html`);
  await page.waitForFunction(() => !!window.maintenance);
  assert.deepEqual(await page.evaluate(() => window.maintenance.parse()), { count: 1, title: 'Synthetic Story' });
  await page.evaluate(() => window.maintenance.mount());
  await page.waitForSelector('[data-novel-progress]');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await currentPage(), 4);
  const anchor = await page.locator('[data-novel-page="left"] article p').first().textContent();
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.waitForTimeout(300);
  assert.ok(await currentPage() > 0, 'desktop reflow reset to initial floor');
  assert.ok((await page.locator('[data-novel-spread]').textContent()).includes(anchor.slice(0, 30)), 'desktop reflow lost the visible passage');
  await page.screenshot({ path: path.join(output, 'desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('[data-novel-scroll]');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '书签列表', exact: true }).evaluate(button => button.click());
  const bookmark = page.getByRole('button', { name: /^#2 / });
  await bookmark.click();
  await page.waitForTimeout(350);
  const target = await currentPage();
  assert.ok(target > 3, 'bookmark did not select later content');
  const landing = await page.evaluate(index => {
    const host = document.querySelector('[data-novel-scroll]');
    const target = document.querySelector(`[data-novel-scroll-page="${index}"]`);
    return { scrollTop: host.scrollTop, distance: target ? target.getBoundingClientRect().top - host.getBoundingClientRect().top : null };
  }, target);
  assert.ok(landing.scrollTop > 1000, JSON.stringify(landing));
  assert.ok(landing.distance !== null && Math.abs(landing.distance) < 35, JSON.stringify(landing));
  await bookmark.click();
  await page.waitForTimeout(200);
  assert.equal(await currentPage(), target, 'repeated bookmark changed the target');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(output, 'mobile.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['real reading-pack Worker', 'desktop reflow', 'mobile bookmark scroll', 'repeated bookmark'], output, landing }));
} finally {
  await browser.close();
}
