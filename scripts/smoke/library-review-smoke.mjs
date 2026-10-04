import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const out = '.cache/library-review-smoke';
const baseUrl = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4186';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('/library', baseUrl).href);
  await page.evaluate(async () => {
    const { saveCharacter, saveArchiveStory, setArchiveSchemaVersion } = await import('/src/lib/archive-db.ts');
    const { saveSummary } = await import('/src/lib/summary-db.ts');
    await setArchiveSchemaVersion(2);
    const now = 1791100000000;
    for (const [id, name, notes] of [['a', '林间旅人', '第一次走了冒险线，后来又试了一次归乡结局。'], ['b', '旧城书店', '一段慢慢熟悉彼此的日常。'], ['c', '海边来信', '留待下次游玩。']]) {
      await saveCharacter({ id, name, card: { name, description: name }, tags: ['人物/归档'], notes: [{ id: 'n-' + id, body: notes, at: now }], status: '未开始', type: '人物', rating: id === 'a' ? 8 : undefined, createdAt: now, updatedAt: now });
    }
    const session = title => ({ id: title, title, character: { name: title }, user: { name: '我' }, messages: [{ id: 'm1', name: title, role: 'assistant', content: '我们又在故事中相遇。\n\n' + '这是一段很长的第一楼，用来验证楼内阅读位置。\n\n'.repeat(60), timestamp: now }], createdAt: now });
    for (const [id, characterId, title] of [['s1','a','第一段 · 森林之旅'], ['s2','a','第二段 · 归乡'], ['s3','b','书店日常']]) {
      await saveArchiveStory({ id, characterId, title, session: session(title), markers: [], branches: id === 's1' ? [{ id:'alt', name:'另一条路', session:session(title), markers:[], createdAt:now, updatedAt:now }] : [], status:'已完结', meta:{modelsUsed:[], playTimeMs:null}, createdAt:now, updatedAt:now });
    }
    for (const [id, bookId, title, branchId, content] of [
      ['r1','s1','第 1 卷 · 初入森林',undefined,'旅人遇见了向导，一起寻找回家的路。\n\n' + '沿途的对话让两人逐渐信任彼此。\n\n'.repeat(35)],
      ['r2','s1','分支 · 留在森林','alt','这次选择留下，帮助村庄度过冬天。'],
      ['r3','s2','归乡后的生活',undefined,'回到故乡，重新见到了久别的朋友。'],
      ['r4','s3','书店的雨天',undefined,'雨天的书店里，他们交换了各自最喜欢的一本书。'],
    ]) await saveSummary({ id, bookId, bookTitle:bookId, title, branchId, kind:'volume', volumeNumber:1, floorStart:0, floorEnd:20, content, createdAt:now, updatedAt:now });
    localStorage.setItem('ste-library-view','review');
  });
  await page.reload();
  await page.getByRole('button', { name: '选择林间旅人', exact: true }).click();
  await page.getByRole('tab', { name: '总结', exact: true }).click();
  await expect(page.locator('#review-record-r3')).toBeAttached();
  await expect(page.locator('#review-record-r2')).toContainText('另一条路');
  await page.locator('[data-review-scroll]').evaluate(element => { element.scrollTop = 550; element.dispatchEvent(new Event('scroll')); });
  await page.getByRole('button', { name: '选择旧城书店', exact: true }).click();
  await expect(page.getByRole('tab', { name: '总结', exact: true })).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#review-record-r4')).toBeVisible();
  await page.getByRole('button', { name: '选择林间旅人', exact: true }).click();
  await expect.poll(() => page.locator('[data-review-scroll]').evaluate(element => element.scrollTop)).toBe(550);
  await page.locator('[data-review-scroll]').evaluate(element => { element.scrollTop=0; element.dispatchEvent(new Event('scroll')); });
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  await page.getByRole('tab', { name: '故事', exact: true }).click();
  await page.getByRole('button', { name: '阅读 第一段 · 森林之旅', exact: true }).click();
  await expect(page.locator('[data-review-scroll]')).toContainText('我们又在故事中相遇');
  await page.locator('[data-review-scroll]').evaluate(element => { element.scrollTop = 450; element.dispatchEvent(new Event('scroll')); });
  await page.getByRole('button', { name: '选择旧城书店', exact: true }).click();
  await page.getByRole('button', { name: '选择林间旅人', exact: true }).click();
  await expect.poll(() => page.locator('[data-review-scroll]').evaluate(element => element.scrollTop)).toBe(450);
  await page.getByRole('tab', { name: '备注', exact: true }).click();
  await page.getByRole('button', { name: '新建备注', exact: true }).click();
  await page.getByRole('textbox', { name: '备注内容', exact: true }).fill('回顾后补充：更喜欢归乡这一段。');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(page.locator('[data-review-scroll]')).toContainText('回顾后补充：更喜欢归乡这一段。');
  await page.getByRole('button', { name: '编辑评分和标签', exact: true }).click();
  await page.getByRole('spinbutton', { name: '评分', exact: true }).fill('8.5');
  await page.getByRole('button', { name: '保存评分和标签', exact: true }).click();
  await expect(page.getByRole('region', { name: '角色回顾内容', exact: true })).toContainText('8.5 分');
  await page.getByPlaceholder('搜索角色或标签', { exact: true }).fill('林间旅人');
  await page.getByRole('button', { name: '打开角色详情', exact: true }).click();
  await expect(page).toHaveURL(/\/character\/a$/);
  await page.goBack();
  await expect(page.getByPlaceholder('搜索角色或标签', { exact: true })).toHaveValue('林间旅人');
  await page.getByPlaceholder('搜索角色或标签', { exact: true }).fill('');
  await page.getByRole('tab', { name: '总结', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  const viewport = await page.evaluate(() => ({ width:document.documentElement.scrollWidth, viewport:innerWidth, height:document.documentElement.scrollHeight, viewportHeight:innerHeight }));
  expect(viewport.width).toBe(viewport.viewport);
  console.log(JSON.stringify({ passed: ['grouped summaries', 'summary scroll restore', 'long first-message scroll restore', 'note and rating writes', 'return search', 'mobile layout'], errors, viewport }));
  expect(errors).toEqual([]);
} finally { await browser.close(); }
