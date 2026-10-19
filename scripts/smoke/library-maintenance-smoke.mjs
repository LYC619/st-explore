import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4189';
const output = '.cache/library-maintenance-smoke';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base + '/library');
  await page.evaluate(async () => {
    const db = await import('/src/lib/archive-db.ts');
    await db.setArchiveSchemaVersion(2);
    const preferences = await db.getLibraryTagPreferences();
    await db.saveLibraryTagPreferences({ ...preferences, hidden: preferences.hidden.filter(tag => tag !== '评价/精品') });
    for (let index = 0; index < 19; index++) await db.saveCharacter({ id: `c${index}`, name: `维护测试${index}`, card: { name: `维护测试${index}` },
      type: index < 18 ? '剧情' : '人物', rating: index < 6 || index === 18 ? 8 : 6.5, tags: [], status: '未开始', createdAt: 1, updatedAt: 1 });
    for (const [id, title] of [['s1', '原故事'], ['s2', '目标故事']]) await db.saveArchiveStory({ ...db.buildStoryFromSession({ id: 'session-' + id,
      title, user: { name: '我' }, character: { name: '维护测试0' }, messages: [{ id: 'm1', role: 'assistant', content: '原始正文' }], createdAt: 1 }, 'c0'), id });
    await (await import('/src/lib/summary-db.ts')).saveSummary({ id: 'r1', bookId: 's1', bookTitle: '原故事', kind: 'diary', title: '需要移动的日记', content: '日记正文保留',
      floorStart: 5, floorEnd: 8, createdAt: 1, updatedAt: 1 });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /^精品\s*7$/ })).toBeVisible();
  await page.getByRole('button', { name: /^剧情\s*18$/ }).click();
  await expect(page.getByRole('button', { name: /^精品\s*6$/ })).toBeVisible();
  await page.screenshot({ path: `${output}/type-counts.png`, fullPage: true });
  await page.goto(base + '/character/c0');
  const sourceRow = page.locator('div').filter({ has: page.getByText('原故事', { exact: true }) }).filter({ has: page.getByRole('button', { name: '复制故事', exact: true }) }).last();
  await sourceRow.getByRole('button', { name: '复制故事', exact: true }).click();
  await expect(page.getByTitle('原故事（副本）', { exact: true })).toBeVisible();
  await page.goto(base + '/story/s1?view=diary');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  const move = page.getByRole('dialog');
  await move.getByLabel('目标故事', { exact: true }).selectOption('s2');
  await move.getByRole('button', { name: '移动', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(page.getByText('需要移动的日记', { exact: true })).toHaveCount(0);
  await page.goto(base + '/story/s2?view=diary');
  await expect(page.getByText('需要移动的日记', { exact: true })).toBeVisible();
  await expect(page.getByTitle('请先在编辑器关联目标楼层')).toBeDisabled();
  await page.screenshot({ path: `${output}/moved-diary.png`, fullPage: true });
  await page.getByTitle('删除', { exact: true }).click();
  await expect(page.getByRole('alertdialog').getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();

  // Switch this isolated browser fixture to a real file-backend instance using memory IO.
  await page.goto(base + '/settings');
  await page.evaluate(async () => {
    const { createMemFs } = await import('/src/lib/vault/fs.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const fs = createMemFs(); window.maintenanceFs = fs;
    setActiveVault(createVault(fs));
    const db = await import('/src/lib/archive-db.ts');
    await db.setArchiveSchemaVersion(2);
    await db.saveCharacter({ id: 'vc', name: '文件库测试', card: { name: '文件库测试' }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1 });
    await db.saveArchiveStory({ ...db.buildStoryFromSession({ id: 'vs-session', title: '保留文件故事', messages: [], user: { name: '我' }, character: { name: '文件库测试' }, createdAt: 1 }, 'vc'), id: 'vs' });
    history.pushState(null, '', '/character/vc'); window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByRole('button', { name: '删除故事', exact: true }).click();
  const deletion = page.getByRole('alertdialog');
  await expect(deletion.getByRole('checkbox')).not.toBeChecked();
  await expect(deletion.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled();
  await page.screenshot({ path: `${output}/delete-files.png`, fullPage: true });
  await deletion.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(deletion).toBeHidden();
  await page.evaluate(() => { history.pushState(null, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('button', { name: '数据与备份', exact: true }).click();
  await page.getByRole('button', { name: '检查文件', exact: true }).click();
  const panel = page.getByRole('region', { name: '文件检查与清理', exact: true });
  await expect(panel.getByText(/删除时保留的文件 ·/)).toBeVisible();
  await page.screenshot({ path: `${output}/file-maintenance.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: `${output}/maintenance-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.getByRole('button', { name: '选择可清理项', exact: true }).click();
  await panel.getByRole('button', { name: /^清理已选/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认清理', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('失败 0 项');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: ['18 cards / 6 premium count', 'copy story', 'move diary and detached range', 'IDB deletion dialog', 'vault retained deletion', 'settings scan and cleanup', 'mobile settings layout'], errors }));
} catch (error) {
  console.error(await page.locator('body').innerText());
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
