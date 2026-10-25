import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:5187';
async function content(kind) {
  if (kind === 'worldbook') {
    await page.locator('[data-entry-key="1"]').click();
    return page.locator('textarea').first();
  }
  if (kind === 'preset') {
    await page.getByRole('tab', { name: '\u63d0\u793a\u8bcd', exact: true }).click();
    if (!await page.locator('textarea[placeholder="\u63d0\u793a\u8bcd\u5185\u5bb9"]').count())
      await page.getByRole('button', { name: '\u5c55\u5f00', exact: true }).first().click();
    return page.locator('textarea[placeholder="\u63d0\u793a\u8bcd\u5185\u5bb9"]');
  }
  if (!await page.locator('textarea[placeholder="/pattern/flags \u6216\u7eaf pattern"]').count())
    await page.getByRole('button', { name: '\u5c55\u5f00\u7f16\u8f91', exact: true }).first().click();
  return page.locator('textarea[placeholder="/pattern/flags \u6216\u7eaf pattern"]');
}
try {
  await page.goto(`${base}/src/test/browser/maintenance-reader.html`);
  await page.waitForFunction(() => !!window.maintenance);
  for (const kind of ['worldbook', 'preset', 'regex']) {
    await page.evaluate(kind => window.maintenance.mountEditor(kind), kind);
    await page.waitForTimeout(250);
    let editor = await content(kind);
    assert.equal(await editor.inputValue(), kind === 'regex' ? 'A' : 'Content A');
    await editor.fill('Draft A');
    await page.evaluate(() => window.maintenance.navigate('?assetId=B&view=list'));
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('alertdialog').getByRole('button', { name: '\u53d6\u6d88', exact: true }).click();
    await page.waitForFunction(() => new URLSearchParams(window.maintenance.location).get('assetId') === 'A');
    assert.equal(await (await content(kind)).inputValue(), 'Draft A');
    await page.evaluate(() => window.maintenance.navigate('?assetId=A&view=grid'));
    assert.equal(await (await content(kind)).inputValue(), 'Draft A');
    await page.getByRole('button', { name: kind === 'regex' ? '\u5b58\u5165\u8d44\u4ea7\u5e93' : '\u4fdd\u5b58', exact: true }).click();
    await page.waitForTimeout(150);
    await page.evaluate(() => window.maintenance.navigate('?assetId=B&view=list'));
    await page.waitForTimeout(200);
    editor = await content(kind);
    assert.equal(await editor.inputValue(), kind === 'regex' ? 'B' : 'Content B');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['WorldBook A/B and dirty cancel', 'Preset A/B and dirty cancel', 'Regex A/B and dirty cancel', 'ordinary query retains draft'] }));
} finally {
  await browser.close();
}
