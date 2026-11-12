/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise the native Tavern API. */
import { test, expect, type Page } from '@playwright/test';

test('home is usable while the optional remote font stylesheet is stalled', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/https:\/\/fonts\.googleapis\.com\//, async route => { await gate; await route.fulfill({ contentType: 'text/css', body: '' }); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/src/pages/SettingsPage.tsx')))).toBe(false);
  } finally { release(); }
});

async function seed(page: Page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.goto('/');
  return page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await import('/src/lib/archive-db.ts');
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'p', name: '本地测试', apiUrl: 'https://model.example.test/completion', apiKey: '', model: 'fixture' }], 'p');
    const card = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '后台回归角色', first_mes: '欢迎', description: '' } });
    await db.saveCharacter(card);
    const story = db.buildStoryFromSession({ id: 'background-test', title: '后台回归故事', createdAt: 1, user: { name: '旅人' }, character: { name: card.name }, messages: [
      { id: 'greeting', role: 'assistant', content: '欢迎' }, { id: 'question', role: 'user', content: '继续' }, { id: 'reply', role: 'assistant', content: '原有回答' },
    ] }, card.id);
    await db.saveArchiveStory(story);
    return { storyId: story.id, characterId: card.id };
  });
}

test('a pending swipe saves without warning and finishes while browsing other modules', async ({ page }) => {
  const fixture = await seed(page);
  let finish!: () => void;
  let started = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  await page.route('https://model.example.test/completion', async route => {
    started = true; await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '后台完成的新回答' }, finish_reason: 'stop' }] }) });
  });
  await page.goto(`/play/${fixture.storyId}?branch=&from=chats`);
  const iframe = page.locator('iframe[title="SillyTavern 角色扮演"]');
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat .mes').last()).toContainText('原有回答');
  const frame = page.frames().find(frame => frame.url().includes('tavern.html'))!;
  const src = await iframe.getAttribute('src');
  await frame.evaluate(async () => { (await import('/scripts/openai.js')).oai_settings.stream_openai = false; });
  await tavern.locator('#chat .mes').last().locator('.swipe_right').click();
  await expect.poll(() => started).toBe(true);
  await frame.evaluate(async () => { const st = await import('/script.js'); await st.saveChatConditional(); await st.flushDebouncedChatSave(); });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(iframe).toBeHidden();
  // ChatHub intentionally omits branch. It must still resume the same pending session.
  await page.getByText('后台回归故事', { exact: true }).click();
  await expect(iframe).toBeVisible();
  expect(await iframe.getAttribute('src')).toBe(src);
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await page.getByRole('button', { name: '角色库', exact: true }).first().click();
  await expect(page).toHaveURL(/\/library/);
  finish();
  await expect.poll(async () => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages.at(-1).content, fixture.storyId)).toBe('后台完成的新回答');
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  expect(await iframe.getAttribute('src')).toBe(src);
  await expect(tavern.locator('#chat .mes').last()).toContainText('后台完成的新回答');
  await page.getByRole('button', { name: '关闭聊天', exact: true }).click();
  await expect(iframe).toHaveCount(0);
  await page.goto(`/play/${fixture.storyId}?branch=`);
  await expect(tavern.locator('#chat .mes').last()).toContainText('后台完成的新回答');
  await tavern.locator('#chat .mes').last().locator('.swipe_left').click();
  await expect(tavern.locator('#chat .mes').last()).toContainText('原有回答');
});

test('Catbox preset downloads concurrently in the background with Chinese names', async ({ page }) => {
  const fixture = await seed(page);
  // Different portraits must have different bytes: identical images are deduplicated.
  const portraits = (await page.evaluate(() => Array.from({ length: 5 }, (_, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d')!; context.fillStyle = `hsl(${index * 60}, 100%, 50%)`;
    context.fillRect(0, 0, 2, 2); return canvas.toDataURL('image/png').split(',')[1];
  }))).map(value => Buffer.from(value, 'base64'));
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let requests = 0;
  await page.route('https://files.catbox.moe/**', async route => {
    requests++; await gate;
    const index = Number(route.request().url().match(/abc12([3-7])\.png$/)?.[1]) - 3;
    expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(5);
    await route.fulfill({ contentType: 'image/png', body: portraits[index] });
  });
  await page.goto(`/character/${fixture.characterId}`);
  await page.getByRole('tab', { name: /^立绘/ }).click();
  await page.getByRole('button', { name: '从图床导入' }).click();
  await page.getByText('高级设置', { exact: true }).click();
  await page.getByRole('button', { name: 'Catbox 世界书列表' }).click();
  await page.getByLabel('名称或世界书片段', { exact: true }).fill('开心: 开心abc123.png\n生气: 生气abc124.png\n害羞: 害羞abc125.png\n微笑: 微笑abc126.png\n惊讶: 惊讶abc127.png');
  await expect(page.getByRole('dialog').getByRole('status').first()).toContainText('5 行有效');
  await page.getByRole('button', { name: '导入所选（5）', exact: true }).click();
  // Visible previews may also be in flight or reused; assert the actual import
  // worker limit separately from concurrent image requests.
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(async () => {
    const task = (await import('/src/lib/portrait-cloud-task.ts')).portraitCloudTasks.getSnapshot();
    return task?.items.map(item => item.status);
  })).toEqual(['downloading', 'downloading', 'downloading', 'downloading', 'pending']);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '角色库', exact: true }).first().click();
  await expect(page).toHaveURL(/\/library/);
  finish();
  const task = page.getByRole('complementary', { name: '立绘下载任务' });
  await expect(task).toContainText('5/5 张已保存');
  const names = await page.evaluate(async id => {
    const c = await (await import('/src/lib/archive-db.ts')).getCharacter(id);
    return c.portraitRows.flatMap((row: any) => row.items.map((item: any) => item.name));
  }, fixture.characterId);
  expect(names.join(' ')).toContain('开心');
  expect(names).toHaveLength(5);
});
