/* eslint-disable @typescript-eslint/no-explicit-any -- Real workers, images and repositories. */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:4178/fixture/portraits/';
const red = await readFile(new URL('../../src/test/fixtures/portrait-red.png', import.meta.url));
const blue = await readFile(new URL('../../src/test/fixtures/portrait-blue.png', import.meta.url));
const green = await readFile(new URL('../../src/test/fixtures/portrait-green.png', import.meta.url));
const avif = await readFile(new URL('../../src/test/fixtures/portrait-tiny.avif', import.meta.url));

test.beforeEach(async ({ page }) => { await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort()); });
async function seed(page: Page) {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts'); const card = db.buildCharacterFromCard({ name: '立绘自动导入回归' });
    card.portraitRows = [{ id: 'andrea', title: 'Andrea', items: [] }, { id: 'joey', title: '乔伊', items: [] }];
    await db.saveCharacter(card); return card.id;
  });
  await page.goto(`/character/${id}`); await page.getByRole('tab', { name: /^立绘(?:\s+\d+)?$/ }).click();
  await page.getByRole('button', { name: '从图床导入', exact: true }).click(); return id;
}
async function current(page: Page, id: string) { return page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getCharacter(id)).portraitRows, id) as Promise<any[]>; }

test('explicit reimport fetches new bytes instead of reusing the visible preview', async ({ page }) => {
  let changed = false, requests = 0;
  await page.route('**/fixture/portraits/mutable.png', async route => {
    requests++;
    await route.fulfill({ contentType: 'image/png', body: changed ? blue : red });
  });
  const id = await seed(page), dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称或世界书片段').fill(`${base}mutable.png`);
  await expect.poll(() => dialog.locator('img').evaluateAll(images => images.some((img: any) => img.complete && img.naturalWidth > 0))).toBe(true);
  await dialog.getByRole('button', { name: '导入所选（1）', exact: true }).click();
  await expect.poll(async () => (await current(page, id)).flatMap(row => row.items).length).toBe(1);
  expect(requests).toBe(1);
  changed = true;
  await dialog.getByLabel('重新导入此链接（允许内容已更新）', { exact: true }).check();
  await dialog.getByRole('button', { name: '导入所选（1）', exact: true }).click();
  await expect.poll(async () => (await current(page, id)).flatMap(row => row.items).length).toBe(2);
  const items = (await current(page, id)).flatMap(row => row.items);
  expect(items[1].dataBase64).toBe(blue.toString('base64'));
  expect(items[1].importSource.sha256).not.toBe(items[0].importSource.sha256);
  expect(requests).toBe(2);
});

test('automatic preview edits names independently, imports valid rows to mixed destinations and persistently skips repeats', async ({ page }) => {
  const requests: Record<string, number> = {};
  await page.route('**/fixture/portraits/*', async route => {
    const path = new URL(route.request().url()).pathname; requests[path] = (requests[path] ?? 0) + 1;
    await route.fulfill({ contentType: 'image/png', body: path.endsWith('a.png') ? red : blue });
  });
  const id = await seed(page), dialog = page.getByRole('dialog'), source = `${base}a.png\n乔伊害羞: ${base}b.png\n坏行`;
  await dialog.getByLabel('名称或世界书片段').fill(source);
  await expect(dialog.getByLabel('第 1 行名称', { exact: true })).toHaveValue('a');
  await dialog.getByLabel('第 1 行名称', { exact: true }).fill('Andrea_修改名字');
  await expect(dialog.getByLabel('第 1 行链接或文件码', { exact: true })).toHaveValue(`${base}a.png`);
  await dialog.getByLabel('保存到分行', { exact: true }).selectOption('andrea');
  await dialog.getByLabel('第 2 行目标分行', { exact: true }).selectOption('joey');
  await expect.poll(() => dialog.locator('img').evaluateAll(images => images.filter((img: any) => img.complete && img.naturalWidth > 0).length)).toBe(2);
  await dialog.getByRole('button', { name: '导入所选（2）', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await page.goto('/library');
  await expect.poll(async () => (await current(page, id)).flatMap(row => row.items).length).toBe(2);
  const rows = await current(page, id);
  expect(rows.find(row => row.id === 'andrea').items[0].name).toContain('修改名字');
  expect(rows.find(row => row.id === 'joey').items[0].importSource.url).toBe(`${base}b.png`);
  expect(requests['/fixture/portraits/a.png']).toBe(1); expect(requests['/fixture/portraits/b.png']).toBe(1);
  await page.goto(`/character/${id}`); await page.getByRole('tab', { name: /^立绘(?:\s+\d+)?$/ }).click(); await page.getByRole('button', { name: '从图床导入', exact: true }).click();
  await dialog.getByLabel('名称或世界书片段').fill(source);
  await expect(dialog.getByLabel('选择第 1 行', { exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '导入所选（0）', exact: true })).toBeDisabled();
  await page.screenshot({ path: '.cache/archive-maintenance-20261018/c-duplicate-preview.png' });
});

test('repairs one bad row, preserves AVIF bytes and retries a failed image without fetching saved items again', async ({ page }) => {
  let fail = true; const requests: Record<string, number> = {};
  await page.route('**/fixture/portraits/*', async route => {
    const path = new URL(route.request().url()).pathname; requests[path] = (requests[path] ?? 0) + 1;
    if (path.endsWith('retry.png') && fail) { await route.fulfill({ status: 404, body: 'not found' }); return; }
    await route.fulfill({ contentType: path.endsWith('.avif') ? 'image/avif' : 'image/png', body: path.endsWith('.avif') ? avif : green });
  });
  const id = await seed(page), dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称或世界书片段').fill(`坏行\n失败图: ${base}retry.png`);
  await dialog.getByLabel('第 1 行名称', { exact: true }).fill('乔伊_AVIF');
  await dialog.getByLabel('第 1 行链接或文件码', { exact: true }).fill(`${base}face.avif`);
  await dialog.getByLabel('第 1 行链接或文件码', { exact: true }).press('Tab');
  await expect(dialog.getByRole('button', { name: '导入所选（2）', exact: true })).toBeEnabled();
  await expect.poll(() => dialog.getByAltText('乔伊_AVIF', { exact: true }).evaluate((img: any) => img.naturalWidth)).toBe(2);
  await dialog.getByRole('button', { name: '导入所选（2）', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const status = page.getByRole('complementary', { name: '立绘下载任务' });
  await expect(status).toContainText('部分图片未保存');
  expect((await current(page, id)).flatMap(row => row.items)[0].mime).toBe('image/avif');
  const avifRequests = requests['/fixture/portraits/face.avif']; fail = false;
  await status.getByText(/查看 1 项未保存记录/).click(); await status.getByRole('button', { name: '重试此项', exact: true }).click();
  await expect.poll(async () => (await current(page, id)).flatMap(row => row.items).length).toBe(2);
  expect(requests['/fixture/portraits/face.avif']).toBe(avifRequests);
});

test('learns a literal example rule, previews other names and remembers only successful settings', async ({ page }) => {
  await page.route('**/fixture/portraits/*', route => route.fulfill({ contentType: 'image/png', body: route.request().url().includes('abcd') ? red : blue }));
  const id = await seed(page), dialog = page.getByRole('dialog');
  const first = '姓名【乔伊】 文件【abcd.png】', second = '姓名【Andrea_happy】 文件【efgh.png】';
  await dialog.getByLabel('名称或世界书片段').fill(`${first}\n${second}`);
  await dialog.getByText('高级设置', { exact: true }).click(); await dialog.getByLabel('图床地址', { exact: true }).fill(base);
  await dialog.getByText('用一行示例帮助识别', { exact: true }).click();
  const sample = dialog.getByLabel('示例原行', { exact: true });
  await sample.evaluate((input: HTMLTextAreaElement) => input.setSelectionRange(3, 5));
  await dialog.getByRole('button', { name: '将选区设为名称', exact: true }).click();
  await sample.evaluate((input: HTMLTextAreaElement) => { const start = input.value.indexOf('abcd'); input.setSelectionRange(start, start + 8); });
  await dialog.getByRole('button', { name: '将选区设为文件或链接', exact: true }).click();
  await dialog.getByRole('button', { name: '检查候选规则', exact: true }).click();
  await expect(dialog.getByText('候选结果：2 行成功，0 行需修正', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '使用此规则', exact: true }).click();
  await expect(dialog.getByLabel('第 2 行名称', { exact: true })).toHaveValue('Andrea_happy');
  await dialog.getByRole('button', { name: '导入所选（2）', exact: true }).click();
  await expect.poll(async () => (await current(page, id)).flatMap(row => row.items).length).toBe(2);
  const remembered = await page.evaluate(() => localStorage.getItem('ste.portrait-import.preferences'));
  expect(remembered).toContain('"rule"'); expect(remembered).not.toContain('乔伊'); expect(remembered).not.toContain('abcd.png');
  await page.reload(); await page.getByRole('tab', { name: /^立绘(?:\s+\d+)?$/ }).click(); await page.getByRole('button', { name: '从图床导入', exact: true }).click();
  await dialog.getByLabel('名称或世界书片段').fill(second);
  await expect(dialog.getByLabel('第 1 行名称', { exact: true })).toHaveValue('Andrea_happy');
});

test('keeps advanced templates compatible, times out pathological regex and replaces stale parsing', async ({ page }) => {
  await page.route('**/fixture/portraits/*', route => route.fulfill({ contentType: 'image/png', body: red }));
  await seed(page); const dialog = page.getByRole('dialog');
  await dialog.getByText('高级设置', { exact: true }).click();
  await dialog.getByLabel('解析模式', { exact: true }).selectOption('advanced');
  await dialog.getByLabel('图片链接模板', { exact: true }).fill(`${base}$2.png`);
  await dialog.getByLabel('提取正则', { exact: true }).fill('^([^|]+)\\|([^|]+)$');
  await dialog.getByLabel('名称或世界书片段').fill('乔伊|abcd');
  await expect(dialog.getByLabel('第 1 行名称', { exact: true })).toHaveValue('乔伊');
  await expect(dialog.getByLabel('第 1 行链接或文件码', { exact: true })).toHaveValue(`${base}abcd.png`);
  await dialog.getByLabel('提取正则', { exact: true }).fill('(a+)+$');
  await dialog.getByLabel('名称或世界书片段').fill('a'.repeat(5000) + '!');
  await expect(dialog.getByRole('alert').filter({ hasText: '解析超过 1.5 秒' })).toBeVisible();
  await dialog.getByLabel('解析模式', { exact: true }).selectOption('auto');
  await dialog.getByLabel('名称或世界书片段').fill(`Andrea: ${base}old.png`);
  await dialog.getByLabel('名称或世界书片段').fill(`乔伊: ${base}new.png`);
  await expect(dialog.getByLabel('第 1 行名称', { exact: true })).toHaveValue('乔伊');
  await expect(dialog.getByLabel('第 1 行链接或文件码', { exact: true })).toHaveValue(`${base}new.png`);
});

test('stops delayed downloads after leaving the dialog and never saves cancelled bytes', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let requested = 0;
  await page.route('**/fixture/portraits/*', async route => { requested++; await gate; await route.fulfill({ contentType: 'image/png', body: blue }).catch(() => {}); });
  const id = await seed(page); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称或世界书片段').fill(`延迟图: ${base}delayed.png`);
  await dialog.getByRole('button', { name: '导入所选（1）', exact: true }).click();
  await expect.poll(() => requested).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const status = page.getByRole('complementary', { name: '立绘下载任务' });
  await status.getByRole('button', { name: '停止下载', exact: true }).click(); release();
  await expect(status).toContainText('已停止');
  expect((await current(page, id)).flatMap(row => row.items)).toHaveLength(0);
});
