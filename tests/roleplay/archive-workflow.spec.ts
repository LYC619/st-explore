/* eslint-disable @typescript-eslint/no-explicit-any -- Real application repositories in browser fixtures. */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('library batch bar sets only selected character types and survives reopening', async ({ page }) => {
  await page.goto('/');
  const ids = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const card = db.buildCharacterFromCard({ name: `类型回归${i}` }); card.type = '人物'; card.tags = ['世界观/未来'];
      await db.saveCharacter(card); ids.push(card.id);
    }
    return ids;
  });
  await page.goto('/library'); await page.getByRole('button', { name: '批量管理', exact: true }).click();
  for (const id of ids.slice(0, 2)) await page.locator(`[data-character-id="${id}"]`).click();
  await page.getByRole('button', { name: '设置类型', exact: true }).click();
  await page.getByRole('button', { name: '选择类型 剧情', exact: true }).click();
  await page.getByRole('button', { name: '为所选 2 张卡设置类型', exact: true }).click();
  await expect.poll(() => page.evaluate(async ids => {
    const db = await import('/src/lib/archive-db.ts'); return Promise.all(ids.map(async (id: string) => (await db.getCharacter(id)).type));
  }, ids)).toEqual(['剧情', '剧情', '人物']);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  for (const id of ids) await expect(page.locator(`[data-character-id="${id}"]`)).toBeVisible();
});

test('detail moves records to a sibling branch, reads full content and preserves ownership on reload', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const card = db.buildCharacterFromCard({ name: '成果移动回归' }); await db.saveCharacter(card);
    const make = (id: string) => db.buildStoryFromSession({ id, title: id, character: { name: card.name }, user: { name: 'u' }, messages: [], createdAt: 1 }, card.id);
    const source = make('来源故事'), target = make('目标故事');
    target.branches = [{ id: 'branch', name: '目标分支', session: target.session, markers: [], createdAt: 1, updatedAt: 1 }];
    await db.saveArchiveStory(source); await db.saveArchiveStory(target);
    await (await import('/src/lib/summary-db.ts')).saveSummary({ id: 'workflow-record', bookId: source.id, bookTitle: source.title,
      title: '可移动总结', kind: 'volume', content: '正文段落。'.repeat(80), floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 });
    return { characterId: card.id, sourceId: source.id, targetId: target.id };
  });
  await page.goto(`/character/${fixture.characterId}`); await page.getByRole('button', { name: '总结', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await panel.getByRole('combobox').first().click(); await page.getByRole('option', { name: '来源故事', exact: true }).click();
  const body = panel.locator('.break-words').filter({ hasText: '正文段落。' });
  await body.hover(); expect(await body.getAttribute('title')).toBeNull();
  await body.click(); await expect(panel.getByText('点击展开全文')).toHaveCount(0);
  await page.screenshot({ path: '.cache/archive-maintenance-20261018/b-record-reading.png' });
  await panel.getByRole('button', { name: '移动到其他故事', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('目标故事', { exact: true }).selectOption(fixture.targetId);
  await dialog.getByLabel('目标脉络', { exact: true }).selectOption('branch');
  await dialog.getByRole('button', { name: '移动', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(panel.getByText('可移动总结', { exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: '总结', exact: true }).click();
  await panel.getByRole('combobox').first().click(); await page.getByRole('option', { name: '目标故事', exact: true }).click();
  await panel.getByRole('combobox').nth(1).click(); await page.getByRole('option', { name: '目标分支', exact: true }).click();
  await expect(panel.getByText('可移动总结', { exact: true })).toBeVisible();
});

test('processing clears numeric input and persists a single batch unhide without plugin changes', async ({ page }) => {
  await page.goto('/');
  const storyId = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const story = db.buildStoryFromSession({ id: 'hidden', title: '隐藏回归', character: { name: 'c' }, user: { name: 'u' }, createdAt: 1,
      messages: Array.from({ length: 5 }, (_, i) => ({ id: `hide${i}`, role: 'assistant', hidden: true, content: `可阅读正文${i}`,
        rawData: { mes: `可阅读正文${i}`, is_system: true, extra: i === 2 ? { bbs_hidden: true } : {} } })) });
    story.settings = { ...(await import('/src/lib/session-storage.ts')).getDefaultExportSettings(), regexRules: [{ id: 'r', name: '范围', findRegex: '无匹配', replaceString: '', placement: ['all'], disabled: false, minDepth: 1, maxDepth: null }] };
    await db.saveArchiveStory(story); return story.id;
  });
  await page.goto(`/story/${storyId}?view=read`);
  await page.getByText('批量隐藏操作', { exact: true }).click();
  await page.getByRole('button', { name: '取消全部手动隐藏', exact: true }).click();
  await expect.poll(() => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages.map((m: any) => m.hidden), storyId)).toEqual([false, false, true, false, false]);
  await page.getByRole('button', { name: '展开编辑', exact: true }).click();
  const count = page.getByLabel('最近楼层数', { exact: true }); await count.fill(''); await expect(count).toHaveValue('');
  await count.fill('50'); await count.press('Tab');
  await expect.poll(() => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).settings.regexRules[0].minDepth, storyId)).toBe(50);
  await page.reload(); await expect(page.getByText('可阅读正文0', { exact: true })).toBeVisible();
});

test('captures consecutive records from a saved message and imports them once into the current character worldbook', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts'), wb = await import('/src/lib/worldbook-db.ts');
    const { DEFAULT_ENTRY } = await import('/src/types/worldbook.ts');
    const card = db.buildCharacterFromCard({ name: '收录流程回归' }); card.assets = [{ kind: 'worldbook', assetId: 'capture-book', relations: ['embedded'] }]; await db.saveCharacter(card);
    await wb.saveWorldBook({ id: 'capture-book', title: '已有关联书', createdAt: 1, updatedAt: 1,
      worldbook: { entries: Object.fromEntries([0, 2, 50].map(uid => [String(uid), { ...DEFAULT_ENTRY, uid, content: '原文' }])) } });
    const story = db.buildStoryFromSession({ id: 'capture-session', title: '收录故事', character: { name: card.name }, user: { name: 'u' }, messages: [{ id: 'source', role: 'assistant', content: '已生成的总结正文' }], createdAt: 1 }, card.id);
    await db.saveArchiveStory(story); return { characterId: card.id, storyId: story.id };
  });
  await page.goto(`/story/${fixture.storyId}?view=read`);
  await page.getByRole('button', { name: '收录第 0 楼为总结或日记', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('记录正文')).toHaveValue('已生成的总结正文');
  for (let i = 1; i <= 3; i++) {
    await dialog.getByLabel('记录标题', { exact: true }).fill(`第${i}卷成果`);
    await dialog.getByLabel('记录正文', { exact: true }).fill(`第${i}卷总结正文`);
    await dialog.getByLabel('卷号', { exact: true }).fill(String(i));
    await dialog.getByRole('button', { name: i < 3 ? '保存并继续添加' : '保存', exact: true }).click();
    if (i < 3) await expect(dialog.getByLabel('记录正文')).toHaveValue('');
  }
  await expect(dialog).toHaveCount(0); await page.goto(`/character/${fixture.characterId}`);
  await page.getByRole('button', { name: '总结', exact: true }).click();
  const selectRecords = async () => { for (let i = 1; i <= 3; i++) await page.getByRole('checkbox', { name: `选择记录 第${i}卷成果`, exact: true }).check(); };
  await selectRecords(); await page.getByRole('button', { name: '加入世界书（3）', exact: true }).click();
  await expect(dialog.getByText(/新增条目默认禁用/)).toBeVisible();
  await dialog.getByRole('button', { name: '确认加入并保存', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const currentEntries = () => page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts'), wb = await import('/src/lib/worldbook-db.ts');
    const card = await db.getCharacter(id), ref = card.assets.find((ref: any) => ref.kind === 'worldbook');
    return Object.values((await wb.getWorldBook(ref.assetId)).worldbook.entries) as any[];
  }, fixture.characterId);
  await expect.poll(async () => (await currentEntries()).length).toBe(6);
  expect((await currentEntries()).filter(entry => entry.steRecordSource).every(entry => entry.enabled === false)).toBe(true);
  await selectRecords(); await page.getByRole('button', { name: '加入世界书（3）', exact: true }).click();
  await dialog.getByRole('button', { name: '确认加入并保存', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await currentEntries()).length).toBe(6);
  await page.reload(); await expect(page.getByRole('button', { name: '故事评分', exact: true })).toHaveCount(0);
});

test('tree generation uses explicit scope and reference records, previews the request and reads full nodes in detail', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    const card = db.buildCharacterFromCard({ name: '故事树流程回归' }); await db.saveCharacter(card);
    const story = db.buildStoryFromSession({ id: 'tree-session', title: '树源故事', character: { name: card.name }, user: { name: 'u' }, messages: [{ id: 'm', role: 'assistant', content: '可核对的事实 foo' }], createdAt: 1 }, card.id);
    await db.saveArchiveStory(story);
    await (await import('/src/lib/story-tree-db.ts')).saveStoryTree({ id: 'workflow-tree', title: '可生成故事树', bookId: story.id, bookTitle: story.title, nodes: [], createdAt: 1, updatedAt: 1 });
    await (await import('/src/lib/summary-db.ts')).saveSummary({ id: 'tree-ref', title: '参考成果', kind: 'diary', diaryOwner: '乔伊', content: '参考日记正文', bookId: story.id, bookTitle: story.title, floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 });
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'tree-profile', name: '本地夹具', apiUrl: 'https://tree.example/v1/chat/completions', apiKey: 'local-test', model: 'fixture' }], 'tree-profile');
    localStorage.setItem('st-current-book-id', 'unrelated-book');
    return { characterId: card.id, storyId: story.id };
  });
  let requestText = '';
  await page.route('https://tree.example/v1/chat/completions', async route => {
    requestText = route.request().postData() || '';
    const output = JSON.stringify({ ops: [{ op: 'insert', title: '乔伊', type: 'character', content: '故事节点完整正文。'.repeat(30) }] });
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: output } }] })}\n\ndata: [DONE]\n\n` });
  });
  await page.goto(`/story/${fixture.storyId}?view=tree`);
  await page.getByRole('button', { name: /AI.*生成/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('参考总结/日记', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: /参考成果/ }).check();
  await dialog.getByText(/最终请求预览/).click(); await expect(dialog.locator('pre').filter({ hasText: '参考日记正文' })).toBeVisible();
  await dialog.getByRole('button', { name: '生成', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '应用到故事树（1）', exact: true })).toBeEnabled();
  expect(requestText).toContain('参考日记正文'); expect(requestText).toContain('乔伊');
  await dialog.getByRole('button', { name: '应用到故事树（1）', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await (await import('/src/lib/story-tree-db.ts')).getAllStoryTrees()).find((t: any) => t.id === 'workflow-tree').nodes.length)).toBe(1);
  await page.goto(`/character/${fixture.characterId}`); await page.getByRole('button', { name: '故事树', exact: true }).click();
  await page.getByRole('tabpanel').getByRole('button', { name: /乔伊/ }).click();
  await expect(page.getByRole('tabpanel').locator('article')).toContainText('故事节点完整正文。'.repeat(30));
});

test('observes library return state and detail reading without changing typography', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    for (let i = 0; i < 30; i++) {
      const card = db.buildCharacterFromCard({ name: `列表返回${i}` }); card.type = i % 2 ? '剧情' : '人物'; card.rating = i % 10; await db.saveCharacter(card);
      const story = db.buildStoryFromSession({ id: `list-story-${i}`, title: `列表故事${i}`, character: { name: card.name }, user: { name: 'u' }, createdAt: 1,
        messages: [{ id: `m-${i}`, role: 'assistant', content: '详情阅读正文。'.repeat(200) }] }, card.id); await db.saveArchiveStory(story);
    }
  });
  await page.goto('/library'); await page.getByRole('combobox', { name: '角色排序', exact: true }).click(); await page.getByRole('option', { name: '按评分', exact: true }).click();
  const type = page.locator('[data-library-type-grid]').getByRole('button', { name: /剧情/ }); await type.click();
  const tile = page.locator('[data-character-id]').nth(8); await tile.scrollIntoViewIfNeeded();
  const before = await tile.evaluate(node => {
    let parent = node.parentElement; while (parent && getComputedStyle(parent).overflowY !== 'auto') parent = parent.parentElement;
    return parent?.scrollTop ?? 0;
  });
  await tile.click(); await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回故事列表', exact: true })).toBeVisible();
  await page.screenshot({ path: '.cache/archive-maintenance-20261018/b6-detail-reading.png' });
  await page.getByRole('button', { name: '返回故事列表', exact: true }).click();
  await page.getByRole('button', { name: '角色库', exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: '角色排序', exact: true })).toContainText('按评分');
  await expect(type).toHaveAttribute('aria-pressed', 'true');
  const after = await page.locator('[data-character-id]').first().evaluate(node => {
    let parent = node.parentElement; while (parent && getComputedStyle(parent).overflowY !== 'auto') parent = parent.parentElement;
    return parent?.scrollTop ?? 0;
  });
  await test.info().attach('library-scroll-observation', { body: JSON.stringify({ before, after, restored: Math.abs(before - after) < 2 }), contentType: 'application/json' });
  console.log('Library return scroll:', JSON.stringify({ before, after }));
});
