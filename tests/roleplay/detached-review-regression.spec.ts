/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic browser fixtures use the Tavern frame's public bridge. */
import { test, expect, type Page } from '@playwright/test';

async function openSplit(page: Page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  const storyId = await page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    localStorage.setItem('ste-tag-migration-v2-notice', '1');
    const db = await import('/src/lib/archive-db.ts');
    const character = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: {
      name: 'Synthetic reviewer', description: 'Synthetic fixture', first_mes: 'Synthetic opening',
      personality: '', scenario: '', mes_example: '', extensions: {},
    } });
    await db.saveCharacter(character);
    const story = db.buildStoryFromSession({ id: 'synthetic-split', title: 'Synthetic split story', createdAt: 1,
      user: { name: 'Synthetic player' }, character: { name: 'Synthetic reviewer' },
      messages: Array.from({ length: 61 }, (_, index) => ({ id: `synthetic-${index}`, role: index % 2 ? 'user' : 'assistant',
        content: `Synthetic paragraph ${index}. ` + 'Synthetic fixture text. '.repeat(40) })),
    }, character.id);
    await db.saveArchiveStory(story);
    return story.id;
  });
  await page.goto(`/play/${storyId}`);
  await expect(page.frameLocator('iframe[title="SillyTavern 角色扮演"]').locator('#chat')).toContainText('Synthetic paragraph 60.');
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: '独立窗口', exact: true }).click();
  const popup = await opened;
  await expect(popup.frameLocator('iframe[title="SillyTavern 角色扮演"]').locator('#chat')).toContainText('Synthetic paragraph 60.');
  return { popup, storyId };
}

async function assertMainScrolls(page: Page) {
  await page.bringToFront();
  const point = await page.evaluate(() => {
    const area = [...document.querySelectorAll<HTMLElement>('main div')]
      .filter(el => el.scrollHeight > el.clientHeight + 200 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!area) throw new Error('Synthetic reader scroll area missing');
    area.dataset.splitScroll = 'true'; area.scrollTop = 0;
    const rect = area.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.locator('[data-split-scroll]').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('body').getAttribute('data-scroll-locked')).toBeNull();
}

test('help and process panels keep child dismissal and main reader wheel scrolling independent', async ({ page }) => {
  const { popup } = await openSplit(page);
  await assertMainScrolls(page);
  for (const name of ['使用帮助', '过程']) {
    await popup.bringToFront();
    await popup.getByRole('button', { name, exact: true }).click();
    await expect(popup.getByRole('dialog')).toBeVisible();
    await assertMainScrolls(page);
    await expect(popup.getByRole('dialog')).toBeVisible();
    await popup.bringToFront(); await popup.keyboard.press('Escape');
    await expect(popup.getByRole('dialog')).toBeHidden();
    await popup.getByRole('button', { name, exact: true }).click();
    await popup.locator('[data-foreign-dialog-overlay]').click({ position: { x: 5, y: 5 } });
    await expect(popup.getByRole('dialog')).toBeHidden();
  }
});

test('a failed save keeps the detached chat and its exit confirmation local to that window', async ({ page }) => {
  const { popup } = await openSplit(page);
  await popup.evaluate(() => {
    const child = document.querySelector('iframe')!.contentWindow as any;
    child.__STE_TEST_FLUSH__ = child.__STE_TAVERN_FLUSH__;
    child.__STE_TAVERN_FLUSH__ = async () => { throw new Error('Synthetic write failure'); };
  });
  await popup.getByRole('button', { name: '关闭聊天', exact: true }).click();
  await expect(popup.getByRole('button', { name: '退出聊天', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: '退出聊天', exact: true }).click();
  await expect(popup.getByRole('alertdialog')).toBeVisible();
  await assertMainScrolls(page);
  await popup.bringToFront(); await popup.keyboard.press('Escape');
  await expect(popup.getByRole('alertdialog')).toBeHidden();
  await popup.getByRole('button', { name: '退出聊天', exact: true }).click();
  await popup.locator('[data-foreign-dialog-overlay]').click({ position: { x: 5, y: 5 } });
  await expect(popup.getByRole('alertdialog')).toBeHidden();
  await expect(popup.locator('iframe')).toHaveCount(1);
  await popup.evaluate(() => {
    const child = document.querySelector('iframe')!.contentWindow as any;
    child.__STE_TAVERN_FLUSH__ = child.__STE_TEST_FLUSH__;
  });
  await popup.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(popup.getByRole('button', { name: '退出聊天', exact: true })).toBeHidden();
});

for (const action of ['收回页内', '关闭聊天']) {
  test(`saved dirty draft ${action} closes only this popup without a redundant beforeunload prompt`, async ({ page }) => {
    const { popup, storyId } = await openSplit(page);
    let prompts = 0;
    popup.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
    await popup.frameLocator('iframe[title="SillyTavern 角色扮演"]').locator('#send_textarea').fill('Synthetic saved draft');
    await popup.getByRole('button', { name: action, exact: true }).click();
    await expect.poll(() => popup.isClosed()).toBe(true);
    expect(prompts).toBe(0);
    if (action === '关闭聊天') await page.goto(`/play/${storyId}`);
    const inline = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
    await expect(inline.locator('#send_textarea')).toHaveValue('Synthetic saved draft');
    // Reopening a child must install a fresh dirty-close guard.
    const nextPopup = page.waitForEvent('popup');
    await page.getByRole('button', { name: '独立窗口', exact: true }).click();
    const reopened = await nextPopup;
    await expect(reopened.getByRole('button', { name: '过程', exact: true })).toBeEnabled();
    await reopened.frameLocator('iframe[title="SillyTavern 角色扮演"]').locator('#send_textarea').fill('Synthetic new unsaved draft');
    let prevented = false;
    reopened.on('dialog', async dialog => { prevented = true; await dialog.dismiss(); });
    await reopened.close({ runBeforeUnload: true });
    await expect.poll(() => prevented).toBe(true);
    expect(reopened.isClosed()).toBe(false);
    await expect(reopened.locator('iframe')).toHaveCount(1);
  });
}

test('cancelling an independent beforeunload guard keeps the original popup content and main route', async ({ page }) => {
  const { popup } = await openSplit(page);
  const route = page.url();
  await popup.evaluate(() => window.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; }));
  let prompts = 0;
  popup.on('dialog', async dialog => { prompts++; await dialog.dismiss(); });
  await popup.getByRole('button', { name: '收回页内', exact: true }).click();
  await expect.poll(() => prompts).toBeGreaterThan(0);
  expect(popup.isClosed()).toBe(false);
  await expect(popup.locator('iframe')).toHaveCount(1);
  expect(page.url()).toBe(route);
  await expect(popup.getByRole('button', { name: '收回页内', exact: true })).toBeEnabled();
});
