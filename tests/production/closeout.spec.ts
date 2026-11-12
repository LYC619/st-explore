import { test, expect } from '@playwright/test';

for (const width of [1360, 390]) test(`about page shows the production receipt and survives return at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors: string[] = [], sourceRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/src/')) sourceRequests.push(req.url()); });
  const receipt = await (await request.get('/build-info.json')).json();
  await page.goto('/settings');
  await page.getByRole('button', { name: '关于与引导', exact: true }).click();
  const identity = page.locator('[data-build-identity]');
  await expect(identity).toContainText(receipt.version);
  await expect(identity).toContainText(receipt.commit ?? '提交未知');
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(receipt.builtAt));
  await expect(identity).toContainText(date);
  if(receipt.dirty) await expect(identity).toContainText('含未提交改动');
  else await expect(identity).not.toContainText('含未提交改动');
  const original = await identity.innerText();
  await page.getByRole('button', {name:'显示',exact:true}).click();
  await expect(identity).toHaveCount(0);
  await page.getByRole('button', {name:'关于与引导',exact:true}).click();
  await page.reload();
  await expect(identity).toHaveText(original);
  expect(await identity.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]); expect(sourceRequests).toEqual([]);
  await page.screenshot({path:`.cache/closeout/about-${width}.png`});
});
