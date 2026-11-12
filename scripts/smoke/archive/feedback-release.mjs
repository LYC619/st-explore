import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4193';
const output = '.cache/feedback-release';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [], passed = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/https:\/\//, route => route.abort());
await page.route('**/feedback-test-completion', async route => {
  const body = route.request().postDataJSON(); requests.push(body);
  const content = JSON.stringify({ dimensions: ['设定完整度', '开场白与文笔', '角色魅力', '可玩性', '世界观一致性'].map(name => ({ name, score: 8, reason: '引用实际设定的评分理由，供界面保存验证。' })), note: '生成总评' });
  await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n` });
});
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  const longTitle = '这是一条需要保持完整内容但在阅读导航中省略的长备注标题'.repeat(8);
  await page.evaluate(async ({ longTitle, base }) => {
    const { performanceFixture } = await import('/src/test/performance-fixture.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const { setTourCompleted } = await import('/src/lib/tour-steps.ts');
    const { saveAPIConfig } = await import('/src/components/ai-tools/api-profiles.ts');
    const fixture = await performanceFixture(1, 1), vault = createVault(fixture.fs);
    const character = await vault.repo('characters').get('perf-c0');
    character.notes = [{ id: 'long', at: 1, body: `# ${longTitle}\n\n内容保留\n\n## 小标题\n\n片段` }];
    await vault.repo('characters').put(character);
    window.feedback = { vault, fs: fixture.fs };
    setActiveVault(vault); setTourCompleted('home'); setTourCompleted('preset');
    saveAPIConfig({ apiKey: 'fixture-only', apiUrl: `${base}/feedback-test-completion`, model: 'fixture-model' });
  }, { longTitle, base });

  await page.getByRole('button', { name: '内置提示词', exact: true }).click();
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '角色卡评分立场', exact: true }).click();
  await page.getByLabel('角色卡评分立场提示词').fill('本次验收自定义评分指令');
  await page.getByRole('button', { name: '世界书', exact: true }).click();
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '角色卡评分立场', exact: true }).click();
  await expect(page.getByLabel('角色卡评分立场提示词')).toHaveValue('本次验收自定义评分指令');
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await page.screenshot({ path: `${output}/prompt-settings.png` });
  passed.push('真实设置入口：切模块保留草稿并保存');

  await navigate('/character/perf-c0');
  const fold = page.getByRole('button', { name: '折叠角色卡图与信息', exact: true });
  await fold.click();
  await expect(page.locator('[data-character-info-rail="rail"]')).toHaveCSS('width', '48px');
  await navigate('/library'); await navigate('/character/perf-c0');
  await page.getByRole('button', { name: '展开角色卡图与信息', exact: true }).click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('tab', { name: /^备注/ }).click();
  const heading = page.getByRole('heading', { name: longTitle, exact: true });
  await expect(heading).toHaveCSS('text-overflow', 'ellipsis');
  await expect(heading).toHaveAttribute('title', longTitle);
  await expect(page.getByRole('navigation', { name: '备注目录' }).getByRole('button', { name: longTitle, exact: true })).toHaveCSS('white-space', 'nowrap');
  await page.getByRole('button', { name: '新建备注', exact: true }).click();
  const noteDialog = page.getByRole('dialog');
  expect((await noteDialog.boundingBox()).width).toBeGreaterThan(850);
  expect((await page.getByLabel('备注正文').boundingBox()).height).toBeGreaterThan(400);
  await page.getByLabel('备注正文').fill('# 写作空间验收\n\n' + '新的完整内容。'.repeat(30));
  await page.screenshot({ path: `${output}/notes-editor.png` });
  await noteDialog.getByRole('button', { name: '保存', exact: true }).click();
  expect(await page.evaluate(async () => (await window.feedback.vault.repo('characters').get('perf-c0')).notes.length)).toBe(2);
  passed.push('角色信息栏折叠与返回恢复；长标题省略且全文保留；大备注编辑器实际保存');

  await page.locator('[data-character-info-rail="rail"]').getByRole('button', { name: /评分/ }).click();
  const rating = page.getByRole('dialog');
  await rating.getByRole('tab', { name: '模板打分', exact: true }).click();
  const reasons = rating.locator('textarea[aria-label$="打分理由"]');
  await expect(reasons).toHaveCount(5);
  expect((await reasons.first().boundingBox()).height).toBeGreaterThanOrEqual(96);
  expect((await reasons.nth(1).boundingBox()).x).toBeGreaterThan((await reasons.first().boundingBox()).x + 100);
  await reasons.first().fill('手动输入的多行理由\n第二行\n第三行');
  await page.screenshot({ path: `${output}/rating-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rating).toHaveCount(0);
  await page.getByRole('button', { name: /评分/ }).first().click();
  await rating.getByRole('tab', { name: '模板打分', exact: true }).click();
  expect((await reasons.nth(1).boundingBox()).y).toBeGreaterThan((await reasons.first().boundingBox()).y);
  expect((await rating.boundingBox()).width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${output}/rating-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(rating).toHaveCount(0);
  await page.locator('[data-character-info-rail="rail"]').getByRole('button', { name: /评分/ }).click();
  await rating.getByRole('tab', { name: 'AI 评分', exact: true }).click();
  await rating.getByRole('button', { name: '生成 AI 建议', exact: true }).click();
  await expect(rating.getByRole('button', { name: '确认保存为正式评分' })).toBeVisible();
  expect(requests.at(-1).messages[0].content).toContain('本次验收自定义评分指令');
  await page.evaluate(async () => {
    const { saveBuiltinPrompt } = await import('/src/lib/builtin-prompts.ts');
    saveBuiltinPrompt('character.rating', '生成后改掉的指令');
  });
  await rating.getByRole('button', { name: '确认保存为正式评分' }).click();
  const detail = await page.evaluate(async () => (await window.feedback.vault.repo('characters').get('perf-c0')).ratingDetail);
  expect(detail.promptSnapshot).toContain('本次验收自定义评分指令');
  expect(detail.promptSnapshot).not.toContain('生成后改掉'); expect(detail.model).toBe('fixture-model');
  passed.push('评分桌面双列／窄屏单列；设置指令进入真实请求，保存保留生成时快照');

  await navigate('/assets?tab=preset');
  await page.getByRole('button', { name: '导入作者预设', exact: true }).click();
  const raw = { prompts: [{ identifier: 'p', name: '提示块', role: 'system', content: '作者正文' }], prompt_order: [], impersonation_prompt: '作者工具提示', extensions: { regex_scripts: [{ id: 'r', scriptName: '内置正则', findRegex: 'a', replaceString: 'b', placement: [2] }] } };
  await page.getByLabel('选择预设和附带文件').setInputFiles([
    { name: '作者新版.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) },
    { name: '说明.md', mimeType: 'text/markdown', buffer: Buffer.from('作者安装说明') },
    { name: '脚本.js', mimeType: 'text/javascript', buffer: Buffer.from('throw new Error("Do not execute");') },
  ]);
  const field = label => page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('input,textarea');
  await field('作者').fill('作者 A'); await field('系列').fill('日常'); await field('版本号').fill('v2'); await field('适配模型').fill('Claude, Gemini');
  await page.getByRole('button', { name: '导入 1 份预设', exact: true }).click();
  await expect(page.locator('[data-preset-details]')).toBeVisible();
  const originalId = await page.locator('[data-preset-details]').getAttribute('data-preset-details');
  await field('我的使用笔记').fill('自用验收记录');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出取用包', exact: true }).click();
  const zip = unzipSync(await readFile(await (await downloaded).path()));
  expect(Object.values(zip).map(bytes => strFromU8(bytes)).some(text => text.includes('作者安装说明'))).toBe(true);
  await page.getByRole('button', { name: '复制后 DIY', exact: true }).click();
  await page.getByRole('tab', { name: '格式与杂项', exact: true }).click();
  const prompt = page.locator('textarea').first(); await prompt.fill('我的 DIY 工具提示');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const diyId = new URL(page.url()).searchParams.get('assetId');
  await expect.poll(() => page.evaluate(async id => (await window.feedback.vault.repo('presets').get(id)).preset.originalData.impersonation_prompt, diyId)).toBe('我的 DIY 工具提示');
  expect(await page.evaluate(async id => (await window.feedback.vault.repo('presets').get(id)).preset.originalData.impersonation_prompt, originalId)).toBe('作者工具提示');
  await page.getByRole('button', { name: '返回预设库 / 管理资料与附件', exact: true }).click();
  await page.screenshot({ path: `${output}/preset-catalog.png` });
  passed.push('实际预设库多文件导入、版本模型资料、ZIP 下载内容和 DIY 原版保护');

  await navigate('/settings');
  await page.getByRole('button', { name: '内置提示词', exact: true }).click();
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '角色卡评分立场', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '恢复默认', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { getBuiltinPrompt, getBuiltinPromptDefault } = await import('/src/lib/builtin-prompts.ts');
    return getBuiltinPrompt('character.rating') === getBuiltinPromptDefault('character.rating');
  })).toBe(true);
  passed.push('设置恢复默认后运行时读取默认值');
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
