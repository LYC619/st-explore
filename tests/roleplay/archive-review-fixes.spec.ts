/* eslint-disable @typescript-eslint/no-explicit-any -- Fixtures use real browser repositories and workers. */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort()); });

test('conflict recovery exports the unsaved draft without overwriting the library', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts'); const wb = await import('/src/lib/worldbook-db.ts');
    const { DEFAULT_ENTRY } = await import('/src/types/worldbook.ts');
    (await import('/src/lib/tour-steps.ts')).setTourCompleted('worldbook');
    const card = db.buildCharacterFromCard({ name: '草稿恢复回归' }); card.id = 'review-character';
    card.assets = [{ kind: 'worldbook', assetId: 'review-book', relations: ['embedded'] }]; await db.saveCharacter(card);
    await wb.saveWorldBook({ id: 'review-book', title: '冲突恢复', createdAt: 1, updatedAt: 1,
      worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, comment: '卷总结', content: '原内容 A' } } } });
  });
  await page.goto('/worldbook?assetId=review-book&characterId=review-character');
  await page.locator('[data-entry-key="7"]').click();
  await page.locator('textarea').first().fill('当前未保存草稿 C');
  await page.evaluate(async () => {
    const db = await import('/src/lib/worldbook-db.ts'); const book = await db.getWorldBook('review-book');
    book.worldbook.entries['7'].content = '其他位置保存 B'; await db.saveWorldBook(book);
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: '保存失败' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出未保存草稿', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain('未保存草稿');
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toContain('当前未保存草稿 C');
  const saved = await page.evaluate(async () => (await (await import('/src/lib/worldbook-db.ts')).getWorldBook('review-book')).worldbook.entries['7'].content);
  expect(saved).toBe('其他位置保存 B');
  await expect(page.locator('textarea').first()).toHaveValue('当前未保存草稿 C');
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: '保存失败' })).toBeVisible();
});

for (const pattern of ['^([^:\\r\\n]+): (.+)$', '^([^:\\r\\n]+)(?=: (.+)$)']) {
test(`advanced endpoints discard obsolete manual URLs with ${pattern}`, async ({ page }) => {
  const png = await readFile(new URL('../../src/test/fixtures/portrait-red.png', import.meta.url));
  const endpoint = 'http://127.0.0.1:4178/fixture/review-image';
  await page.route('**/fixture/review-image?*', route => route.fulfill({ contentType: 'image/png', body: png }));
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts'); const card = db.buildCharacterFromCard({ name: '高级立绘修复回归' });
    await db.saveCharacter(card); return card.id;
  });
  await page.goto(`/character/${id}`);
  await page.getByRole('tab', { name: /^立绘(?:\s+\d+)?$/ }).click();
  await page.getByRole('button', { name: '从图床导入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('高级设置', { exact: true }).click();
  await dialog.getByLabel('解析模式', { exact: true }).selectOption('advanced');
  await dialog.getByLabel('提取正则', { exact: true }).fill(pattern);
  await dialog.getByLabel('图片链接模板', { exact: true }).fill(`${endpoint}?id=$2`);
  await dialog.getByLabel('名称或世界书片段').fill('\nAlice: first');
  const url = dialog.getByLabel('第 2 行链接或文件码', { exact: true });
  await expect(url).toHaveValue(`${endpoint}?id=first`);
  await url.fill(`${endpoint}?id=manual`); await url.press('Tab');
  await expect(dialog.getByLabel('选择第 2 行', { exact: true })).toBeChecked();
  await dialog.getByLabel('名称或世界书片段').fill('\nAlice: second');
  await expect(url).toHaveValue(`${endpoint}?id=second`);
  await expect.poll(() => dialog.getByAltText('Alice', { exact: true }).evaluate((img: any) => img.naturalWidth)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: '导入所选（1）', exact: true }).click();
  await expect.poll(async () => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getCharacter(id)).portraitRows?.flatMap((row: any) => row.items).length, id)).toBe(1);
  const source = await page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getCharacter(id)).portraitRows.flatMap((row: any) => row.items)[0].importSource.url, id);
  expect(source).toBe(`${endpoint}?id=second`);
  await page.reload();
  await page.getByRole('tab', { name: /^立绘(?:\s+\d+)?$/ }).click();
  await page.getByRole('button', { name: '从图床导入', exact: true }).click();
  await dialog.getByLabel('名称或世界书片段').fill('\nAlice: second');
  await expect(dialog.getByLabel('第 2 行链接或文件码', { exact: true })).toHaveValue(`${endpoint}?id=second`);
  await expect(dialog.getByLabel('选择第 2 行', { exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '导入所选（0）', exact: true })).toBeDisabled();
});
}

test('plain worldbook tool entry preserves newer library content when resuming an old session', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const db = await import('/src/lib/worldbook-db.ts');
    const { DEFAULT_ENTRY } = await import('/src/types/worldbook.ts');
    (await import('/src/lib/tour-steps.ts')).setTourCompleted('worldbook');
    const worldbook = { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, comment: '旧条目', content: '旧正文 A' } } };
    sessionStorage.setItem('wb-active-session', JSON.stringify({ worldbook, filename: '旧会话', currentItemId: 'session-book' }));
    await db.saveWorldBook({ id: 'session-book', title: '旧会话', createdAt: 1, updatedAt: 2,
      worldbook: { entries: { ...worldbook.entries, '8': { ...DEFAULT_ENTRY, uid: 8, content: '外部新条目 B' } } } });
  });
  await page.goto('/worldbook');
  await page.locator('[data-entry-key="7"]').click();
  await page.locator('textarea').first().fill('旧会话继续编辑 C');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: '保存失败' })).toBeVisible();
  expect(await page.evaluate(async () => (await (await import('/src/lib/worldbook-db.ts')).getWorldBook('session-book')).worldbook.entries['8'].content)).toBe('外部新条目 B');
  await expect(page.locator('textarea').first()).toHaveValue('旧会话继续编辑 C');
});
