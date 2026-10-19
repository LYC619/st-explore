/* eslint-disable @typescript-eslint/no-explicit-any -- Browser fixtures inspect the original ST and user-installed plugin's untyped public objects. */
import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';

let server: Server;
let endpoint: string;
let requests: Record<string, any>[] = [];
let stoppedStreams = 0;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    let text = '';
    for await (const chunk of req) text += chunk;
    const request = JSON.parse(text);
    requests.push(request);
    if (request.tools?.length) {
      const phase = request.tools.at(-1).function.name;
      const observation = request.messages.filter(message => message.role === 'tool').at(-1);
      let name, args;
      if (phase === 'submit_context') {
        name = observation ? 'submit_context' : 'read_source';
        args = observation ? { references: ['r1'], reminders: ['只描述林知道的事情，保持第三人称。'] } : { id: 'world:fixture-world:2', offset: 0 };
      } else {
        const hasState = JSON.stringify(request.messages[1]).includes('memory:state.md');
        name = hasState && !observation ? 'read_source' : 'submit_memory';
        args = name === 'read_source' ? { id: 'memory:state.md', offset: 0 }
          : { changes: [{ path: 'state.md', body: '已发生：门外传来敲门声。\n地点：雨夜书店。\n在场：旅人、林。' }], worldbookVersions: [] };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'fixture-call', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }));
      return;
    }
    if (request.model === 'fixture-baibai-tool') {
      const summary = { summary: '旅人在雨夜到访书店，林递给旅人一把铜钥匙。', timeStart: '2026-09-12 20:00', timeEnd: '2026-09-12 20:05',
        location: '雨夜书店', locationPath: ['城镇', '雨夜书店'], items: { add: [{ name: '铜钥匙', qty: 1, carried: true }] },
        npcs: { add: [{ name: '林', title: '书店店主', location: '雨夜书店', important: true }] },
        scenes: { add: [{ path: ['城镇', '雨夜书店'], desc: '雨夜仍然开门的书店' }] },
        plans: { add: [{ kind: 'suspense', content: '查明敲门者身份' }] }, vars: [{ op: 'set', path: '信任', value: 2 }] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(summary) }, finish_reason: 'stop' }] }));
      return;
    }
    const lastText = request.messages.filter(message => message.role === 'user').at(-1)?.content ?? request.messages.at(-1)?.content ?? '';
    if (lastText.includes('模拟失败')) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '本地测试限流' } }));
      return;
    }
    if (request.stream !== true) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '门外传来轻轻的敲门声。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 10 } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (lastText.includes('请求慢速回复')) {
      const chunk = (content: string) => res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n');
      chunk('这是一段');
      // ST renders at its configured FPS. A second delayed token crosses its render interval.
      const tokenTimer = setTimeout(() => chunk('尚未完成的回复'), 120);
      const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 30_000);
      res.on('close', () => { clearTimeout(timer); clearTimeout(tokenTimer); stoppedStreams += 1; });
      return;
    }
    const chunks = lastText.includes('测量流式写入') ? [...Array(80).fill('风声掠过廊檐。'), '门外传来轻轻的敲门声。'] : ['门外传来', '轻轻的敲门声。'];
    for (const content of chunks) {
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n');
    }
    res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/exact-completion`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
test.beforeEach(async ({ page }) => {
  requests = []; stoppedStreams = 0;
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
});

async function seed(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('ste-tag-migration-v2-notice', '1');
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (String(url).includes('tavern.html')) console.error('Unexpected document XHR', method, String(url), new Error().stack);
      return open.call(this, method, url, ...rest);
    };
  });
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  return page.evaluate(async endpoint => {
    localStorage.setItem('ste-play-guide-seen', '1');
    const db = await import('/src/lib/archive-db.ts');
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    profiles.persistProfiles([{ id: 'browser-test', name: '本地测试模型', apiUrl: endpoint, apiKey: '', model: 'fixture-model' }], 'browser-test');
    const character = db.buildCharacterFromCard({ spec: 'chara_card_v3', data: {
      name: '林', description: '你是雨夜书店的店主林。', first_mes: '请进，外面在下雨。',
      personality: '沉稳', scenario: '雨夜书店', mes_example: '', extensions: {},
    } });
    await db.saveCharacter(character);
    const story = db.buildStoryFromSession({ id: 'browser-session', title: '雨夜书店', createdAt: 1,
      user: { name: '旅人' }, character: { name: '林' },
      messages: [{ id: 'greeting', role: 'assistant', content: '请进，外面在下雨。' }],
    }, character.id);
    await db.saveArchiveStory(story);
    return story.id;
  }, endpoint);
}

test('original Tavern opens a STE story, streams a reply and persists it for reopening', async ({ page }, info) => {
  const logs: string[] = [];
  page.on('pageerror', error => logs.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') logs.push(message.text()); });
  try {
    const storyId = await seed(page);
    await page.goto(`/play/${storyId}`);
    const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
    await expect(tavern.locator('#send_textarea')).toBeVisible();
    await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
    expect(logs.filter(message => message.includes('Unexpected document XHR'))).toEqual([]);
    await tavern.locator('#send_textarea').fill('门外有人吗？');
    await tavern.locator('#send_but').click();
    await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
    await page.getByRole('button', { name: '返回聊天处理' }).click();
    await expect(page).toHaveURL(new RegExp('/chat\\?'));
    const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
    expect(saved.session.messages.map((message: any) => message.content)).toEqual([
      '请进，外面在下雨。', '门外有人吗？', '门外传来轻轻的敲门声。',
    ]);
    expect(saved.session.messages[0].id).toBe('greeting');
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe('fixture-model');
    expect(requests[0].messages.some((message: any) => message.content.includes('门外有人吗？'))).toBe(true);
    await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
    await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
    expect(logs).toEqual([]);
    const screenshotPath = info.outputPath('classic-play.png');
    await page.screenshot({ path: screenshotPath });
    await info.attach('classic-play', { path: screenshotPath, contentType: 'image/png' });
  } finally {
    const logPath = info.outputPath('browser-errors.txt');
    await writeFile(logPath, logs.join('\n'));
    await info.attach('browser-errors', { path: logPath, contentType: 'text/plain' });
  }
});

test('a delayed welcome template cannot insert its panel or greeting into an opened story', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const storyId = await seed(page);
  await page.route('**/scripts/templates/welcomePanel.html', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({ response });
  });
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat .mes')).toHaveCount(1);
  await expect(tavern.locator('#ste_play_mode')).toBeAttached();
  await tavern.locator('#send_textarea').fill('等待迟到模板');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat .mes')).toHaveCount(3);
  await expect(tavern.locator('#chat .welcomePanel')).toHaveCount(0);
  await expect(tavern.locator('dialog[open]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a character without archived chats starts a new story using the original greeting', async ({ page }) => {
  const oldId = await seed(page);
  const characterId = await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts'), story = await db.getArchiveStory(id);
    await (await import('/src/lib/repo/index.ts')).getCurrentRepo('archiveStories').remove(id);
    return story.characterId;
  }, oldId);
  await page.goto(`/character/${characterId}`);
  await page.getByRole('button', { name: '新开聊天', exact: true }).click();
  await expect(page).toHaveURL(/\/play\//);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await tavern.locator('#send_textarea').fill('你好，我来借本书。'); await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  const stories = await page.evaluate(async () => (await import('/src/lib/archive-db.ts')).getAllArchiveStories());
  expect(stories).toHaveLength(1); expect(stories[0].characterId).toBe(characterId);
  expect(stories[0].session.messages.map(message => message.content)).toEqual(['请进，外面在下雨。', '你好，我来借本书。', '门外传来轻轻的敲门声。']);
  expect(stories[0].session.rawMetadata.chat_metadata).not.toHaveProperty('ste_pending_initial_greeting');
  await page.goto(`/play/${stories[0].id}`);
  await expect(tavern.locator('#chat .mes')).toHaveCount(3);
});

test('Agent mode automatically reads green lore, freezes actual provider context and commits sourced file memory', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const storyId = await seed(page);
  await page.evaluate(async ({ storyId, endpoint }) => {
    const db = await import('/src/lib/archive-db.ts');
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    profiles.persistProfiles([
      { id: 'browser-test', name: '正文模型', apiUrl: endpoint, apiKey: '', model: 'fixture-model' },
      { id: 'browser-tools', name: '工具模型', apiUrl: endpoint, apiKey: '', model: 'fixture-tools' },
    ], 'browser-test');
    const repo = await import('/src/lib/repo/index.ts');
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    await repo.getCurrentRepo('worldbooks').put({ id: 'fixture-world', title: '书店规则', createdAt: 1, updatedAt: 1, stGlobal: true,
      worldbook: parseWorldBook({ entries: {
        1: { uid: 1, constant: true, disable: false, content: '蓝灯：林是书店店主。', position: 4, depth: 2 },
        2: { uid: 2, constant: false, disable: false, key: ['绝不会匹配的关键词'], content: '绿灯原文：北门只能从里侧打开。', position: 4, depth: 2 },
      } }) });
    await db.saveRoleplayPreferences({ toolProfileId: 'browser-tools', tavern: { world_info_settings: { world_info: { globalSelect: ['书店规则'] } } } });
  }, { storyId, endpoint });
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_runtime_settings .inline-drawer-toggle').click();
  await tavern.locator('#ste_play_mode').selectOption('agent');
  await expect(tavern.locator('#ste_memory_owner')).toHaveValue('native-agent');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#send_textarea').fill('去看看北门。');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
  const readMemory = () => page.evaluate(async id => (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id).read('memory/main/state.md'), storyId);
  await expect.poll(readMemory).toContain('门外传来敲门声');
  const first = requests.filter(request => request.model === 'fixture-model')[0];
  expect(JSON.stringify(first.messages)).toContain('蓝灯：林是书店店主。');
  expect(JSON.stringify(first.messages)).toContain('绿灯原文：北门只能从里侧打开。');
  expect(JSON.stringify(first.messages)).not.toContain('tool_calls');
  await tavern.locator('#send_textarea').fill('问林门外是谁。');
  await tavern.locator('#send_but').click();
  await expect.poll(() => requests.filter(request => request.model === 'fixture-model').length).toBe(2);
  const second = requests.filter(request => request.model === 'fixture-model')[1];
  const firstSupplement = first.messages.findIndex(message => message.content?.includes('本轮背景资料'));
  expect(firstSupplement).toBeGreaterThan(0);
  expect(second.messages.slice(0, firstSupplement + 1)).toEqual(first.messages.slice(0, firstSupplement + 1));
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(/\/chat\?/);
  const memory = await readMemory();
  expect(memory).toContain('sourceRefs:');
  expect(memory).toContain('revision: 2');
  expect(errors).toEqual([]);
  await info.attach('agent-provider-requests', { body: JSON.stringify(requests, null, 2), contentType: 'application/json' });
});

test('classic mode uses the linked preset, depth lore and original regex editor without losing WI placement', async ({ page }, info) => {
  const storyId = await seed(page);
  await page.evaluate(async storyId => {
    const db = await import('/src/lib/archive-db.ts');
    const { getCurrentRepo } = await import('/src/lib/repo/index.ts');
    const { stScriptToRule } = await import('/src/lib/st-regex-interop.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    const defaults = await (await fetch('/ste/tavern-defaults.json')).json();
    const preset = structuredClone(defaults.presets.openai_preset[0].data);
    preset.prompts.find(prompt => prompt.identifier === 'main').content = 'PRESET_ACTIVE：保持沉稳的第三人称叙事。';
    await getCurrentRepo('presets').put({ id: 'classic-preset', title: '经典预设', preset: parsePreset(preset), createdAt: 1, updatedAt: 1 });
    await getCurrentRepo('regexes').put({ id: 'classic-regex', title: '故事词汇', createdAt: 1, updatedAt: 1,
      rules: [stScriptToRule({ id: 'user-rule', scriptName: '替换用户暗号', findRegex: '/暗号/g', replaceString: '约定信号', placement: [1], promptOnly: true }),
        stScriptToRule({ id: 'world-rule', scriptName: '替换世界书晨曦', findRegex: '/晨曦/g', replaceString: '暮色', placement: [5], promptOnly: true, futureField: 'preserved' })] });
    await getCurrentRepo('worldbooks').put({ id: 'classic-world', title: '经典世界书', createdAt: 1, updatedAt: 1, stGlobal: false,
      worldbook: parseWorldBook({ entries: {
        1: { uid: 1, constant: true, disable: false, content: 'BLUE_STABLE：书店在城北。', position: 0 },
        2: { uid: 2, constant: false, disable: false, key: ['暗号', '约定信号'], content: 'GREEN_DEPTH：晨曦之门只向{{user}}开启。', position: 4, depth: 1, role: 0 },
      } }) });
    await db.updateArchiveStory(storyId, story => ({ assets: [...story.assets ?? [], { kind: 'regex', assetId: 'classic-regex' }, { kind: 'preset', assetId: 'classic-preset' }, { kind: 'worldbook', assetId: 'classic-world' }] }));
  }, storyId);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_play_mode')).toBeAttached();
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('.regex_settings > .inline-drawer > .inline-drawer-toggle').click();
  const rule = tavern.locator('#saved_regex_scripts .regex-script-label').filter({ hasText: '替换世界书晨曦' });
  await rule.locator('.edit_existing_regex').click();
  await tavern.locator('dialog[open] .regex_replace_string').fill('夜色');
  await tavern.locator('dialog[open] .popup-button-ok').click();
  await expect.poll(() => page.evaluate(async () => (await (await import('/src/lib/repo/index.ts')).getCurrentRepo('regexes').get('classic-regex')).rules[1].replaceString)).toBe('夜色');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#send_textarea').fill('我说出暗号，走向北门。');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
  const request = requests[0];
  expect(JSON.stringify(request.messages)).toContain('PRESET_ACTIVE');
  expect(JSON.stringify(request.messages)).toContain('BLUE_STABLE');
  expect(JSON.stringify(request.messages)).toContain('GREEN_DEPTH：夜色之门只向旅人开启。');
  expect(JSON.stringify(request.messages)).toContain('我说出约定信号');
  expect(request.tools).toBeUndefined();
  const script = await page.evaluate(async () => {
    const rule = (await (await import('/src/lib/repo/index.ts')).getCurrentRepo('regexes').get('classic-regex')).rules[1];
    return (await import('/src/lib/st-regex-interop.ts')).ruleToSTScript(rule);
  });
  expect(script).toMatchObject({ id: 'world-rule', placement: [5], futureField: 'preserved' });
  await info.attach('classic-actual-request', { body: JSON.stringify(request, null, 2), contentType: 'application/json' });
});

test('built-in helper scripts and HTML use scoped variables and clean up on chat reload', async ({ page }, info) => {
  test.setTimeout(120_000);
  const storyId = await seed(page);
  await page.evaluate(async ({ id, endpoint }) => {
    const db = await import('/src/lib/archive-db.ts');
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    profiles.persistProfiles([
      { id: 'browser-test', name: '正文模型', apiUrl: endpoint, apiKey: '', model: 'fixture-model' },
      { id: 'browser-helper', name: '工具模型', apiUrl: endpoint, apiKey: '', model: 'fixture-helper-tool' },
    ], 'browser-test');
    await db.saveRoleplayPreferences({ toolProfileId: 'browser-helper' });
    await db.updateArchiveStory(id, story => ({ session: { ...story.session, messages: story.session.messages.map(message => ({ ...message,
      content: '请进，外面在下雨。\n```html\n<button id="trust">信任 +5</button><script>document.querySelector("#trust").onclick=async()=>{const v=getVariables();replaceVariables({...v,trust:(v.trust??0)+5});await flushHelperWrites();document.querySelector("#trust").textContent="已记录";};</script>\n```',
    })) } }));
  }, { id: storyId, endpoint });
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_helper_settings')).toBeAttached();
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_helper_settings .inline-drawer-toggle').click();
  await tavern.locator('#ste_helper_import').setInputFiles({ name: 'helper.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'script', id: 'fixture-helper', name: '状态助手', enabled: true,
    content: `eventOn(getButtonEvent("记一笔"), async () => {
      let isolated = false; try { parent.document.body; } catch { isolated = true; }
      const v = getVariables(); replaceVariables({ ...v, trust: (v.trust ?? 0) + 1, isolated });
      if (getVariables().trust !== (v.trust ?? 0) + 1) throw new Error("同步快照失效");
      replaceVariables({ count: 1 }, { type: "script" }); await flushHelperWrites();
      await setChatMessages([{ message_id: 0, data: { checked: true } }], { refresh: "none" });
    });
    eventOn(getButtonEvent("工具检查"), async () => {
      const result = await generate({ user_input: "检查场景" });
      replaceVariables({ ...getVariables(), helperResult: result }); await flushHelperWrites();
    });
    eventOn(getButtonEvent("权限检查"), async () => {
      const blocked = [];
      for (const action of [() => triggerSlash("/getvar trust"), () => generate({ user_input: "不可发送" })]) {
        try { await action(); } catch (error) { blocked.push(error.message.includes("read")); }
      }
      document.body.dataset.permissionChecks = JSON.stringify(blocked);
    });`,
    button: { enabled: true, buttons: ['记一笔', '工具检查', '权限检查'].map(name => ({ name, visible: true })) },
  })) });
  const script = tavern.locator('.ste-helper-script[data-script-id="fixture-helper"]');
  await expect(script.getByLabel('启用 状态助手')).not.toBeChecked();
  await script.getByLabel('修改资料', { exact: true }).check();
  await script.getByLabel('启用 状态助手').check();
  await script.getByRole('button', { name: '记一笔', exact: true }).click();
  const readStory = () => page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  await expect.poll(async () => (await readStory()).session.rawMetadata.chat_metadata.variables).toEqual({ trust: 1, isolated: true });
  await expect.poll(async () => (await readStory()).session.messages[0].rawData.variables?.[0]).toEqual({ checked: true });
  const readScriptData = () => page.evaluate(async id => JSON.parse(await (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id)
    .read('.ste-control/roleplay/main/helpers.json')).scripts[0].data, storyId);
  await expect.poll(readScriptData).toEqual({ count: 1 });
  // The row was rendered before the script wrote its own data. Toggling it must preserve that write.
  await script.getByLabel('启用 状态助手').uncheck();
  await expect(script.getByLabel('启用 状态助手')).not.toBeChecked();
  expect(await readScriptData()).toEqual({ count: 1 });
  await script.getByLabel('调用工具模型', { exact: true }).check();
  await script.getByLabel('启用 状态助手').check();
  await script.getByRole('button', { name: '工具检查', exact: true }).click();
  await expect.poll(async () => (await readStory()).session.rawMetadata.chat_metadata.variables.helperResult).toBe('门外传来轻轻的敲门声。');
  expect(requests).toHaveLength(1); expect(requests[0].model).toBe('fixture-helper-tool');
  expect((await readStory()).session.messages).toHaveLength(1);
  await script.getByLabel('读取剧情', { exact: true }).uncheck();
  await script.getByRole('button', { name: '权限检查', exact: true }).click();
  await expect.poll(() => page.frames().find(frame => frame.name() === '' && frame.url() === 'about:srcdoc')
    ?.evaluate(() => document.body.dataset.permissionChecks)).toBe('[true,true]');
  expect(requests).toHaveLength(1);
  await script.getByLabel('读取剧情', { exact: true }).check();
  await tavern.locator('#ste_helper_html').getByLabel('修改资料', { exact: true }).check();
  await tavern.getByLabel('运行 HTML 交互代码块', { exact: true }).check();
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  const html = tavern.frameLocator('.ste-helper-html iframe');
  await html.getByRole('button', { name: '信任 +5' }).click();
  await expect(html.getByRole('button', { name: '已记录' })).toBeVisible();
  await expect.poll(async () => (await readStory()).session.rawMetadata.chat_metadata.variables.trust).toBe(6);
  const frame = page.frames().find(frame => frame.url().includes('tavern.html'))!;
  // PromptManager adds a SETTINGS_UPDATED once-listener on each chat load.
  // Measure after the debounced save settles so temporary save waiters are drained.
  await frame.evaluate(async () => { await window.__STE_TAVERN_FLUSH__(); });
  const before = await frame.evaluate(() => window.__STE_HELPER_STATE__());
  for (let i = 0; i < 50; i++) {
    await frame.evaluate(async () => { await (await import('/script.js')).reloadCurrentChat(); });
    await expect.poll(() => frame.evaluate(() => window.__STE_HELPER_STATE__().scriptFrames)).toBe(1);
  }
  await frame.evaluate(async () => { await window.__STE_TAVERN_FLUSH__(); });
  const after = await frame.evaluate(() => window.__STE_HELPER_STATE__());
  const lifecyclePath = info.outputPath('helper-lifecycle.json');
  await writeFile(lifecyclePath, JSON.stringify({ reloads: 50, before, after }, null, 2));
  await info.attach('helper-lifecycle', { path: lifecyclePath, contentType: 'application/json' });
  expect(after.listeners).toBe(before.listeners); expect(after.listenerCounts).toEqual(before.listenerCounts);
  expect(after.pending).toBe(0); expect(after.htmlFrames).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '关闭聊天', exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  expect(page.frames()).toHaveLength(1);
});

test('complete story package downloads from Tavern and restores through the STE library', async ({ page }) => {
  test.setTimeout(90_000);
  const storyId = await seed(page);
  await page.evaluate(async id => {
    const { createRuntimeStore } = await import('/src/lib/roleplay/runtime-store.ts');
    await createRuntimeStore(id).write('memory/main/style.md', '# 文风\n保持沉稳，角色只知道亲历的事情。');
    const db = await import('/src/lib/archive-db.ts');
    await db.updateArchiveStory(id, story => ({ branches: [db.buildBranchFromSession({ ...structuredClone(story.session), id: 'package-branch-session' }, '另一条路')] }));
  }, storyId);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_story_export')).toBeAttached();
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_story_package_settings .inline-drawer-toggle').click();
  const download = page.waitForEvent('download');
  await tavern.locator('#ste_story_export').click();
  const savedFile = await download, content = await readFile((await savedFile.path())!, 'utf8'), pack = JSON.parse(content);
  expect(savedFile.suggestedFilename()).toMatch(/\.ste-play$/);
  expect(pack).toMatchObject({ format: 'ste-play', version: 1, story: { id: storyId } });
  expect(pack.story.branches).toHaveLength(1);
  expect(pack.files.find(file => file.path === 'memory/main/style.md').text).toContain('保持沉稳');
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(/\/chat\?/);
  await page.evaluate(async pack => {
    const { getCurrentRepo } = await import('/src/lib/repo/index.ts');
    const { createRuntimeStore } = await import('/src/lib/roleplay/runtime-store.ts');
    const store = createRuntimeStore(pack.story.id);
    for (const path of await store.list()) await store.remove(path);
    await getCurrentRepo('archiveStories').remove(pack.story.id);
    for (const character of pack.characters) await getCurrentRepo('characters').remove(character.id);
  }, pack);
  await page.goto('/library');
  await page.getByLabel('选择完整故事包', { exact: true }).setInputFiles({ name: savedFile.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(content) });
  await expect(page.getByRole('dialog')).toContainText('雨夜书店');
  await expect(page.getByRole('dialog')).toContainText('新增');
  await page.getByRole('button', { name: '确认导入故事包', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/story/' + storyId));
  const restored = await page.evaluate(async id => ({ story: await (await import('/src/lib/archive-db.ts')).getArchiveStory(id),
    memory: await (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id).read('memory/main/style.md') }), storyId);
  expect(restored.story.branches[0].id).toBe(pack.story.branches[0].id);
  expect(restored.story.session.messages[0].id).toBe('greeting');
  expect(restored.memory).toBe(pack.files.find(file => file.path === 'memory/main/style.md').text);
});

test('original chat history exports raw JSONL and character import opens the STE library after saving edits', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_story_export')).toBeAttached();
  await tavern.locator('#options_button').click();
  await tavern.locator('#option_select_chat').click();
  const download = page.waitForEvent('download');
  await tavern.locator('#select_chat_div .exportRawChatButton').first().click();
  const saved = await download, raw = await readFile((await saved.path())!, 'utf8');
  expect(saved.suggestedFilename()).toMatch(/\.jsonl$/);
  const rows = raw.trim().split('\n').map(row => JSON.parse(row));
  expect(rows[1]).toMatchObject({ mes: '请进，外面在下雨。', extra: { ste_runtime: { messageId: 'greeting' } } });
  await tavern.locator('#select_chat_cross').click();
  const message = tavern.locator('#chat .mes').first();
  await message.hover(); await message.locator('.mes_edit').click(); await message.locator('.edit_textarea').fill('离开导入角色前保存这句话。');
  await tavern.locator('#rightNavHolder > .drawer-toggle').click();
  await tavern.locator('#rm_button_characters').click();
  await tavern.locator('#character_import_button').click();
  await expect(page).toHaveURL(/\/library$/);
  const persisted = await page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages[0].content, storyId);
  expect(persisted).toBe('离开导入角色前保存这句话。');
});

test('a 2000-message story stays virtualized with bounded Agent input and no per-token story writes', async ({ page }, info) => {
  test.setTimeout(120_000);
  const storyId = await seed(page);
  await page.evaluate(async ({ id, endpoint }) => {
    const db = await import('/src/lib/archive-db.ts');
    await db.updateArchiveStory(id, story => ({ session: { ...story.session, messages: Array.from({ length: 2000 }, (_, i) => ({
      id: `long-${i}`, role: i % 2 ? 'assistant' : 'user',
      content: `第 ${i} 楼：风掠过书店的廊檐。旅人与林谈起城北的道路，约定等雨停后再出发。`,
    })) } }));
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    await (await import('/src/lib/repo/index.ts')).getCurrentRepo('worldbooks').put({ id: 'fixture-world', title: '长篇世界书', createdAt: 1, updatedAt: 1, stGlobal: true,
      worldbook: parseWorldBook({ entries: { 2: { uid: 2, constant: false, key: ['北门'], content: '北门从里侧打开。', position: 4, depth: 2 } } }) });
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    profiles.persistProfiles([
      { id: 'browser-test', name: '正文模型', apiUrl: endpoint, apiKey: '', model: 'fixture-model' },
      { id: 'browser-tools', name: '工具模型', apiUrl: endpoint, apiKey: '', model: 'fixture-tools' },
    ], 'browser-test');
    await db.saveRoleplayPreferences({ toolProfileId: 'browser-tools', tavern: { oai_settings: { openai_max_context: 32000 } } });
  }, { id: storyId, endpoint });
  const started = Date.now();
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_play_mode')).toBeAttached();
  await expect(tavern.locator('#chat')).toContainText('第 1999 楼');
  const openMs = Date.now() - started;
  const frame = page.frames().find(frame => frame.url().includes('tavern.html'))!;
  expect(await frame.evaluate(async () => (await import('/script.js')).chat.length)).toBe(2000);
  const mountedRows = await tavern.locator('#chat .mes').count();
  expect(mountedRows).toBeLessThan(200);
  await page.evaluate(() => {
    window.__STE_TEST_STORY_WRITES__ = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...rest) {
      if (this.name === 'archiveStories') window.__STE_TEST_STORY_WRITES__.push({ at: performance.now(), messages: value.session?.messages.length });
      return put.call(this, value, ...rest);
    };
  });
  await tavern.locator('#send_textarea').fill('测量流式写入，请继续。'); await tavern.locator('#send_but').click();
  const readLength = () => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages.length, storyId);
  await expect.poll(readLength, { timeout: 40_000 }).toBe(2002);
  const writes = await page.evaluate(() => window.__STE_TEST_STORY_WRITES__);
  expect(writes.length).toBeLessThanOrEqual(5);
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_runtime_settings .inline-drawer-toggle').click();
  await tavern.locator('#ste_play_mode').selectOption('agent');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#send_textarea').fill('去看看北门。'); await tavern.locator('#send_but').click();
  await expect.poll(readLength, { timeout: 40_000 }).toBe(2004);
  await expect.poll(() => page.evaluate(async id => (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id).read('memory/main/state.md'), storyId), { timeout: 30_000 }).toContain('门外传来敲门声');
  const toolRequests = requests.filter(request => request.tools?.length), toolBytes = toolRequests.map(request => Buffer.byteLength(JSON.stringify(request)));
  expect(toolRequests.length).toBeGreaterThan(1);
  expect(Math.max(...toolBytes)).toBeLessThan(64 * 1024);
  expect(JSON.stringify(toolRequests)).not.toContain('第 100 楼');
  const measurements = JSON.stringify({ logicalMessages: 2000, openMs, mountedRows,
    streamChunks: 81, storyWritesDuringReply: writes, toolRequestBytes: toolBytes,
    writerRequestMessages: requests.filter(request => request.model === 'fixture-model').map(request => request.messages.length) }, null, 2);
  const measurementPath = info.outputPath('long-story-measurements.json');
  await writeFile(measurementPath, measurements);
  await info.attach('long-story-measurements', { path: measurementPath, contentType: 'application/json' });
});

test('helper download and project links reach the parent external browser bridge', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进');
  await page.evaluate(() => {
    (window as any).openedLinks = [];
    window.open = ((url, target, features) => { (window as any).openedLinks.push({ url, target, features }); return null; }) as typeof window.open;
  });
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_original_extensions .inline-drawer-toggle').click();
  await tavern.getByRole('link', { name: '下载已验证的 4.11.3 原版 ZIP' }).click();
  await tavern.getByRole('link', { name: '原项目与说明', exact: true }).click();
  const links = await page.evaluate(() => (window as any).openedLinks);
  expect(links).toEqual([
    { url: 'https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/87ca341a2a2279f4c18cd1918c5ae9dbd1dac492', target: '_blank', features: 'noopener,noreferrer' },
    { url: 'https://github.com/N0VI028/JS-Slash-Runner', target: '_blank', features: 'noopener,noreferrer' },
  ]);
});

test('Markdown prose keeps two-character indentation on every reading paragraph', async ({ page }, info) => {
  const storyId = await seed(page);
  await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts');
    await db.updateArchiveStory(id, current => ({ session: { ...current.session, messages: [{ id: 'greeting', role: 'assistant',
      content: '第一段正文。\n第二段正文。\n\n**第三段加粗。**\n\n- 列表项目\n\n```text\n代码保持原样\n```',
    }] } }));
  }, storyId);
  await page.goto(`/story/${storyId}`);
  const paragraphs = page.locator('.reading-flow .reading-paragraph');
  await expect(paragraphs).toHaveCount(3);
  for (const paragraph of await paragraphs.all()) {
    const geometry = await paragraph.evaluate(p => {
      const first = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode()!;
      const range = document.createRange(); range.setStart(first, 0); range.setEnd(first, 1);
      return { offset: range.getBoundingClientRect().left - p.getBoundingClientRect().left, size: parseFloat(getComputedStyle(p).fontSize) };
    });
    expect(geometry.offset).toBeCloseTo(geometry.size * 2, 0);
  }
  await expect(page.locator('.chat-markdown li')).toHaveCSS('text-indent', '0px');
  await expect(page.locator('.chat-markdown pre')).toHaveCSS('text-indent', '0px');
  await page.screenshot({ path: info.outputPath('paragraph-indent.png') });
});

for (const stream of [true, false]) test(`native overswipe generates and reopens candidates without a branch (stream=${stream})`, async ({ page }) => {
  const storyId = await seed(page);
  await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts');
    await db.updateArchiveStory(id, current => ({ session: { ...current.session, messages: [...current.session.messages,
      { id: 'user', role: 'user', content: '门外有人吗？' },
      { id: 'reply', role: 'assistant', content: '原来的回答' },
    ] } }));
  }, storyId);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').last();
  await expect(message.locator('.mes_text')).toHaveText('原来的回答');
  const frame = page.frames().find(f => f.url().includes('tavern.html'))!;
  await frame.evaluate(async enabled => { (await import('/scripts/openai.js')).oai_settings.stream_openai = enabled; }, stream);
  await message.locator('.swipe_right').click();
  await expect(message.locator('.mes_text')).toHaveText('门外传来轻轻的敲门声。');
  await expect.poll(() => requests.length).toBe(1);
  await expect(tavern.locator('#send_but')).toBeVisible();
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(/\/chat\?/);
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.branches ?? []).toHaveLength(0);
  expect(saved.session.messages).toHaveLength(3);
  expect(saved.session.messages[2]).toMatchObject({ id: 'reply', rawData: { swipe_id: 1, swipes: ['原来的回答', '门外传来轻轻的敲门声。'] } });
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect(message.locator('.mes_text')).toHaveText('门外传来轻轻的敲门声。');
  await message.locator('.swipe_left').click();
  await expect(message.locator('.mes_text')).toHaveText('原来的回答');
  // Reusing the stored candidate must not send a new completion.
  await message.locator('.swipe_right').click();
  await expect(message.locator('.mes_text')).toHaveText('门外传来轻轻的敲门声。');
  expect(requests).toHaveLength(1);
  await tavern.locator('#send_textarea').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => requests.length).toBe(2);
  await expect(tavern.locator('#send_but')).toBeVisible();
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(/\/chat\?/);
  const next = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(next.session.messages[2].rawData.swipes).toHaveLength(3);
  expect(next.branches ?? []).toHaveLength(0);
});

test('existing swipes and original message editing keep STE IDs and candidate data', async ({ page }) => {
  const storyId = await seed(page);
  await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts');
    await db.updateArchiveStory(id, current => ({ session: { ...current.session, messages: current.session.messages.map(message => ({
      ...message, rawData: { ...message.rawData, swipes: [message.content, '你淋湿了，先坐下。'], swipe_id: 0,
        swipe_info: [{ extra: { candidate: 'first' } }, { extra: { candidate: 'second' } }] },
    })) }, markers: [{ messageId: 'greeting', messageIndex: 0, title: '初见', createdAt: 1 }] }));
  }, storyId);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await message.locator('.swipe_right').click();
  await expect(message.locator('.mes_text')).toHaveText('你淋湿了，先坐下。');
  await message.hover();
  await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('风把雨送进了门厅。');
  await message.locator('.mes_edit_done').click();
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(new RegExp('/chat\\?'));
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages[0]).toMatchObject({ id: 'greeting', content: '风把雨送进了门厅。',
    rawData: { swipe_id: 1, swipes: ['请进，外面在下雨。', '风把雨送进了门厅。'] } });
  expect(saved.markers[0].messageId).toBe('greeting');
  expect(requests).toHaveLength(0);
});

test('stop cancels the actual provider stream and the accepted partial text can be reopened', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await tavern.locator('#send_textarea').fill('请求慢速回复');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('这是一段尚未完成的回复');
  expect(stoppedStreams).toBe(0);
  await tavern.locator('#mes_stop').click();
  await expect.poll(() => stoppedStreams).toBe(1);
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(new RegExp('/chat\\?'));
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages.at(-1).content).toBe('这是一段尚未完成的回复');
});

test('browser Back retains the current editor and explicit close flushes it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const storyId = await seed(page);
  await page.goto(`/story/${storyId}`);
  await page.getByRole('button', { name: '开始游玩' }).click();
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await message.hover();
  await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('雨还没停，进来吧。');
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(new RegExp('/story/'));
  await expect.poll(async () => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id)).session.messages[0].content, storyId)).toBe('雨还没停，进来吧。');
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect(message.locator('.mes_text')).toHaveText('雨还没停，进来吧。');
  await page.getByRole('button', { name: '关闭聊天', exact: true }).click();
  await expect(page.locator('iframe[title="SillyTavern 角色扮演"]')).toHaveCount(0);
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages[0].content).toBe('雨还没停，进来吧。');
  expect(errors.filter(error => error.includes('blocker state'))).toEqual([]);
});

test('a failed story write keeps the live chat open and retry preserves the edited prose', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await page.evaluate(async () => {
    const repo = (await import('/src/lib/repo/index.ts')).getCurrentRepo('archiveStories');
    const original = repo.put.bind(repo);
    (window as any).__restoreStoryWrite = () => { repo.put = original; };
    repo.put = async () => { throw new Error('模拟磁盘写入失败'); };
  });
  await message.hover();
  await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('这条修改需要重试保存。');
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page.getByRole('alert')).toContainText('尚未保存');
  await expect(page.getByRole('alert')).toContainText('模拟磁盘写入失败');
  await expect(page).toHaveURL(new RegExp('/play/'));
  await page.evaluate(() => (window as any).__restoreStoryWrite());
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(new RegExp('/chat\\?'));
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages[0].content).toBe('这条修改需要重试保存。');
});

test('failed saving still lets the player export the editor and input, then explicitly leave', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto('/play/' + storyId + '?from=chats');
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await page.evaluate(async () => {
    const repo = (await import('/src/lib/repo/index.ts')).getCurrentRepo('archiveStories');
    const original = repo.put.bind(repo);
    (window as any).__restoreStoryWrite = () => { repo.put = original; };
    repo.put = async () => { throw new Error('模拟持续写入失败'); };
  });
  await message.hover(); await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('必须能带走的未保存编辑。');
  await tavern.locator('#send_textarea').fill('还没有发出的下一句话。');
  await page.getByRole('button', { name: /返回聊天处理|返回聊天列表/ }).click();
  await expect(page.getByRole('button', { name: '导出当前内容', exact: true })).toBeVisible({ timeout: 5000 });
  const downloadTask = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前内容', exact: true }).click();
  const download = await downloadTask;
  const recoveryText = await readFile((await download.path())!, 'utf8');
  const rows = recoveryText.trim().split('\n').map(line => JSON.parse(line));
  expect(rows[1].mes).toBe('必须能带走的未保存编辑。');
  expect(rows[0].chat_metadata.ste_recovery.input).toBe('还没有发出的下一句话。');
  await page.getByRole('button', { name: '退出聊天', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认离开', exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  const saved = await page.evaluate(async id => (await import('/src/lib/archive-db.ts')).getArchiveStory(id), storyId);
  expect(saved.session.messages[0].content).toBe('请进，外面在下雨。');
  const recoveryId = await page.evaluate(async ({ text, characterId }) => {
    (window as any).__restoreStoryWrite();
    const db = await import('/src/lib/archive-db.ts');
    const { parseJsonl } = await import('/src/lib/adapters/st/chat-jsonl.ts');
    const parsed = parseJsonl(text);
    const restored = db.buildStoryFromSession({ id: crypto.randomUUID(), title: '恢复的聊天', createdAt: Date.now(),
      user: { name: parsed.metadata.user_name }, character: { name: parsed.metadata.character_name },
      messages: parsed.messages, rawMetadata: parsed.metadata }, characterId);
    await db.saveArchiveStory(restored);
    return restored.id;
  }, { text: recoveryText, characterId: saved.characterId });
  await page.goto('/play/' + recoveryId + '?from=chats');
  await expect(tavern.locator('#chat')).toContainText('必须能带走的未保存编辑。');
  await expect(tavern.locator('#send_textarea')).toHaveValue('还没有发出的下一句话。');
});

test('the chat hub opens conversations directly and guides a new chat to its real settings', async ({ page }, info) => {
  const storyId = await seed(page);
  await page.goto('/play');
  await expect(page.getByRole('heading', { name: '聊天', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chat-hub.png') });
  await page.getByRole('button', { name: '继续 雨夜书店', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/play/' + storyId));
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  await page.evaluate(() => localStorage.removeItem('ste-play-guide-seen'));
  await page.getByRole('button', { name: '新建聊天', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '与林聊天', exact: true }).click();
  const guide = page.getByRole('dialog', { name: '聊天与记忆指南' });
  await expect(guide).toContainText('主模型');
  await expect(guide).toContainText('STE Agent');
  await expect(guide).toContainText('柏宝书');
  await page.screenshot({ path: info.outputPath('chat-guide.png') });
  await guide.getByRole('button', { name: '打开玩法设置', exact: true }).click();
  await expect(tavern.locator('#ste_play_mode')).toBeVisible();
  const fileChooserTask = page.waitForEvent('filechooser');
  await tavern.getByRole('button', { name: '选择插件 ZIP', exact: true }).click();
  const fileChooser = await fileChooserTask;
  expect(fileChooser.isMultiple()).toBe(false);
  await fileChooser.setFiles([]);
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  await guide.getByRole('button', { name: '打开模型设置', exact: true }).click();
  await expect(tavern.locator('#ste_main_profile')).toBeVisible();
  await page.getByRole('button', { name: '返回聊天列表', exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '聊天', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('chat-hub-mobile.png') });
});

test('the original branch command creates an internal STE branch and continues only that line', async ({ page }) => {
  const storyId = await seed(page);
  await page.evaluate(async ({ id, endpoint }) => {
    const db = await import('/src/lib/archive-db.ts'), { getCurrentRepo } = await import('/src/lib/repo/index.ts');
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    profiles.persistProfiles([
      { id: 'browser-test', name: '正文模型', apiUrl: endpoint, apiKey: '', model: 'fixture-model' },
      { id: 'browser-tools', name: '工具模型', apiUrl: endpoint, apiKey: '', model: 'fixture-tools' },
    ], 'browser-test');
    await db.saveRoleplayPreferences({ toolProfileId: 'browser-tools' });
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    await getCurrentRepo('worldbooks').put({ id: 'fixture-world', title: '分支世界书', createdAt: 1, updatedAt: 1, stGlobal: true,
      worldbook: parseWorldBook({ entries: { 2: { uid: 2, constant: false, key: ['绝不会匹配'], content: '原件：北门有一把暗锁。', position: 4, depth: 2 } } }) });
    const { createRuntimeStore } = await import('/src/lib/roleplay/runtime-store.ts'), store = createRuntimeStore(id);
    await store.write('memory/main/style.md', '# 文风\n保持沉稳，不越过角色知情范围。');
    const { createWorldbookVersions } = await import('/src/lib/roleplay/worldbook-versions.ts');
    const { sourceRefs } = await import('/src/lib/roleplay/fingerprint.ts');
    await createWorldbookVersions({ storyId: id, branchId: null, store, stories: getCurrentRepo('archiveStories'), worldbooks: getCurrentRepo('worldbooks') })
      .propose({ operationId: 'browser-version', worldId: 'fixture-world', entryId: 2, content: 'V2_ONLY：北门外的暗锁已经拆除。', reason: '剧情变化', sourceRefs: sourceRefs((await db.getArchiveStory(id)).session) });
  }, { id: storyId, endpoint });
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await expect(tavern.locator('#ste_play_mode')).toBeAttached();
  await page.getByRole('button', { name: '玩法设置', exact: true }).click();
  await tavern.locator('#ste_play_mode').selectOption('agent');
  await tavern.locator('#ste_world_versions').click();
  await tavern.getByRole('button', { name: '接受此版本', exact: true }).click();
  await expect(tavern.locator('dialog[open]')).toContainText('当前生效');
  await tavern.locator('dialog[open] .popup-button-ok').click();
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#send_textarea').fill('/branch-create 0');
  await tavern.locator('#send_but').click();
  await expect.poll(() => page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id))?.branches?.length ?? 0, storyId)).toBe(1);
  await expect(page).toHaveURL(/\/play\/.+\?branch=[^&]+/);
  const selectedBranch = new URL(page.url()).searchParams.get('branch');
  await page.reload();
  await expect(tavern.locator('#ste_play_mode')).toHaveValue('agent');
  const inherited = await page.evaluate(async ({ id, branch }) => {
    const { createRuntimeStore } = await import('/src/lib/roleplay/runtime-store.ts'), { branchKey } = await import('/src/lib/roleplay/paths.ts');
    return createRuntimeStore(id).read(`memory/${branchKey(branch)}/style.md`);
  }, { id: storyId, branch: selectedBranch });
  expect(inherited).toContain('不越过角色知情范围');
  await expect(tavern.locator('#send_textarea')).toHaveValue('');
  await expect(tavern.locator('#send_but')).toBeVisible();
  await tavern.locator('#send_textarea').fill('在这条分支里开门');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
  expect(JSON.stringify(requests.find(request => request.model === 'fixture-model').messages)).toContain('V2_ONLY');
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(new RegExp('/chat\\?'));
  const saved = await page.evaluate(async id => {
    const db = await import('/src/lib/archive-db.ts');
    return { story: await db.getArchiveStory(id), total: (await db.getAllArchiveStories()).length };
  }, storyId);
  expect(saved.total).toBe(1);
  expect(saved.story.session.messages).toHaveLength(1);
  expect(saved.story.branches[0].session.messages).toHaveLength(3);
  expect(saved.story.branches[0].session.messages[0].id).toBe('greeting');
  const retained = await page.evaluate(async id => ({
    mainMemory: await (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id).read('memory/main/state.md'),
    world: (await (await import('/src/lib/repo/index.ts')).getCurrentRepo('worldbooks').get('fixture-world')).worldbook.entries['2'].content,
  }), storyId);
  expect(retained.mainMemory).toBeNull();
  expect(retained.world).toBe('原件：北门有一把暗锁。');
});

test('a reload recovers the composer and an unfinished editor draft without treating it as a generated fact', async ({ page }) => {
  const storyId = await seed(page);
  await page.goto(`/play/${storyId}`);
  page.on('dialog', dialog => { void dialog.accept(); });
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  const message = tavern.locator('#chat .mes').first();
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await tavern.locator('#send_textarea').fill('还没发送的下一句');
  await message.hover(); await message.locator('.mes_edit').click();
  await message.locator('.edit_textarea').fill('这是一份尚未点完成的编辑。');
  await expect.poll(() => page.evaluate(async id => (await import('/src/lib/roleplay/runtime-store.ts')).createRuntimeStore(id).read('.ste-control/roleplay/main/draft.json'), storyId)).toContain('尚未点完成');
  await page.reload();
  await expect(tavern.locator('#ste_draft_recovery')).toContainText('发现上次未保存');
  await expect(message.locator('.mes_text')).toHaveText('请进，外面在下雨。');
  await tavern.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(message.locator('.mes_text')).toHaveText('这是一份尚未点完成的编辑。');
  await expect(tavern.locator('#send_textarea')).toHaveValue('还没发送的下一句');
  const saved = await page.evaluate(async id => (await (await import('/src/lib/archive-db.ts')).getArchiveStory(id))?.session.messages[0], storyId);
  expect(saved.content).toBe('这是一份尚未点完成的编辑。');
  expect(saved.rawData?.extra?.ste_runtime?.turnId).toBeUndefined();
});

test('real BaiBai 1.2.7 installs, summarizes through ST, survives reopening and yields ownership to the native Agent', async ({ page }, info) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const storyId = await seed(page);
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { version: '1.2.7' } }));
  await page.evaluate(async endpoint => {
    const profiles = await import('/src/components/ai-tools/api-profiles.ts');
    const state = profiles.loadApiProfiles();
    profiles.persistProfiles([...state.profiles, { id: 'baibai-tool', name: '柏宝书测试工具模型', apiUrl: endpoint, apiKey: '', model: 'fixture-baibai-tool' }], state.activeId);
    await (await import('/src/lib/archive-db.ts')).saveRoleplayPreferences({ toolProfileId: 'baibai-tool' });
  }, endpoint);
  await page.goto(`/play/${storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#chat')).toContainText('请进，外面在下雨。');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_runtime_settings .inline-drawer-toggle').click();
  await tavern.locator('#ste_baibai_zip').setInputFiles('.cache/tavern/fixtures/baibai/package.zip');
  await expect(tavern.locator('#bbs-app-host')).toBeAttached({ timeout: 40_000 });
  const currentFrame = () => page.frames().find(frame => frame.url().includes('/tavern.html'))!;
  await expect.poll(() => currentFrame().evaluate(() => (window as any).STBaiBaiBook?.pluginVersion)).toBe('1.2.7');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#ste_runtime_settings .inline-drawer-toggle').click();
  await tavern.locator('#ste_memory_owner').selectOption('baibai');
  await expect.poll(() => currentFrame().evaluate(() => (window as any).__STE_MEMORY_OWNER__)).toBe('baibai');
  await tavern.locator('#extensions-settings-button .drawer-toggle').click();
  await tavern.locator('#send_textarea').fill('谢谢，请把铜钥匙交给我。');
  await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('门外传来轻轻的敲门声。');
  await expect.poll(() => currentFrame().evaluate(() => (window as any).SillyTavern.getContext().chat[0].extra?.bbs_leaf?.text)).toContain('铜钥匙');
  for (let i = 0; i < 3; i++) {
    await tavern.locator('#send_textarea').fill('继续第 ' + (i + 2) + ' 轮。'); await tavern.locator('#send_but').click();
    await expect.poll(() => currentFrame().evaluate(() => (window as any).SillyTavern.getContext().chat.length)).toBe(5 + i * 2);
    await expect.poll(() => currentFrame().evaluate(() => (window as any).__STE_BAIBAI_BUSY__())).toBe(false);
  }
  await expect.poll(() => currentFrame().evaluate(() => (window as any).SillyTavern.getContext().chat[0].extra?.bbs_hidden)).toBe(true);
  const swipeBehavior = await currentFrame().evaluate(async () => {
    const ctx = (window as any).SillyTavern.getContext(), api = (window as any).STBaiBaiBook;
    const original = structuredClone(ctx.chat[2]), leaf = original.extra.bbs_leaf;
    ctx.chat[2].swipe_id = 1; ctx.chat[2].mes = '另一条候选剧情';
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SWIPED, 2);
    const missingOnOtherSwipe = api.getSnapshot().coverage.missingAiFloors.includes(2);
    Object.assign(ctx.chat[2], original);
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SWIPED, 2);
    const restored = !api.getSnapshot().coverage.missingAiFloors.includes(2);
    ctx.chat[2].mes += ' 补充一句旁白。';
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_EDITED, 2);
    await ctx.saveChat();
    return { missingOnOtherSwipe, restored, leafSurvivesEdit: ctx.chat[2].extra.bbs_leaf.id === leaf.id };
  });
  expect(swipeBehavior).toEqual({ missingOnOtherSwipe: true, restored: true, leafSurvivesEdit: true });
  const snapshot = await currentFrame().evaluate(() => (window as any).STBaiBaiBook.getSnapshot());
  expect(JSON.stringify(snapshot)).toContain('铜钥匙');
  expect(JSON.stringify(snapshot)).toContain('查明敲门者身份');
  expect(requests.filter(request => request.model === 'fixture-baibai-tool').length).toBeGreaterThan(0);
  expect(requests.filter(request => request.tools?.length)).toHaveLength(0);
  await page.getByRole('button', { name: '返回聊天处理' }).click();
  await expect(page).toHaveURL(/\/chat\?/);
  const portable = await page.evaluate(async id => (await (await import('/src/lib/roleplay/story-package.ts')).createStoryPackageAdapter().exportStory(id)).package, storyId);
  expect(portable.story.session.messages[0].rawData.extra.bbs_leaf.text).toContain('铜钥匙');
  expect(portable.story.session.messages.filter(message => message.rawData?.extra?.bbs_leaf).length).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  // The original extension loader finishes after the base chat has rendered.
  await expect(tavern.locator('#bbs-app-host')).toBeAttached({ timeout: 40_000 });
  await expect.poll(() => currentFrame()?.evaluate(() => JSON.stringify((window as any).STBaiBaiBook?.getSnapshot()))).toContain('铜钥匙');
  await currentFrame().evaluate(async () => {
    const ctx = (window as any).SillyTavern.getContext();
    const { hideChatMessageRange } = await import('/scripts/chats.js');
    // Exercise the pinned plugin's ownership hook and the genuine ST hide operation.
    (window as any).__STE_BAIBAI_HIDE__(ctx.chat[0]);
    await hideChatMessageRange(0, 0, false);
    const last = ctx.chat.length - 1;
    await hideChatMessageRange(last - 1, last, false);
    (window as any).__STE_BAIBAI_HIDE__(ctx.chat[last]);
    await ctx.saveChat();
  });
  await page.getByRole('button', { name: '玩法设置', exact: true }).click();
  await tavern.locator('#ste_play_mode').selectOption('agent');
  await expect(tavern.locator('#ste_memory_owner')).toHaveValue('native-agent');
  await expect.poll(() => currentFrame().evaluate(() => (window as any).SillyTavern.getContext().chat.map((message: any) => message.is_system === true))).toEqual([false, false, false, false, false, false, false, true, true]);
  expect(await currentFrame().evaluate(() => (window as any).SillyTavern.getContext().chat.some((message: any) => message.extra?.bbs_hidden))).toBe(false);
  const before = requests.filter(request => request.model === 'fixture-baibai-tool').length;
  await currentFrame().evaluate(async () => {
    const context = (window as any).SillyTavern.getContext();
    await context.eventSource.emit(context.eventTypes.USER_MESSAGE_RENDERED, context.chat.length - 1);
  });
  await expect.poll(() => currentFrame().evaluate(() => (window as any).__STE_BAIBAI_BUSY__())).toBe(false);
  expect(requests.filter(request => request.model === 'fixture-baibai-tool')).toHaveLength(before);
  expect(errors).toEqual([]);
  await info.attach('baibai-actual-snapshot', { body: JSON.stringify({ snapshot, swipeBehavior }, null, 2), contentType: 'application/json' });
});
