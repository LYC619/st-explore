import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:4215', out = '.cache/1105-diagnostics';
await mkdir(out, { recursive: true });
let server;
if (process.argv.includes('--serve')) {
  const { createServer } = await import('vite'); const { default: react } = await import('@vitejs/plugin-react-swc'); const { tavernFrontend } = await import('../tavern/vite-plugin.mjs');
  server = await createServer({ configFile: false, plugins: [tavernFrontend(), react()], resolve: { alias: { '@': path.resolve('src') } }, optimizeDeps: { entries: ['src/main.tsx'] }, cacheDir: 'node_modules/.vite-1105', server: { host: '127.0.0.1', port: 4215, strictPort: true, watch: null, hmr: false } });
  await server.listen();
}
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [], passed = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
await page.route(/https:\/\//, route => route.abort());
await page.route('**/fixture-diagnostics', async route => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS, GET' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  if (route.request().method() === 'GET') return route.fulfill({ headers, json: { data: [{ id: 'fixture-model' }] } });
  requests.push(route.request().postDataJSON()); const content = `第 ${requests.length} 次回复：请在庭院坐下。`;
  return route.fulfill({ headers, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 30 } } })}\n\ndata: [DONE]\n\n` });
});
const nav = url => page.evaluate(url => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, url);
const logs = () => page.evaluate(() => [...window.__STE_TAVERN_HOSTS__.values()][0].processLog.snapshot());
try {
  await page.goto(base + '/settings', { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.getByRole('button', { name: '显示', exact: true }).waitFor({ timeout: 120000 });
  const ids = await page.evaluate(async base => {
    const db = await import('/src/lib/archive-db.ts'); const front = await import('/src/lib/frontend-workbench.ts'); const store = await import('/src/lib/frontend-workbench-store.ts');
    localStorage.setItem('ste-play-guide-seen', '1');
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'test', name: '诊断测试', apiUrl: base + '/fixture-diagnostics', apiKey: 'diagnostic-secret', model: 'fixture-model' }], 'test');
    const card = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '庭院管理员', description: '照顾庭院的成年人', first_mes: '欢迎。', extensions: {} } }); await db.saveCharacter(card);
    const session = { id: 'diagnostics', title: '诊断故事', createdAt: 1, character: { name: card.name }, user: { name: '旅人' }, messages: [
      { id: 'a', role: 'assistant', content: '书房', rawData: { variables: [{ stat_data: { place: '书房', score: 1 } }] } },
      { id: 'b', role: 'assistant', content: '庭院', rawData: { swipe_id: 0, swipes: ['庭院', '公园'], variables: [{ stat_data: { place: '庭院', score: 2 } }, { stat_data: { place: '公园', score: 8 } }] } },
    ] };
    const story = db.buildStoryFromSession(session, card.id); await db.saveArchiveStory(story);
    const loaded = await store.loadFrontend(story.id, null);
    const html = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n<p id="place"></p><script>const v=getVariables();document.getElementById("place").textContent=v.stat_data?.place||"空变量";</script>\n</body></html>';
    await store.saveFrontend(story.id, null, { ...front.emptyFrontend(), rules: [front.newHtmlRule(html, '诊断前端')], variables: JSON.stringify({ stat_data: { place: '示例', score: 5 } }) }, loaded.text, loaded.revision, 'draft');
    return { story: story.id, card: card.id };
  }, base);
  await nav('/beautify'); await page.locator('#beautify-story').selectOption(ids.story);
  await page.getByRole('button', { name: '读取楼层快照', exact: true }).click();
  const preview = page.frameLocator('iframe[title="成品前端预览"]'); await expect(preview.locator('#place')).toHaveText('庭院');
  await page.getByRole('tab', { name: '示例变量', exact: true }).click();
  await page.getByRole('button', { name: '差异 (2)', exact: true }).click(); await expect(page.getByLabel('变量差异内容')).toContainText('书房'); await expect(page.getByLabel('变量差异内容')).toContainText('庭院');
  await page.getByLabel('搜索变量路径或值').fill('score'); await expect(page.getByLabel('变量差异内容')).toContainText('后：2'); await expect(page.getByLabel('变量差异内容')).not.toContainText('庭院');
  await page.getByLabel('预览候选', { exact: true }).selectOption('1'); await expect(page.getByLabel('变量差异内容')).toContainText('后：8');
  await page.getByRole('button', { name: '读取楼层快照', exact: true }).click(); await expect(preview.locator('#place')).toHaveText('公园');
  await page.getByLabel('预览尺寸', { exact: true }).selectOption('mobile'); await expect.poll(() => preview.locator('body').evaluate(() => innerWidth)).toBe(390);
  await page.getByLabel('预览测试数据').selectOption('empty'); await page.getByRole('button', { name: '读取楼层快照', exact: true }).click(); await expect(preview.locator('#place')).toHaveText('空变量');
  await page.getByLabel('预览测试数据').selectOption('long'); await page.getByRole('button', { name: '使用示例变量', exact: true }).click(); await expect.poll(() => preview.locator('#place').textContent().then(s => s.length)).toBeGreaterThan(100);
  await page.getByLabel('预览测试数据').selectOption('extreme'); await page.getByRole('button', { name: '使用示例变量', exact: true }).click();
  await expect.poll(() => preview.locator('body').evaluate(() => getVariables().stat_data.score)).toBe(999999999);
  passed.push('真实成品入口：变量树搜索、前一楼差异、候选切换、390px 和空／长数据预览');
  await page.getByRole('tab', { name: 'HTML／正则', exact: true }).click();
  const original = await page.locator('#frontend-html').inputValue();
  const broken = '<html>\n<head></head>\n<body>\n<script>\nthrow new Error("STE_EXPECTED_DIAGNOSTIC");\n</script>\n<img src="/missing-diagnostic-image.png">\n</body></html>';
  await page.locator('#frontend-html').fill(broken); await page.getByRole('button', { name: '使用示例变量', exact: true }).click();
  await expect(page.getByText(/STE_EXPECTED_DIAGNOSTIC/).first()).toBeVisible(); await expect(page.getByText(/资源加载失败/).first()).toBeVisible();
  await page.getByRole('button', { name: '定位源码', exact: true }).click();
  const line = await page.locator('#frontend-html').evaluate(e => e.value.slice(0, e.selectionStart).split('\n').length); expect(line).toBe(5);
  await page.locator('#frontend-html').fill(original); await page.getByRole('button', { name: '保存草稿', exact: true }).last().click();
  await page.locator('[toast-close]').click();
  await page.screenshot({ path: out + '/frontend.png' }); passed.push('真实 iframe 脚本／资源错误与第 5 行源码定位；草稿保存');
  await nav('/play/' + ids.story);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]'); await expect(tavern.locator('#send_textarea')).toBeVisible({ timeout: 60000 });
  for (let i = 0; i < 2; i++) {
    await tavern.locator('#send_textarea').fill('请继续 ' + i); await tavern.locator('#send_but').click();
    await expect.poll(async () => (await logs()).filter(r => r.events.some(e => e.stage === 'saved')).length, { timeout: 30000 }).toBe(i + 1);
  }
  const captured = await logs(); expect(captured.map(r => r.finalRequest.body)).toEqual(requests); expect(JSON.stringify(captured)).not.toContain('diagnostic-secret');
  await page.getByRole('button', { name: '过程', exact: true }).click(); const panel = page.getByRole('dialog', { name: '聊天过程' });
  await panel.getByRole('button', { name: '请求对照', exact: true }).click(); await expect(panel).toContainText('存在请求差异'); await expect(panel).toContainText('prompt_tokens');
  const downloading = page.waitForEvent('download'); await panel.getByRole('button', { name: '导出右侧快照', exact: true }).click();
  const download = await downloading; await download.saveAs(out + '/exported-request.json');
  expect(JSON.parse(await readFile(out + '/exported-request.json', 'utf8')).body).toEqual(requests.at(-1));
  await panel.locator('summary').filter({ hasText: '导入 SillyTavern 实际请求' }).click();
  await panel.getByLabel('粘贴 ST 请求 JSON').fill(JSON.stringify(requests.at(-1))); await panel.getByRole('button', { name: '读取粘贴请求', exact: true }).click(); await expect(panel).toContainText('已捕获请求一致');
  const changed = structuredClone(requests.at(-1)); changed.temperature = 1.99; changed.messages[0].content += '\n对照新增';
  await panel.getByLabel('导入请求 JSON 或 HAR').setInputFiles({ name: 'st-request.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) }); await expect(panel).toContainText('/temperature'); await expect(panel).toContainText('存在请求差异');
  await panel.locator('summary').filter({ hasText: /^消息 1 ·/ }).click(); await expect(panel).toContainText('对照新增');
  await panel.getByRole('button', { name: '估算消息 token', exact: true }).click(); await expect(panel).toContainText('消息 token 估算');
  await panel.getByLabel('左侧请求').selectOption('incoming'); await expect(panel).toContainText('更早的插件内部步骤不可见');
  await page.screenshot({ path: out + '/request.png' }); passed.push('两轮真实传输体与快照逐字段一致；ST 粘贴／文件导入、消息／参数差异、token 估算与实际用量');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => panel.evaluate(e => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= 391 && e.scrollWidth <= e.clientWidth; })).toBe(true);
  const mobileDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(mobileDocumentWidth).toBeLessThanOrEqual(391);
  await page.screenshot({ path: out + '/mobile.png' }); passed.push('390px 请求抽屉及聊天页面均无横向溢出');
  expect(errors.filter(e => !e.includes('STE_EXPECTED_DIAGNOSTIC'))).toEqual([]);
  await writeFile(out + '/result.json', JSON.stringify({ passed, errors, requestCount: requests.length, mobileDocumentWidth }, null, 2)); console.log(JSON.stringify({ passed, errors }));
} catch (e) { await page.screenshot({ path: out + '/failed.png' }); await writeFile(out + '/failure.json', JSON.stringify({ message: e.message.slice(0, 3000), passed, errors }, null, 2)); throw e; }
finally { await browser.close(); await server?.close(); }
