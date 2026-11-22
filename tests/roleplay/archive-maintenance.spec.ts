/* eslint-disable @typescript-eslint/no-explicit-any -- Browser fixtures use the application's real modules. */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a complete story copy keeps record ownership independent through detail-page switching and reopening', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const summaries = await import('/src/lib/summary-db.ts');
    const trees = await import('/src/lib/story-tree-db.ts');
    const card = db.buildCharacterFromCard({ name: '归属回归角色' }); await db.saveCharacter(card);
    const story = db.buildStoryFromSession({ id: 'scope-session', title: '原故事', createdAt: 1, user: { name: '旅人' }, character: { name: card.name },
      messages: [{ id: 'scope-m', role: 'assistant', content: '原故事正文' }] }, card.id);
    story.branches = [{ id: 'scope-branch', name: '岔路', session: structuredClone(story.session), markers: [], createdAt: 1, updatedAt: 1 }];
    await db.saveArchiveStory(story);
    for (const [index, kind] of ['volume', 'volume', 'diary', 'diary'].entries()) await summaries.saveSummary({
      id: `scope-record-${index}`, bookId: story.id, bookTitle: story.title, kind, title: `原成果${index}`, content: `原成果正文${index}`,
      floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1, ...(index === 3 ? { branchId: 'scope-branch' } : {}),
    });
    await trees.saveStoryTree({ id: 'scope-tree', title: '原故事树', bookId: story.id, bookTitle: story.title, branchId: 'scope-branch', createdAt: 1, updatedAt: 1,
      nodes: [{ id: 'scope-node', parentId: null, title: '树节点', content: '原树内容', hint: '', tags: [], pinned: false, archived: false, order: 0 }] });
    return { characterId: card.id, sourceId: story.id };
  });
  await page.goto(`/character/${fixture.characterId}`);
  await page.getByRole('button', { name: '更多故事操作', exact: true }).click(); await page.getByRole('menuitem', { name: '复制故事', exact: true }).click();
  await expect(page.getByTitle('原故事（副本）', { exact: true })).toBeVisible();
  const ownership = await page.evaluate(async sourceId => {
    const db = await import('/src/lib/archive-db.ts');
    const allStories = await db.getAllArchiveStories();
    const copy = allStories.find((story: any) => story.copiedFrom?.storyId === sourceId);
    const summaries = await (await import('/src/lib/summary-db.ts')).getAllSummaries();
    const trees = await (await import('/src/lib/story-tree-db.ts')).getAllStoryTrees();
    return { copy, summaries, trees };
  }, fixture.sourceId);
  expect(ownership.summaries.filter((record: any) => record.bookId === fixture.sourceId)).toHaveLength(4);
  expect(ownership.summaries.filter((record: any) => record.bookId === ownership.copy.id)).toHaveLength(4);
  expect(new Set(ownership.summaries.map((record: any) => record.id)).size).toBe(8);
  expect(ownership.trees).toHaveLength(2);
  expect(ownership.trees.find((tree: any) => tree.bookId === ownership.copy.id).branchId).toBe(ownership.copy.branches[0].id);
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await page.getByRole('tabpanel').getByRole('combobox').first().click();
  await page.getByRole('option', { name: '原故事（副本）', exact: true }).click();
  await page.getByRole('button', { name: '手动录入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input').first().fill('副本独有成果');
  await dialog.locator('textarea').fill('只属于副本的新正文');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('副本独有成果', { exact: true })).toBeVisible();
  await page.getByRole('tabpanel').getByRole('combobox').first().click();
  await page.getByRole('option', { name: '原故事', exact: true }).click();
  await expect(page.getByText('原成果0', { exact: true })).toBeVisible();
  await expect(page.getByText('副本独有成果', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await page.getByRole('tabpanel').getByRole('combobox').first().click();
  await page.getByRole('option', { name: '原故事（副本）', exact: true }).click();
  await expect(page.getByText('副本独有成果', { exact: true })).toBeVisible();
});

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('character asset editing flushes on Back and exports current worldbook in JSON and PNG', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts'); const wb = await import('/src/lib/worldbook-db.ts');
    const defaults = await import('/src/types/worldbook.ts');
    (await import('/src/lib/tour-steps.ts')).setTourCompleted('worldbook');
    const card = db.buildCharacterFromCard({ spec: 'chara_card_v2', data: { name: '归档回归', description: '卡原简介', first_mes: '你好', character_book: { entries: [{ keys: [], content: '旧 A' }] }, extensions: { variables: { score: 8 } } } });
    card.pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aoc8AAAAASUVORK5CYII=';
    card.assets = [{ kind: 'worldbook', assetId: 'archive-wb', relations: ['embedded'] }]; await db.saveCharacter(card);
    await wb.saveWorldBook({ id: 'archive-wb', title: '归档世界书', createdAt: 1, updatedAt: 1, worldbook: { entries: { '7': { ...defaults.DEFAULT_ENTRY, uid: 7, comment: '卷总结', content: '旧 A' } } } });
    return { characterId: card.id };
  });
  await page.goto(`/character/${fixture.characterId}`);
  await page.getByRole('tab', { name: /关联资产/ }).click();
  await page.getByRole('button', { name: '处理', exact: true }).click();
  await expect(page).toHaveURL(/worldbook.*assetId=archive-wb/);
  await page.locator('[data-entry-key="7"]').click();
  await page.locator('textarea').first().fill('当前 B：第一卷总结');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/character/${fixture.characterId}`));
  const current = await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts'); const wb = await import('/src/lib/worldbook-db.ts');
    const character = await db.getCharacter(id); const bookId = character.assets[0].assetId;
    return { bookId, content: (await wb.getWorldBook(bookId)).worldbook.entries['7'].content, source: (await wb.getWorldBook('archive-wb')).worldbook.entries['7'].content };
  }, fixture.characterId);
  expect(current.content).toBe('当前 B：第一卷总结'); expect(current.source).toBe('旧 A');
  await page.getByRole('button', { name: '操作', exact: true }).click();
  const jsonDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出角色卡 JSON', exact: true }).click();
  const jsonPath = await (await jsonDownload).path();
  const json = JSON.parse(await readFile(jsonPath!, 'utf8'));
  expect(json.data.character_book.entries[0].content).toBe(current.content); expect(json.data.extensions.variables.score).toBe(8);
  const pngDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '导出角色卡（原格式）', exact: true }).click();
  const pngPath = await (await pngDownload).path(); const png = await readFile(pngPath!);
  const extracted = await page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
    return (await import('/src/lib/png-parser.ts')).extractCharacterFromPngBuffer(bytes.buffer);
  }, png.toString('base64'));
  expect(extracted).toEqual(json);
  await page.reload();
  await page.getByRole('tab', { name: /关联资产/ }).click(); await page.getByRole('button', { name: '处理', exact: true }).click();
  await page.locator('[data-entry-key="7"]').click(); await expect(page.locator('textarea').first()).toHaveValue(current.content);
  await page.getByRole('button', { name: '恢复来源内容', exact: true }).click();
  await expect(page.locator('textarea').first()).toHaveValue('旧 A');
  await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
});

test('real Tavern refreshes model catalogs and saves new persona names without renaming history', async ({ page }) => {
  let modelRequest = 0;
  await page.route('https://archive-model.example/v1/models', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ data: (++modelRequest === 1 ? ['M1'] : ['M1', 'M2']).map(id => ({ id })) }) }));
  await page.route('https://archive-model.example/v1/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '生成回答' }, finish_reason: 'stop' }] }) }));
  await page.goto('/');
  const storyId = await page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await import('/src/lib/archive-db.ts');
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'archive-model', name: '验收连接', apiUrl: 'https://archive-model.example/v1/chat/completions', apiKey: '', model: 'M1' }], 'archive-model');
    const card = db.buildCharacterFromCard({ name: '验收角色', first_mes: '欢迎' }); await db.saveCharacter(card);
    const story = db.buildStoryFromSession({ id: 'archive-session', title: '归档模型验收', user: { name: '历史旅人' }, character: { name: '验收角色' }, createdAt: 1,
      messages: [{ id: 'old', role: 'user', name: '历史旅人', content: '历史消息' }, { id: 'greeting', role: 'assistant', content: '欢迎' }] }, card.id);
    await db.saveArchiveStory(story); return story.id;
  });
  await page.goto(`/play/${storyId}?branch=`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('欢迎');
  await tavern.locator('#sys-settings-button .drawer-toggle').click();
  await tavern.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect.poll(() => modelRequest).toBeGreaterThan(0);
  await tavern.getByRole('button', { name: '刷新模型列表', exact: true }).click();
  await expect.poll(() => modelRequest).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => page.evaluate(async () => (await import('/src/components/ai-tools/api-profiles.ts')).getActiveProfile().modelList)).toContain('M2');
  const frame = page.frames().find(frame => frame.url().includes('tavern.html'))!;
  await frame.evaluate(async () => {
    const st = await import('/script.js'); st.setUserName('当前 Persona');
    (await import('/scripts/openai.js')).oai_settings.stream_openai = false;
    document.querySelector('#left-nav-panel')?.classList.remove('openDrawer');
  });
  await tavern.locator('#send_textarea').fill('当前身份的新消息'); await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('生成回答');
  await frame.evaluate(async () => { const st = await import('/script.js'); await st.saveChatConditional(); await st.flushDebouncedChatSave(); });
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages[0].name).toBe('历史旅人');
  expect(saved.session.messages.find((message: any) => message.content === '当前身份的新消息').name).toBe('当前 Persona');
  expect(saved.session.user.name).toBe('当前 Persona');
});
