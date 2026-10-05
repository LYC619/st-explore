import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4187';
const out = '.cache/playtest-polish-smoke';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// The acceptance fixture must not depend on Google's font service being reachable.
await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base + '/library');
  await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    await db.setArchiveSchemaVersion(2);
    const character = { id: 'polish-char', name: '归档测试', card: { spec: 'chara_card_v3', data: { name: '归档测试', first_mes: '开始', extensions: { keep: '保留字段' } } },
      pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      tags: [], status: '未开始', createdAt: 1, updatedAt: 1 };
    await db.saveCharacter(character);
    const story = db.buildStoryFromSession({ id: 'session', title: '导出与美化测试', user: { name: '我' }, character: { name: character.name },
      createdAt: 1, messages: [{ id: 'm', role: 'assistant', content: '故事正文\n<JSONPatch>[{"op":"replace","path":"/trust","value":9}]</JSONPatch>', timestamp: 1760000000000 }] }, character.id);
    story.id = 'polish-story'; await db.saveArchiveStory(story);
    (await import('/src/lib/editor-story-context.ts')).setEditorStoryId(story.id);
    const { DEFAULT_ENTRY } = await import('/src/types/worldbook.ts');
    sessionStorage.setItem('wb-active-session', JSON.stringify({ filename: 'UID 测试', currentItemId: null, worldbook: { entries: {
      '2': { ...DEFAULT_ENTRY, uid: 2, comment: '第二条' }, '10': { ...DEFAULT_ENTRY, uid: 10, comment: '第十条' },
    } } }));
    localStorage.setItem('ste-play-guide-seen', '1');
  });
  await page.goto(base + '/character/polish-char');
  await page.getByRole('button', { name: '操作', exact: true }).click();
  const cardDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出角色卡 JSON', exact: true }).click();
  const card = await cardDownload;
  expect(card.suggestedFilename()).toMatch(/\.json$/);
  expect(JSON.parse(await readFile(await card.path(), 'utf8')).data.extensions.keep).toBe('保留字段');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '导出故事', exact: true }).click();
  const storyDownload = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'JSON 文件', exact: true }).click();
  const story = await storyDownload;
  expect(JSON.parse(await readFile(await story.path(), 'utf8')).messages[0].mes).toContain('故事正文');
  await page.goto(base + '/worldbook');
  await page.getByRole('button', { name: '跳过引导', exact: true }).click();
  await page.getByRole('button', { name: '跳过', exact: true }).click();
  await page.locator('[data-entry-key="10"]').click();
  await page.getByLabel('UID', { exact: true }).fill('2');
  await expect(page.getByRole('button', { name: '应用 UID', exact: true })).toBeDisabled();
  await page.getByLabel('UID', { exact: true }).fill('0');
  await page.getByRole('button', { name: '应用 UID', exact: true }).click();
  await expect(page.getByLabel('UID', { exact: true })).toHaveValue('0');
  await page.getByRole('combobox').filter({ hasText: 'Order 升序' }).click();
  await page.getByRole('option', { name: 'UID 升序', exact: true }).click();
  expect(await page.locator('[data-entry-key]').evaluateAll(elements => elements.map(e => e.dataset.entryKey))).toEqual(['10', '2']);
  // This navigation intentionally discards the isolated world's draft only.
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/beautify');
  await expect(page.getByLabel('故事', { exact: true })).toHaveValue('polish-story');
  await page.getByRole('switch', { name: '启用状态栏', exact: true }).click();
  await page.getByRole('switch', { name: '启用 MVU 更新', exact: true }).click();
  await page.getByLabel('显示方式', { exact: true }).selectOption('floating');
  await page.getByLabel('初始变量 / 预览样本（JSON 对象）', { exact: true }).fill('{"trust":17,"location":"森林"}');
  await expect(page.frameLocator('iframe[title="状态栏预览"]').locator('body')).toContainText('17');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('美化配置已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: '启用状态栏', exact: true })).toHaveAttribute('data-state', 'checked');
  await page.screenshot({ path: out + '/beautify-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: out + '/beautify-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '进入聊天', exact: true }).click();
  await expect(page).toHaveURL(/\/play\/polish-story\?branch=$/);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('[data-ste-widget="floating"]')).toBeVisible({ timeout: 60000 });
  await expect(tavern.frameLocator('[data-ste-widget="floating"] iframe').locator('body')).toContainText('9', { timeout: 20000 });
  await tavern.locator('[data-ste-widget="floating"] button').click();
  await expect(tavern.locator('[data-ste-widget="floating"] iframe')).toBeHidden();
  await page.screenshot({ path: out + '/chat-widget.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: ['PNG card to JSON', 'direct story JSON', 'UID edit and sorting', 'beautify preview/save/reload', 'mobile layout', 'MVU actual script', 'floating widget/collapse'], errors }));
} catch (error) {
  console.error('Page errors:', errors);
  for (const frame of page.frames().slice(1)) console.error('Frame:', frame.url(), (await frame.locator('body').innerText().catch(() => '')).slice(-2000));
  console.error(await page.locator('body').innerText());
  await page.screenshot({ path: out + '/failure.png', fullPage: true, timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
