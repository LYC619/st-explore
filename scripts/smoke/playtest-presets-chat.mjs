import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.STE_SMOKE_URL ?? 'http://127.0.0.1:4195';
const zoom = process.env.STE_SMOKE_ZOOM === '2';
const output = `.cache/playtest-presets-chat-20261028${zoom ? '-zoom200' : ''}`;
await mkdir(output, { recursive: true });
let browser, page;
if (zoom) {
  const extension = resolve(`${output}/zoom-extension`);
  await mkdir(extension, { recursive: true });
  await writeFile(`${extension}/manifest.json`, JSON.stringify({ manifest_version: 3, name: 'Isolated STE zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  await writeFile(`${extension}/worker.js`, `chrome.tabs.onUpdated.addListener((id, change, tab) => { if (tab.url?.startsWith(${JSON.stringify(base)}) && change.status === 'complete') chrome.tabs.setZoom(id, 2); });`);
  browser = await chromium.launchPersistentContext(`${output}/profile-${Date.now()}`, { headless: true, channel: 'msedge', viewport: { width: 1440, height: 960 }, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  page = await browser.newPage();
} else {
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
}
const passed = [], errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https:\/\//, async route => {
  if (!route.request().url().startsWith('https://fixture.invalid/')) return route.abort();
  if (route.request().method() === 'GET') return route.fulfill({ json: { data: [{ id: 'fixture-model' }] } });
  requests.push(route.request().postDataJSON());
  return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"实测回复"}}]}\n\ndata: [DONE]\n\n' });
});
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(`${base}/settings`);
  await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  if (zoom) await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2);
  await page.evaluate(async () => {
    localStorage.setItem('ste-play-guide-seen', '1');
    localStorage.setItem('ste-tag-migration-v2-notice', '1');
    const { createMemFs } = await import('/src/lib/vault/fs.ts');
    const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const db = await import('/src/lib/archive-db.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const fs = createMemFs(), vault = createVault(fs), opened = [];
    fs.openPath = async (path, reveal) => { opened.push({ path, reveal }); };
    setActiveVault(vault);
    for (const version of [1, 2]) await vault.repo('presets').put({ id: `preset-${version}`, title: `斯拉预设 Gemini 3.1 ${version === 1 ? 'A' : 'B'}.json`, createdAt: version, updatedAt: version,
      catalog: { name: `我的预设${version}`, series: '斯拉预设', author: '斯拉', version: `Gemini 3.1 ${version === 1 ? 'A' : 'B'}`, models: ['Gemini'], tags: ['状态/在用', '评价/良好'], releaseNotes: `# 第${version}版说明\n作者说明${version}`, notes: '' },
      preset: parsePreset({ prompts: [{ identifier: 'main', name: '主提示词', role: 'system', content: `第${version}版提示词` }, { identifier: 'chatHistory', name: '聊天历史', role: 'system', marker: true }], prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }], custom_exclude_body: '{}', temperature: 0.6,
        extensions: { regex_scripts: [{ id: 'embedded', scriptName: '内置正则', findRegex: '雨', replaceString: '晴', placement: [2], disabled: false, trimStrings: [] }], tavern_helper: { scripts: [{ type: 'script', id: 'helper', name: '内置脚本', content: 'console.log("fixture")', enabled: false }] } } }),
      packageFiles: [{ id: 'external', kind: 'regex', name: '旧版正则.json', text: JSON.stringify([{ id: 'external-rule', scriptName: '外置正则', findRegex: '风', replaceString: '云', placement: [2], trimStrings: [] }]) }] });
    const card = db.buildCharacterFromCard({ name: '实测角色', description: '书店守门人', first_mes: '你好' });
    card.tags = ['题材/悬疑']; card.type = '人物'; card.rating = 8; await db.saveCharacter(card);
    const story = db.buildStoryFromSession({ id: 'session-fixture', title: '实测故事', createdAt: 10, user: { name: '旅人' }, character: { name: '实测角色' }, messages: [{ id: 'first', role: 'assistant', content: '你好' }] }, card.id);
    story.updatedAt = 100; await db.saveArchiveStory(story);
    for (const index of [1, 2]) await db.saveArchiveStory({ ...db.buildStoryFromSession({ id: `orphan-${index}`, title: `旧聊天${index}`, createdAt: 1, user: { name: 'unused' }, character: { name: 'unused' }, messages: [] }), updatedAt: 1 });
    (await import('/src/components/ai-tools/api-profiles.ts')).persistProfiles([{ id: 'fixture', name: '本地测试', apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture', model: 'fixture-model' }], 'fixture');
    window.playtest = { vault, fs, opened, cardId: card.id, storyId: story.id };
  });
  await navigate('/presets');
  const catalog = page.locator('[data-preset-catalog]');
  await expect(catalog.locator('[data-preset-series]')).toHaveCount(1);
  await expect(catalog.locator('[data-preset-series] h2')).toHaveText('斯拉预设');
  await catalog.getByRole('button', { name: '预览', exact: true }).click();
  await catalog.getByRole('button', { name: 'Gemini 3.1 A', exact: true }).click();
  const details = page.locator('[data-preset-details]');
  await expect(details.getByRole('tab')).toHaveText(['作者说明', '笔记', '内容']);
  await expect(details).toContainText('作者说明2');
  await details.getByRole('button', { name: '打开所在文件夹', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.playtest.opened.length)).toBe(1);
  expect(await page.evaluate(() => window.playtest.opened[0].reveal)).toBe(true);
  const visibleVersion = catalog.getByRole('button', { name: 'Gemini 3.1 A', exact: true });
  if (await visibleVersion.isVisible()) await visibleVersion.click();
  else await details.getByRole('button', { name: '关闭预设资料', exact: true }).click();
  await expect(details).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Gemini 3.1 A', exact: true }).click();
  await catalog.getByLabel('预设分组').selectOption('series');
  await expect(catalog.locator('[data-preset-series]')).toHaveCount(2);
  await catalog.getByLabel('预设分组').selectOption('none');
  passed.push('系列标题、逐版标签、按系列分组、再次点击取消预览、三页签、最新作者说明、库内文件定位调用');

  await details.getByRole('tab', { name: '笔记', exact: true }).click();
  await details.getByRole('button', { name: '编辑笔记', exact: true }).click();
  await details.getByLabel('预设笔记正文').fill('# 使用记录\n自用笔记正文');
  await details.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.playtest.vault.repo('presets').get('preset-1')).catalog.notes)).toContain('自用笔记正文');
  await details.getByRole('tab', { name: '内容', exact: true }).click();
  await expect(details).toContainText('内置正则'); await expect(details).toContainText('内置脚本');
  await details.getByRole('button', { name: '内置到预设 · 旧版正则.json', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await window.playtest.vault.repo('presets').get('preset-1')).preset.originalData.extensions.regex_scripts.length)).toBe(2);
  const downloaded = page.waitForEvent('download');
  await details.getByRole('button', { name: '导出预设', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('我的预设1.json');
  await download.saveAs(`${output}/export.json`);
  for (const width of zoom ? [1440] : [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${output}/preset-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  passed.push('笔记持久化、内置正则/脚本可读、旧附件主动内置及单 JSON 导出');

  await details.getByRole('button', { name: '查看详情', exact: true }).click();
  await page.getByRole('button', { name: '临时试用', exact: true }).click();
  const playground = page.getByRole('region', { name: '预设试用', exact: true });
  await playground.getByLabel('试用消息', { exact: true }).fill('开始测试');
  await playground.getByRole('button', { name: '发送', exact: true }).click();
  await expect(playground.getByRole('log')).toContainText('实测回复');
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toContain('第1版提示词');
  await page.getByRole('button', { name: '返回预设库', exact: true }).click();
  await expect(catalog).toBeVisible();
  await catalog.getByRole('button', { name: '批量管理', exact: true }).click();
  await catalog.getByRole('button', { name: '选择 我的预设2', exact: true }).click();
  await catalog.getByRole('button', { name: '整理所选', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('版本号 斯拉预设 Gemini 3.1 A.json')).toHaveValue('Gemini 3.1 A');
  await dialog.getByLabel('名称 斯拉预设 Gemini 3.1 A.json').fill('我的整理名');
  await dialog.getByRole('button', { name: '保存到所选预设', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await catalog.getByRole('button', { name: '完成', exact: true }).click();
  passed.push('真实详情试用空对象 YAML/流式回复、整理预处理逐版本命名');

  await navigate('/play');
  await page.getByRole('button', { name: '进入酒馆', exact: true }).click();
  const frame = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(frame.locator('#chat')).toContainText('你好', { timeout: 60000 });
  await expect(page.getByRole('button', { name: '玩法设置', exact: true })).toBeEnabled();
  const child = page.frames().find(frame => frame.url().includes('tavern.html'));
  await expect.poll(async () => (await page.locator('iframe').evaluate(el => typeof el.contentWindow.__STE_TAVERN_REFRESH_LIBRARY__))).toBe('function');
  expect(await frame.locator('#rm_print_characters_block').innerText()).not.toContain('unused');
  await expect.poll(() => child.evaluate(async () => (await import('/scripts/tags.js')).tags.map(tag => tag.name))).toContain('类型/人物');
  const frameNode = await page.locator('iframe').elementHandle();
  const selectedName = '我的整理名 · Gemini 3.1 A';
  const selectPreset = async () => {
    await child.evaluate(async () => {
      const st = await import('/script.js');
      window.playtestPresetChangedDone = false;
      window.playtestPresetChanged = new Promise(resolve => st.eventSource.once(st.event_types.PRESET_CHANGED, () => { window.playtestPresetChangedDone = true; resolve(); }));
    });
    await frame.locator('#settings_preset_openai').selectOption({ label: selectedName }, { force: true });
    const regexConfirmation = frame.locator('dialog[open]').filter({ hasText: '此预设包含内置正则脚本' });
    await expect.poll(async () => {
      if (await regexConfirmation.isVisible()) await regexConfirmation.getByRole('button', { name: '否', exact: true }).click();
      return child.evaluate(() => window.playtestPresetChangedDone);
    }, { timeout: 15000 }).toBe(true);
    await child.evaluate(() => window.playtestPresetChanged);
  };
  await selectPreset();
  await frame.locator('#send_textarea').fill('未发送聊天草稿');
  await expect(frame.locator('#send_textarea')).toHaveValue('未发送聊天草稿');
  await child.evaluate(() => { document.querySelector('#description_textarea').value = '未提交角色表单草稿'; });
  await navigate('/presets');
  await page.evaluate(async () => {
    const { updatePreset } = await import('/src/lib/preset-db.ts');
    await updatePreset('preset-1', latest => ({ ...latest, preset: { ...latest.preset, originalData: { ...latest.preset.originalData, temperature: 0.91 } } }));
  });
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect.poll(() => child.evaluate(async () => (await import('/scripts/openai.js')).openai_settings[(await import('/scripts/openai.js')).openai_setting_names['我的整理名 · Gemini 3.1 A']].temperature)).toBe(0.91);
  await expect(frame.locator('#send_textarea')).toHaveValue('未发送聊天草稿');
  await expect(frame.locator('#description_textarea')).toHaveValue('未提交角色表单草稿');
  const saveSelected = () => child.evaluate(async name => {
    const openai = await import('/scripts/openai.js');
    return (await fetch('/api/presets/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiId: 'openai', name, preset: openai.openai_settings[openai.openai_setting_names[name]] }) })).status;
  }, selectedName);
  expect(await saveSelected()).toBe(409);
  await selectPreset();
  expect(await saveSelected()).toBe(200);
  passed.push('返回刷新保留聊天与角色表单草稿、旧预设编辑拒绝覆盖、显式重选新版后可保存');
  await navigate('/presets');
  await page.evaluate(async () => {
    const { updatePresetCatalog } = await import('/src/lib/preset-db.ts');
    const db = await import('/src/lib/archive-db.ts');
    await updatePresetCatalog('preset-1', { name: '聊天新名称', tags: ['状态/过期', '评价/优秀'] });
    await db.updateCharacter(window.playtest.cardId, () => ({ tags: ['题材/日常'], rating: 6 }));
  });
  await page.getByRole('button', { name: /^返回聊天 ·/ }).click();
  await expect.poll(() => frame.locator('#settings_preset_openai option').allTextContents()).not.toContain('我的整理名 · Gemini 3.1 A');
  await expect.poll(() => frame.locator('#settings_preset_openai option').allTextContents()).not.toContain('我的预设2 · Gemini 3.1 B');
  await expect.poll(() => child.evaluate(async () => (await import('/scripts/tags.js')).tags.map(tag => tag.name))).toContain('题材/日常');
  expect(await frameNode.evaluate(node => node === document.querySelector('iframe'))).toBe(true);
  await expect(frame.locator('#chat')).toContainText('你好');
  await page.screenshot({ path: `${output}/chat.png` });
  passed.push('聊天直接入口、unused筛除、角色类型/评价标签联动、后台返回刷新过期列表并保持聊天');
  expect(errors).toEqual([]);
  await writeFile(`${output}/result.json`, JSON.stringify({ passed, errors, requestCount: requests.length }, null, 2));
  process.stdout.write(JSON.stringify({ passed, errors, requestCount: requests.length }) + '\n');
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ passed, errors, error: String(error), stack: error.stack }, null, 2));
  throw error;
} finally { await browser.close(); }
