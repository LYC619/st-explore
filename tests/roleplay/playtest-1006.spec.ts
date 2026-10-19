/* eslint-disable @typescript-eslint/no-explicit-any -- Original ST and installed helper expose JavaScript APIs. */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

test('original helper ZIP installs, loads its full public API and persists message variables', async ({ page }) => {
  test.skip(!existsSync('.cache/helper.zip'), 'Run the documented helper fixture download first');
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await import('/src/lib/archive-db.ts');
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'helper-test', name: '本地测试', apiUrl: 'https://example.invalid/completion', apiKey: '', model: 'fixture' }], 'helper-test');
    const character = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '助手回归角色', first_mes: '欢迎测试', description: '' } }); await db.saveCharacter(character);
    const story = db.buildStoryFromSession({ id: 'helper-test', title: '助手回归故事', createdAt: 1, user: { name: '旅人' }, character: { name: character.name }, messages: [{ id: 'greeting', role: 'assistant', content: '欢迎测试' }] }, character.id); await db.saveArchiveStory(story);
    return { storyId: story.id };
  });
  await page.goto(`/play/${fixture.storyId}?branch=`);
  const frame = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(frame.locator('#chat')).toContainText('欢迎测试');
  await frame.locator('#persona-management-button .drawer-toggle').click();
  await frame.locator('#create_dummy_persona').click();
  await frame.locator('.popup-input:visible').fill('回归测试旅人');
  await frame.locator('.popup-button-ok:visible').click();
  await expect(frame.locator('#PersonaManagement')).toContainText('回归测试旅人');
  const beforeInstall = page.frames().find(f => f.url().includes('tavern.html'))!;
  await beforeInstall.evaluate(async () => {
    await (await import('/scripts/tauri/agent-skills/embedded-import.js')).maybePromptForPresetEmbeddedSkills({ apiId: 'openai', name: '普通测试预设', preset: { temperature: 0.8 } });
    const st = await import('/script.js'); await st.saveSettings();
  });
  await expect(frame.locator('#toast-container .toast').filter({ hasText: 'Agent Skill import failed' })).toHaveCount(0);
  await frame.locator('.ste_original_zip').setInputFiles('.cache/helper.zip');
  await expect(frame.locator('#tavern_helper')).toBeAttached({ timeout: 45_000 });
  await expect(frame.locator('#chat')).toContainText('欢迎测试');
  await expect(frame.locator('#ste_helper_settings')).toHaveCount(0);
  const tavern = page.frames().find(f => f.url().includes('tavern.html'))!;
  const api = await tavern.evaluate(async () => {
    const helper = (window as any).TavernHelper;
    const keys = Object.keys(helper);
    helper.replaceVariables({ importedHelper: 7 }, { type: 'chat' });
    const st = await import('/script.js'); await st.saveChatConditional(); await st.flushDebouncedChatSave();
    return { keys, variables: helper.getVariables({ type: 'chat' }) };
  });
  expect(api.keys).toEqual(expect.arrayContaining(['getChatMessages', 'getWorldbook', 'generate', 'replaceVariables']));
  expect(api.variables.importedHelper).toBe(7);
  await page.reload();
  await expect(frame.locator('#tavern_helper')).toBeAttached();
  await expect(frame.locator('#chat')).toContainText('欢迎测试');
  const restored = page.frames().find(f => f.url().includes('tavern.html'))!;
  expect(await restored.evaluate(() => (window as any).TavernHelper.getVariables({ type: 'chat' }).importedHelper)).toBe(7);
  expect(errors.filter(e => !e.includes('ResizeObserver'))).toEqual([]);
});

test('library return keeps sorting and tags; cloud portrait preview downloads a selected image', async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('https://portraits.example.test/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJXcAAAAASUVORK5CYII=', 'base64') }));
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const card = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '标签回归角色', description: '' } });
    card.tags = Array.from({ length: 18 }, (_, i) => `自建/较长的标签${i}`); await db.saveCharacter(card);
    const other = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '另一个角色', description: '' } }); other.tags = ['新类别/其他角色创建']; await db.saveCharacter(other);
    return card.id;
  });
  await page.goto('/library');
  await page.getByRole('combobox', { name: '角色排序' }).click();
  await page.getByRole('option', { name: /最近加入/ }).click();
  await page.getByText('标签回归角色', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/character/${id}`));
  const toggle = page.getByRole('button', { name: '展开全部 18 个标签' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const strip = page.locator('[data-collapsible-tags] > div').first();
  expect(await strip.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(32);
  await toggle.click(); await expect(page.getByRole('button', { name: '收起标签' })).toHaveAttribute('aria-expanded', 'true');
  expect(await strip.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(32);
  await page.getByRole('button', { name: '标签', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '添加标签 新类别/其他角色创建' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goBack(); await expect(page.getByRole('combobox', { name: '角色排序' })).toContainText('最近加入');
  await page.getByText('标签回归角色', { exact: true }).click();
  await page.getByRole('tab', { name: /^立绘/ }).click();
  await page.getByRole('button', { name: '从图床导入' }).click();
  await page.getByLabel('名称或世界书片段', { exact: true }).fill('开心\n生气');
  await page.getByLabel('图片链接模板', { exact: true }).fill('https://portraits.example.test/{name}.png');
  await page.getByRole('button', { name: '预览链接', exact: true }).click();
  await expect(page.getByText('全选 · 2 个链接')).toBeVisible();
  await page.getByRole('button', { name: '下载所选', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '从图床导入立绘' })).toContainText('2/2 张已保存');
  const count = await page.evaluate(async id => {
    const c = await (await import('/src/lib/archive-db.ts')).getCharacter(id);
    return c.portraitRows?.reduce((n: number, row: any) => n + row.items.length, 0);
  }, id);
  expect(count).toBe(2);
});
