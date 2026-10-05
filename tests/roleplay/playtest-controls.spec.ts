import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let server: Server; let endpoint: string; let requests: { messages: unknown[] }[];
test.beforeAll(async () => {
  requests = [];
  server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `本地模拟回复 ${requests.length}` }, finish_reason: null }] })}\n\n`);
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/completion`;
});
test.afterAll(() => { server.closeAllConnections(); server.close(); });

test('visible branch and script controls keep live execution and persistence on the selected line', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async endpoint => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await import('/src/lib/archive-db.ts');
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'controls-test', name: '本地模拟', apiUrl: endpoint, apiKey: '', model: 'fixture' }], 'controls-test');
    const character = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: { name: '控制回归角色', first_mes: '主线独有内容', description: '' } }); await db.saveCharacter(character);
    const story = db.buildStoryFromSession({ id: 'main-session', title: '控制回归故事', createdAt: 1, user: { name: '旅人' }, character: { name: '控制回归角色' }, messages: [{ id: 'greeting', role: 'assistant', content: '主线独有内容' }] }, character.id);
    const branch = db.buildBranchFromSession({ ...structuredClone(story.session), id: 'branch-session', messages: [{ id: 'greeting', role: 'assistant', content: '分支独有内容' }] }, '另一个结局');
    story.branches = [branch]; await db.saveArchiveStory(story);
    const store = (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(story.id);
    const normalize = (await import('/src/lib/roleplay/helper-settings.ts')).normalizeHelperSettings;
    await store.write('.ste-control/roleplay/main/helpers.json', JSON.stringify(normalize({ scripts: [
      { type: 'script', id: 'running', name: '运行状态脚本', content: 'eventOn("unused",()=>{});', enabled: true, grants: [] },
      { type: 'script', id: 'error', name: '错误状态脚本', content: 'throw new Error("模拟脚本错误");', enabled: true, grants: [] },
      { type: 'script', id: 'disabled', name: '停用状态脚本', content: '', enabled: false, grants: [] },
    ] })));
    return { storyId: story.id, branchId: branch.id };
  }, endpoint);
  await page.goto(`/play/${fixture.storyId}?branch=`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('主线独有内容');
  await page.getByRole('button', { name: '脚本', exact: true }).click();
  await expect(tavern.locator('[data-script-id="running"] [data-helper-state="running"]')).toHaveText('运行中');
  await expect(tavern.locator('[data-script-id="error"] [data-helper-state="error"]')).toHaveText('运行错误');
  await expect(tavern.locator('[data-script-id="disabled"] [data-helper-state="disabled"]')).toHaveText('未启用');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await page.getByRole('button', { name: '分支', exact: true }).click();
  await tavern.locator('#ste_branch_select').selectOption({ label: '另一个结局' });
  await tavern.getByRole('button', { name: '切换分支', exact: true }).click();
  await expect(tavern.getByRole('button', { name: '切换分支', exact: true })).toBeHidden();
  await expect(tavern.locator('#chat')).toContainText('分支独有内容');
  await expect(page).toHaveURL(new RegExp(`branch=${fixture.branchId}`));
  await tavern.locator('#send_textarea').fill('只在分支继续'); await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('本地模拟回复 1');
  await expect(tavern.locator('#chat')).toContainText('只在分支继续');
  await page.getByRole('button', { name: '分支', exact: true }).click();
  await tavern.locator('#ste_branch_select').selectOption({ label: '主线' }); await tavern.getByRole('button', { name: '切换分支', exact: true }).click();
  await expect(tavern.getByRole('button', { name: '切换分支', exact: true })).toBeHidden();
  await expect(tavern.locator('#chat')).toContainText('主线独有内容');
  await tavern.locator('#send_textarea').fill('只在主线继续'); await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('本地模拟回复 2');
  await page.getByRole('button', { name: '分支', exact: true }).click();
  await tavern.locator('#ste_branch_select').selectOption({ label: '另一个结局' }); await tavern.getByRole('button', { name: '切换分支', exact: true }).click();
  await expect(tavern.getByRole('button', { name: '切换分支', exact: true })).toBeHidden();
  await expect(tavern.locator('#chat')).toContainText('本地模拟回复 1'); await expect(tavern.locator('#chat')).not.toContainText('只在主线继续');
  await page.getByRole('button', { name: '聊天工具', exact: true }).click();
  await expect(tavern.locator('#option_continue')).toBeVisible(); await expect(tavern.locator('#option_regenerate')).toBeVisible();
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), fixture.storyId);
  expect(saved.session.messages).toHaveLength(3); expect(saved.branches[0].session.messages).toHaveLength(3);
  expect(JSON.stringify(requests[0].messages)).toContain('分支独有内容'); expect(JSON.stringify(requests[1].messages)).toContain('主线独有内容');
});
