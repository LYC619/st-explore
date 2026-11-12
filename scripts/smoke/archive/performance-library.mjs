import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/performance-library';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route(/https:\/\//, route => route.abort());
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
const readAllVisiblePortraits = async cards => {
  for (let index = 0; index < await cards.count(); index++) {
    const card = cards.nth(index);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('img').first()).toBeVisible();
    await expect.poll(() => card.locator('img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  }
};
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  const startup = await page.evaluate(async () => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const fixture = await performanceFixture();
    const vault = createVault(fixture.fs);
    await vault.repo('archiveMeta').get('archive-schema');
    const schemaStoryReads = fixture.calls.text.filter(path => path.endsWith('/故事.json')).length;
    await vault.repo('archiveStories').listLight();
    const scanStoryReads = fixture.calls.text.filter(path => path.endsWith('/故事.json')).length;
    fixture.reset();
    window.performanceFixture = fixture;
    setActiveVault(vault);
    return { schemaStoryReads, scanStoryReads };
  });
  expect(startup).toEqual({ schemaStoryReads: 0, scanStoryReads: 96 });
  results.push({ scene: 'startup', ...startup });
  await navigate('/');
  await expect(page.locator('[data-home-character-card]')).toHaveCount(12);
  await readAllVisiblePortraits(page.locator('[data-home-character-card]'));
  const home = await page.evaluate(() => ({ binary: [...window.performanceFixture.calls.binary], storyReads: window.performanceFixture.calls.text.filter(path => path.endsWith('/故事.json')).length }));
  results.push({ scene: 'home', ...home });
  expect(home.binary.length, 'after scrolling the entire rail only its twelve cards were fetched').toBe(12);
  expect(home.storyReads).toBe(0);
  await page.evaluate(() => window.performanceFixture.reset());
  await navigate('/library');
  await expect(page.locator('[data-character-id]')).toHaveCount(24);
  await readAllVisiblePortraits(page.locator('[data-character-id]'));
  const library = await page.evaluate(() => ({ binary: [...window.performanceFixture.calls.binary] }));
  results.push({ scene: 'library', ...library });
  expect(library.binary.length).toBeLessThanOrEqual(24);
  const firstPageIds = await page.locator('[data-character-id]').evaluateAll(cards => cards.map(card => card.dataset.characterId));
  expect(library.binary.every(path => firstPageIds.includes(`perf-c${/性能角色(\d+)/.exec(path)[1]}`))).toBe(true);
  await page.evaluate(() => window.performanceFixture.reset());
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('[data-character-id="perf-c0"]')).toHaveCount(1);
  await readAllVisiblePortraits(page.locator('[data-character-id]'));
  const nextPage = await page.evaluate(() => ({ binary: [...window.performanceFixture.calls.binary] }));
  expect(nextPage.binary).toHaveLength(24);
  results.push({ scene: 'library-next-page', ...nextPage });
  await page.evaluate(() => window.performanceFixture.reset());
  await navigate('/character/perf-c0');
  await expect(page.getByTitle('性能故事0-0', { exact: true }).first()).toBeVisible();
  const detail = await page.evaluate(() => ({ stories: window.performanceFixture.calls.text.filter(path => path.endsWith('/故事.json')) }));
  results.push({ scene: 'character', ...detail });
  expect(detail.stories.every(path => path.startsWith('角色/性能角色0/'))).toBe(true);
  expect(detail.stories).toHaveLength(2);
  await page.evaluate(() => window.performanceFixture.reset());
  await navigate('/tools?focus=summary');
  await page.getByRole('searchbox', { name: '搜索故事或角色' }).fill('性能故事0-0');
  await expect(page.getByRole('button', { name: /性能故事0-0/ }).first()).toBeVisible();
  const selector = await page.evaluate(() => ({ storyReads: window.performanceFixture.calls.text.filter(path => path.endsWith('/故事.json')).length }));
  expect(selector.storyReads).toBe(0);
  results.push({ scene: 'summary-picker', ...selector });
  await expect(page.locator('main > div')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `${output}/summary-picker.png`, fullPage: true });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, results }));
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
