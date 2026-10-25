import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/playtest-followups';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.route(/https:\/\//, route => route.abort());
const errors = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const fixture = await performanceFixture(1, 1);
    const vault = createVault(fixture.fs);
    const character = await vault.repo('characters').get('perf-c0');
    character.notes = [
      { id: 'first', at: 1, body: '# 值得留存的对白\n\n**开篇**\n\n' + '长段落用于验证目录实际滚动。\n\n'.repeat(55) + '## 重逢\n\n第一处\n\n' + '后续片段。\n\n'.repeat(30) + '## 重逢\n\n第二处\n\n| 人物 | 片段 |\n| --- | --- |\n| 甲 | 乙 |' },
      { id: 'second', at: 2, body: '另一条简短备注' },
    ];
    await vault.repo('characters').put(character);
    for (const [id, volumeNumber] of [['volume-two', 2], ['volume-one', 1]]) await vault.repo('summaries').put({
      id, volumeNumber, title: id === 'volume-one' ? '第一卷记录' : '第二卷记录', kind: 'volume',
      bookId: 'perf-s0-0', bookTitle: '性能故事0-0', floorStart: 0, floorEnd: 47, content: '已有正文', createdAt: 1, updatedAt: volumeNumber * 10,
    });
    window.playtest = { vault, fs: fixture.fs };
    setActiveVault(vault);
  });

  await navigate('/character/perf-c0');
  await page.getByRole('button', { name: '总结', exact: true }).click();
  await expect(page.getByText('第一卷记录', { exact: true })).toBeVisible();
  expect(await page.getByText('第一卷记录', { exact: true }).evaluate((node) => !!(node.compareDocumentPosition([...document.querySelectorAll('*')].find(el => el.childNodes.length === 1 && el.textContent === '第二卷记录')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.getByRole('button', { name: '手动录入', exact: true }).click();
  await page.getByLabel('记录标题', { exact: true }).fill('部分楼层番外');
  await page.getByLabel('记录卷数类型', { exact: true }).selectOption('other');
  await page.getByLabel('记录正文', { exact: true }).fill('手动录入的番外正文');
  await page.getByLabel('覆盖起始楼', { exact: true }).fill('2');
  await page.getByLabel('覆盖结束楼', { exact: true }).fill('4');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('部分楼层番外', { exact: true })).toBeVisible();
  const captured = await page.evaluate(async () => (await window.playtest.vault.repo('summaries').list()).find(item => item.title === '部分楼层番外'));
  expect(captured).toMatchObject({ volumeCategory: 'other', floorStart: 2, floorEnd: 4, rangeDetached: false });
  passed.push('角色详情：卷序、手动选楼层、其他分类及真实文件保存');

  await page.getByRole('tab', { name: /^备注/ }).click();
  const nav = page.getByRole('navigation', { name: '备注目录', exact: true });
  await expect(nav).toBeVisible();
  const switcher = page.getByRole('navigation', { name: '切换备注', exact: true });
  await expect(nav).toContainText('没有小标题');
  await switcher.getByRole('button', { name: /值得留存的对白/ }).click();
  const sidebarBox = await page.getByRole('complementary', { name: '备注导航' }).boundingBox();
  const contentBox = await page.getByRole('heading', { name: '值得留存的对白', exact: true }).boundingBox();
  expect(sidebarBox.x).toBeGreaterThan(contentBox.x + contentBox.width);
  const beforeJump = await page.getByRole('heading', { name: '重逢', exact: true }).nth(1).boundingBox();
  expect(beforeJump.y).toBeGreaterThan(1000);
  await nav.getByRole('button', { name: '重逢', exact: true }).nth(1).click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('重逢');
  await expect.poll(() => page.evaluate(() => {
    const rect = document.activeElement.getBoundingClientRect();
    return rect.top >= 80 && rect.bottom < innerHeight - 24;
  })).toBe(true);
  await page.screenshot({ path: `${output}/notes-jump.png` });
  await page.getByRole('button', { name: '新建备注', exact: true }).click();
  await page.getByRole('dialog').locator('textarea').fill('# 新片段\n\n- **记住这句**');
  await page.getByRole('dialog').getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('dialog').locator('strong')).toHaveText('记住这句');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await navigate('/library');
  await navigate('/character/perf-c0');
  await page.getByRole('tab', { name: /^备注/ }).click();
  await expect(switcher.getByRole('button', { name: /新片段/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('heading', { name: '新片段', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '备注目录' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByRole('navigation', { name: '备注目录' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/notes-mobile.png` });
  await switcher.getByRole('button', { name: /值得留存的对白/ }).click();
  await page.getByRole('navigation', { name: '备注目录' }).getByRole('button', { name: '重逢', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => {
    const target = document.activeElement, rect = target.getBoundingClientRect();
    return target.textContent === '重逢' && target.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
  await page.screenshot({ path: `${output}/notes-mobile-jump.png` });
  passed.push('备注：长文目录实际滚动、Markdown 预览保存、返回恢复及窄屏');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigate('/story/perf-s0-0?view=volume');
  await page.getByRole('button', { name: '手动添加总结', exact: true }).click();
  await page.getByLabel('记录卷号', { exact: true }).fill('3');
  await page.locator('textarea[placeholder="生成的总结将显示在这里，可自由编辑。"] ').fill('工作台手动正文');
  await page.getByLabel('标题', { exact: true }).fill('第三卷手动');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByLabel('记录卷数类型', { exact: true }).selectOption('other');
  await page.getByRole('button', { name: '返回已生成总结', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '返回已生成总结', exact: true }).click();
  await expect(page.locator('span[title="第三卷手动"].flex-1')).toBeVisible();
  await page.getByRole('tab', { name: '角色日记', exact: true }).click();
  await page.getByRole('button', { name: '手动添加总结', exact: true }).click();
  await page.getByLabel('记录卷号', { exact: true }).fill('1');
  await page.locator('textarea[placeholder="生成的总结将显示在这里，可自由编辑。"] ').fill('第一卷日记');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '返回已生成总结', exact: true }).click();
  await page.getByRole('tab', { name: '展示页', exact: true }).click();
  await expect(page.getByText('第1卷', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/diary-gallery.png` });
  passed.push('总结工作台：显式手动添加、卷号保存、仅改分类的草稿保护、日记卷号展示');

  // 2026-10-25 新增待运行回归：必须从 /chat 真实入口收录，不能只挂弹窗。
  await page.evaluate(async () => {
    const { setTourCompleted } = await import('/src/lib/tour-steps.ts');
    setTourCompleted('home');
    const story = await window.playtest.vault.repo('archiveStories').get('perf-s0-0');
    const branchSession = structuredClone(story.session);
    branchSession.messages[0].content = '分支独有的来源内容';
    await window.playtest.vault.repo('archiveStories').put({
      ...story, id: 'capture-unbound', characterId: undefined, title: '未绑定收录故事',
      branches: [{ id: 'capture-branch', name: '收录分支', session: branchSession, markers: [], createdAt: 1, updatedAt: 1 }],
    });
  });
  for (const scenario of [
    { storyId: 'perf-s0-0', branchId: null, kind: 'volume', title: '编辑处理收录总结' },
    { storyId: 'capture-unbound', branchId: 'capture-branch', kind: 'diary', title: '编辑处理收录日记' },
  ]) {
    await navigate(`/chat?storyId=${scenario.storyId}${scenario.branchId ? `&branch=${scenario.branchId}` : ''}`);
    await page.getByRole('button', { name: '编辑第 0 楼', exact: true }).click();
    const edited = `${scenario.title}：刚编辑的原文`;
    await page.getByRole('dialog').locator('#content').fill(edited);
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '收录第 0 楼为总结或日记', exact: true }).click();
    await expect(page.getByLabel('记录正文', { exact: true })).toHaveValue(edited);
    await page.getByLabel('记录类型', { exact: true }).selectOption(scenario.kind);
    await page.getByLabel('记录标题', { exact: true }).fill(scenario.title);
    await page.getByLabel('记录正文', { exact: true }).fill(`${edited}（收录后编辑）`);
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await page.evaluate(async title => {
      const { createVault } = await import('/src/lib/vault/vault-backend.ts');
      return (await createVault(window.playtest.fs).repo('summaries').list()).find(item => item.title === title);
    }, scenario.title);
    expect(saved).toMatchObject({ bookId: scenario.storyId, kind: scenario.kind, content: `${edited}（收录后编辑）`, rangeDetached: true, source: { floor: 0 } });
    expect(saved.branchId ?? null).toBe(scenario.branchId);
    await navigate(`/story/${scenario.storyId}?view=${scenario.kind}`);
    await expect(page.locator(`span[title="${scenario.title}"].flex-1`)).toBeVisible();
  }
  passed.push('聊天处理真实入口：编辑后收录总结／日记、未绑定分支、文件重读与已存列表');

  await navigate('/settings');
  const settingsButtons = await page.getByRole('button').allTextContents();
  const dataTab = settingsButtons.find(text => /数据|存储/.test(text.trim()));
  if (dataTab) await page.getByRole('button', { name: dataTab, exact: true }).click();
  const panel = page.getByRole('region', { name: '文件检查与清理' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('每小时检查');
  passed.push('设置：库内回收站路径与保留规则');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
  await writeFile(`${output}/failure.txt`, (await page.locator('body').innerText()).slice(0, 18000));
  throw error;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed, errors }, null, 2));
  await browser.close();
}
