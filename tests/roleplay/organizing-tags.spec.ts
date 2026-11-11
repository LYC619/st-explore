import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && !/\/generate$/.test(url.pathname) ? route.continue() : route.abort();
  });
  await page.goto('/');
  return page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('st-chat-beautifier');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const ids: string[] = [];
    const tx = db.transaction(['characters', 'archiveStories'], 'readwrite');
    const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    for (const [index, tags] of [['缺总结', '日记完', '待重读'], ['总结完', '缺日记'], []].entries()) {
      const card = { id: `filter-char-${index}`, name: `筛选角色${index}`, tags, type: '人物', rating: 8,
        status: '未开始', createdAt: 1, updatedAt: 1, card: { name: `筛选角色${index}`, first_mes: '合成开场' } };
      tx.objectStore('characters').put(card); ids.push(card.id);
      for (let n = 0; n < (index === 0 ? 2 : 1); n++) {
        const session = { id: `filter-${index}-${n}`, title: `筛选故事${index}-${n}`,
          createdAt: 1, user: { name: '测试玩家' }, character: { name: card.name },
          messages: [{ id: 'greeting', role: 'assistant', content: '合成开场' }],
        };
        tx.objectStore('archiveStories').put({ id: session.id, title: session.title, characterId: card.id, session,
          createdAt: 1, updatedAt: 1, markers: [], meta: {} });
      }
    }
    await complete; db.close();
    return ids;
  });
}

async function enableChatTags(page: Page) {
  await page.goto('/play');
  await expect(page.getByLabel('标签筛选', { exact: true }).locator('option[value="缺总结"]')).toHaveCount(0);
  await page.getByRole('button', { name: '设置显示的标签', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '标签管理', exact: true });
  for (const tag of ['缺总结', '总结完', '缺日记', '日记完', '待重读']) {
    const toggle = dialog.getByRole('switch', { name: `在聊天中显示 ${tag}`, exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
  }
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('标签筛选', { exact: true }).locator('option[value="待重读"]')).toHaveCount(1);
}

for (const width of [1360, 390]) test(`chat organizing filter opens a matching story and survives return at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await seed(page);
  await enableChatTags(page);
  const list = page.getByRole('region', { name: '已有聊天' });
  const rows = list.getByRole('button', { name: /^继续 / });
  await expect(rows).toHaveCount(4);
  await page.getByLabel('标签筛选', { exact: true }).selectOption('缺总结');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('筛选角色0');
  await page.getByLabel('搜索聊天', { exact: true }).fill('故事0-1');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('合成开场');
  await expect(page.getByRole('status')).toContainText('自动保存');
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await expect(page.getByLabel('标签筛选', { exact: true })).toHaveValue('缺总结');
  await expect(page.getByLabel('搜索聊天', { exact: true })).toHaveValue('故事0-1');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('搜索聊天', { exact: true }).fill('不存在');
  await expect(list).toContainText('没有找到匹配的聊天');
  await expect(page.getByRole('button', { name: '进入酒馆', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(rows).toHaveCount(4);
  await page.getByLabel('标签筛选', { exact: true }).selectOption('总结完');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('筛选角色1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await page.getByLabel('标签筛选', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('original Tavern selects organizing tags and refreshes a changed library label', async ({ page }) => {
  const ids = await seed(page);
  await enableChatTags(page);
  await page.getByRole('button', { name: '继续 筛选故事0-0', exact: true }).click();
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('合成开场');
  await expect(page.getByRole('status')).toContainText('自动保存');
  await tavern.locator('#rightNavHolder > .drawer-toggle').click();
  await tavern.locator('#rm_button_characters').click();
  const tagFilter = tavern.locator('#rm_characters_block .rm_tag_filter');
  const missing = tagFilter.getByRole('button', { name: '缺总结', exact: true });
  if (!await missing.isVisible()) await tavern.locator('#rm_characters_block .showTagList').click();
  await missing.click();
  const cards = tavern.locator('#rm_print_characters_block .character_select');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('筛选角色0');
  await tavern.locator('#rm_characters_block .manageTags').click();
  await expect(tavern.locator('#tag_view_list .tag_view_name').filter({ hasText: /^缺总结$/ })).toBeVisible();
  await expect(tavern.locator('#tag_view_list .tag_view_name').filter({ hasText: /^待重读$/ })).toBeVisible();
  await tavern.locator('.popup:visible').getByRole('button', { name: 'OK', exact: true }).click();
  await tagFilter.getByRole('button', { name: '精品', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('st-chat-beautifier');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['characters', 'archiveMeta'], 'readwrite');
      const card = tx.objectStore('characters').get(id);
      card.onsuccess = () => tx.objectStore('characters').put({ ...card.result, tags: ['总结完', '日记完'] });
      const meta = tx.objectStore('archiveMeta').get('archive-schema');
      meta.onsuccess = () => {
        const record = meta.result;
        record.libraryTags.chatVisible = record.libraryTags.chatVisible.filter((tag: string) => tag !== '缺总结');
        tx.objectStore('archiveMeta').put(record);
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
  }, ids[0]);
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect(missing).toHaveCount(0);
  await expect(cards).toHaveCount(3);
  await tagFilter.getByRole('button', { name: '总结完', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await page.getByLabel('标签筛选', { exact: true }).selectOption('总结完');
  await expect(page.getByRole('region', { name: '已有聊天' }).getByRole('button', { name: /^继续 / })).toHaveCount(3);
  await page.reload();
  await page.getByLabel('标签筛选', { exact: true }).selectOption('总结完');
  await expect(page.getByRole('region', { name: '已有聊天' }).getByRole('button', { name: /^继续 / })).toHaveCount(3);
  await expect(page.getByLabel('标签筛选', { exact: true }).locator('option[value="缺总结"]')).toHaveCount(0);
});

test('a story opened through the missing-summary filter saves edits and reopens after reload', async ({ page }) => {
  await seed(page);
  await enableChatTags(page);
  await page.getByLabel('标签筛选', { exact: true }).selectOption('缺总结');
  await page.getByRole('button', { name: '继续 筛选故事0-1', exact: true }).click();
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('合成开场');
  await message.hover();
  await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('筛选后保存的合成修改。');
  await message.locator('.mes_edit_done').click();
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await expect(page.getByLabel('标签筛选', { exact: true })).toHaveValue('缺总结');
  await page.reload();
  await page.getByLabel('标签筛选', { exact: true }).selectOption('缺总结');
  await page.getByRole('button', { name: '继续 筛选故事0-1', exact: true }).click();
  await expect(message.locator('.mes_text')).toHaveText('筛选后保存的合成修改。');
});

test('an arbitrary library tag can be enabled, used and disabled through the actual settings UI', async ({ page }) => {
  await seed(page);
  await enableChatTags(page);
  const filter = page.getByLabel('标签筛选', { exact: true });
  const rows = page.getByRole('region', { name: '已有聊天' }).getByRole('button', { name: /^继续 / });
  await filter.selectOption('待重读');
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: '设置显示的标签', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '标签管理', exact: true });
  const toggle = dialog.getByRole('switch', { name: '在聊天中显示 待重读', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(filter.locator('option[value="待重读"]')).toHaveCount(0);
  await expect(rows).toHaveCount(4);
  await page.reload();
  await expect(filter.locator('option[value="待重读"]')).toHaveCount(0);
  await expect(filter.locator('option[value="缺总结"]')).toHaveCount(1);
});
