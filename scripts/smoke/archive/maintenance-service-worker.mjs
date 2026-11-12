import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:5190';
await context.route('**/maintenance-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic SW Probe</title>' }));
await context.route('**/maintenance-old-sw.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  ` }));
try {
  await page.goto(`${base}/maintenance-probe`);
  await page.evaluate(async () => {
    const oldCache = await caches.open('st-chat-v0.9.0');
    await oldCache.put('/old-synthetic-asset', new Response('old'));
    await navigator.serviceWorker.register('/maintenance-old-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    window.maintenanceRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  });
  await page.waitForFunction(() => !!window.maintenanceRegistration.waiting);
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes('st-chat-v0.9.0')),
    'waiting worker must not activate before user accepts the update');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      registration.waiting.postMessage('SKIP_WAITING');
    });
  });
  await page.waitForFunction(() => window.maintenanceRegistration.active?.state === 'activated');
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['st-chat-v0.9.1']);
  const online = await page.evaluate(async () => (await fetch('/index.html')).text());
  assert.ok(online.includes('<div id="root">'));
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => (await fetch('/index.html')).text()), online);
  console.log(JSON.stringify({ passed: ['old worker remains active until consent', 'old cache removed on activation', 'online HTML and offline fallback match'] }));
} finally {
  await context.close();
  await browser.close();
}
