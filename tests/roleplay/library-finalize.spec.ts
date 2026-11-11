import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page) {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' && !/\/generate$/.test(route.request().url()) ? route.continue() : route.abort());
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('st-chat-beautifier'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['characters', 'archiveStories', 'summaries'], 'readwrite');
    const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    for (const n of [1, 2]) {
      tx.objectStore('characters').put({ id: `c${n}`, name: `合成角色${n}`, card: { name: `合成角色${n}`, first_mes: '合成开场' }, type: '人物', tags: n === 1 ? ['无总结'] : [], createdAt: 1, updatedAt: 1 });
      tx.objectStore('archiveStories').put({ id: `s${n}`, title: `合成故事${n}`, characterId: `c${n}`, session: { id: `s${n}`, title: `合成故事${n}`, createdAt: 1, character: { name: `合成角色${n}` }, user: { name: '测试玩家' }, messages: [{ id: 'm', role: 'assistant', content: '合成开场' }] }, createdAt: 1, updatedAt: 1, markers: [], meta: {} });
    }
    tx.objectStore('summaries').put({ id: 'record', bookId: 's1', bookTitle: '合成故事1', kind: 'volume', title: '合成总结', content: '### 存档节点\n' + '这是合成阅读布局测试。'.repeat(160), floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 });
    await done; db.close();
  });
}

for (const width of [1600, 390]) test(`library count and summary reading use current results and available width at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 }); await seed(page); await page.goto('/library');
  await expect(page.getByLabel('当前筛选角色数')).toHaveText('2 张');
  await page.getByPlaceholder('搜索角色或标签').fill('无总结');
  await expect(page.getByLabel('当前筛选角色数')).toHaveText('1 / 2 张');
  await page.getByPlaceholder('搜索角色或标签').fill('没有匹配');
  await expect(page.getByLabel('当前筛选角色数')).toHaveText('0 / 2 张');
  await page.getByPlaceholder('搜索角色或标签').fill('');
  await expect(page.getByLabel('当前筛选角色数')).toHaveText('2 张');
  await page.goto('/character/c1');
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await page.getByRole('button', { name: '展开全文', exact: true }).click();
  const reading = page.locator('.record-reading').first();
  await expect(reading).toContainText('存档节点');
  expect(await reading.evaluate(el => el.clientWidth / el.parentElement!.clientWidth)).toBeGreaterThan(0.85);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('deleting a character from its real page removes its stories and summaries, leaving the other card', async ({ page }) => {
  await seed(page); await page.goto('/character/c1');
  await page.getByRole('button', { name: '操作', exact: true }).click();
  await page.getByRole('button', { name: '删除角色卡', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('名下故事、总结、日记与角色附件会一并删除');
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  await page.reload();
  await expect(page.getByLabel('当前筛选角色数')).toHaveText('1 张');
  const counts = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('st-chat-beautifier'); r.onsuccess = () => resolve(r.result); });
    const count = (store: string) => new Promise<number>(resolve => { const r = db.transaction(store).objectStore(store).count(); r.onsuccess = () => resolve(r.result); });
    const result = await Promise.all(['characters', 'archiveStories', 'summaries'].map(count)); db.close(); return result;
  });
  expect(counts).toEqual([1, 1, 0]);
});

test('worldbook import appears in the retained Tavern without reloading the application', async ({ page }) => {
  await seed(page); await page.goto('/play');
  await page.getByRole('button', { name: '继续 合成故事1', exact: true }).click();
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('合成开场');
  await expect(page.getByRole('status')).toContainText('自动保存');
  // Real STE navigation preserves the active Tavern frame.
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await page.getByRole('button', { name: '附属库', exact: true }).click();
  await page.locator('#asset-library-worldbook-import').setInputFiles({ name: '新导入世界书.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ entries: { 0: { uid: 0, key: ['测试'], content: '仅合成测试', constant: true } } })) });
  await expect(page.getByText('世界书导入成功', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect(tavern.locator('#world_editor_select option').filter({ hasText: /^新导入世界书$/ })).toHaveCount(1);
  await expect(tavern.locator('#chat')).toContainText('合成开场');
});
