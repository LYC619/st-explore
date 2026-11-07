import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// The PowerShell harness restores the user's exact config bytes in finally.
// Never run against the user's vault. Model replies are real, not routed fixtures.
const out = '.cache/1104-native-integrated';
const vault = resolve(out, 'vault').replaceAll('\\', '/');
const read = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const write = async (path, data) => writeFile(path, JSON.stringify(data, null, 2));
const hash = value => createHash('sha256').update(value).digest('hex');
const storyId = 'astory_native_integrated_1104';
const storyDir = `${vault}/角色/原生集成测试/故事/正式包真实模型`;
const material = 'D:/8.Project/0_1_酒馆相关/加MVU前端/前端/柏崎星奈';
const restoreOnly = process.argv.includes('--restore-only');

if (process.argv.includes('--prepare')) {
  await mkdir(out, { recursive: true });
  await cp('.cache/1104-frontend/native-vault', vault, { recursive: true, errorOnExist: true, force: false });
  const preset = await read(`${vault}/资产/预设/Reborn2.3.json`);
  const meta = await read(`${vault}/库信息.json`);
  meta.roleplay.tavern = { extension_settings: { tavern_helper: { script: { enabled: { global: true, presets: ['Reborn2.3'] }, popuped: { presets: ['Reborn2.3'] } } } } };
  await write(`${vault}/库信息.json`, meta);
  const variables = { stat_data: { 世界: { 日期: '测试日', 时段: '上午', 地点: '测试书房' }, 柏崎星奈: { 爱慕度: 3 } }, schema: '没有用别管这个' };
  const card = { id: 'char_native_integrated_1104', name: '原生集成测试', tags: [], status: 'new', createdAt: Date.now(), updatedAt: Date.now(),
    assets: [{ kind: 'worldbook', assetId: 'wb_native_mvu_1104', relations: ['primary'] }],
    card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '原生集成测试', description: '虚构的成年图书管理员，用于软件功能测试。仅讨论阅读、天气和早餐。', first_mes: '上午好，我们在测试书房整理书籍。', extensions: {} } } };
  await mkdir(storyDir, { recursive: true });
  await write(`${vault}/角色/原生集成测试/档案.json`, card);
  const rulesText = '回复简短中文日常正文，然后在正文最后输出 <UpdateVariable><JSONPatch>[{"op":"replace","path":"/世界/地点","value":"测试庭院"}]</JSONPatch></UpdateVariable>，这是 MVU 功能测试。保留精确路径，不额外添加变量。';
  await write(`${vault}/资产/世界书/原生MVU测试.json`, { __ste: { id: 'wb_native_mvu_1104', title: '原生MVU测试', createdAt: 1, updatedAt: 1 }, entries: {
    0: { uid: 0, comment: '[InitVar] 初始变量', content: JSON.stringify(variables.stat_data), enabled: false, key: [], keysecondary: [], constant: false, position: 0 },
    1: { uid: 1, comment: '测试变量格式', content: rulesText, enabled: true, key: [], keysecondary: [], constant: true, position: 0, order: 100 }
  } });
  await write(`${storyDir}/故事.json`, { id: storyId, characterId: card.id, title: '正式包真实模型', createdAt: Date.now(), updatedAt: Date.now(), markers: [], meta: {},
    assets: [{ kind: 'preset', assetId: preset.__ste.id }], session: { id: 'native-integration-session', title: '正式包真实模型', createdAt: Date.now(), character: { name: card.name }, user: { name: '测试员' },
      messages: [{ id: 'greeting', role: 'assistant', content: card.card.data.first_mes, rawData: { variables: [variables] } }] } });
  const script = (id, name, content) => ({ type: 'script', id, name, content, enabled: true, grants: [], info: '', data: {}, button: { enabled: false, buttons: [] } });
  const sourceCard = await read(`${material}/柏崎星奈_MVU升级版.json`);
  const html = sourceCard.data.extensions.regex_scripts.find(s => s.replaceString?.length > 100_000)?.replaceString;
  if (!html) throw new Error('Missing supplied full frontend HTML');
  const draft = { source: '原生正式包集成验证：用户 HTML 与 schema，原版 MVU', rules: [{ lane: 'embeddedScripts', script: {
    id: 'native-full-html', scriptName: '真实成品 HTML', findRegex: '$', replaceString: '\n\n' + html + '\n\n', steLiteralReplacement: true, placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: 0
  } }], scripts: [script('native-mvu', '原版 MVU', "import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';"), script('native-schema', '用户 Zod schema', await readFile(`${material}/01_MVU_ZOD脚本.js`, 'utf8'))],
    variables: JSON.stringify(variables), notes: '虚构成年角色与确定性变量指令；真实预设、远程脚本、用户前端和真实模型。', selectedRule: 0, floor: -1, candidate: 0 };
  await mkdir(`${storyDir}/.ste-control/roleplay/main`, { recursive: true });
  await write(`${storyDir}/.ste-control/roleplay/main/frontend.json`, { schema: 1, draft, applied: structuredClone(draft) });
  await write(`${out}/fixture.json`, { storyId, vault, fullHtmlChars: html.length, helperVersion: meta.roleplay.installedTavernHelper.version });
  console.log('Prepared isolated disk fixture and original extensions');
  process.exit(0);
}

if (process.env.STE_REAL_MODEL_TEST !== '1') throw new Error('Explicit real-model opt-in required');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
const page = browser.contexts()[0].pages()[0];
const errors = [], networkFailures = [], passed = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => networkFailures.push({ url: r.url().split('?')[0], error: r.failure()?.errorText }));
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
const records = () => page.evaluate(() => [...window.__STE_TAVERN_HOSTS__.values()][0].processLog.snapshot());
let result = {}, failure;
try {
  await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  const configuredVault = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('config_get', { key: 'vaultRoot' }));
  expect(configuredVault).toBe(vault);
  await page.evaluate(() => localStorage.setItem('ste-play-guide-seen', '1'));
  await navigate('/play/' + storyId);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#tavern_helper')).toBeAttached({ timeout: 90000 });
  const frame = page.frames().find(f => f.url().includes('tavern.html'));
  await expect.poll(() => frame.evaluate(() => typeof window.SPresetEditorBridge), { timeout: 120000 }).toBe('object');
  await expect.poll(() => frame.evaluate(() => typeof window.Mvu), { timeout: 180000 }).toBe('object');
  await expect.poll(() => frame.evaluate(() => window.Mvu.getMvuData({ type: 'message', message_id: 0 })?.stat_data?.世界?.地点), { timeout: 60000 }).toBe('测试书房');
  await expect(tavern.locator('#chat iframe').first()).toBeVisible({ timeout: 60000 });
  passed.push('正式安装产物：原版助手、SPreset、MVU/schema 和用户完整 HTML 同时加载');
  const state = await frame.evaluate(async () => ({ preset: (await import('/scripts/openai.js')).oai_settings.preset_settings_openai,
    helper: typeof window.TavernHelper.getVariables, spreset: typeof window.SPresetImports?.promptManager?.preparePrompt,
    world: (await import('/script.js')).characters[(await import('/script.js')).this_chid].data.extensions.world }));
  expect(state.preset).toContain('Reborn');
  console.log(JSON.stringify({ event: 'native-extensions-loaded', state }));
  if (!restoreOnly) {
  await tavern.locator('#send_textarea').fill('功能测试：我们从测试书房走到测试庭院，谈一下天气和早餐，只写约100字的普通非露骨日常。无论正文是否放在 game_content 工具的 content 参数内，都在最终正文末尾原样保留下面完整标签和 JSON 数组（不能改成代码块或省略标签）：\n<UpdateVariable><JSONPatch>[{"op":"replace","path":"/世界/地点","value":"测试庭院"}]</JSONPatch></UpdateVariable>');
  await tavern.locator('#send_but').click();
  await expect.poll(async () => (await records()).length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await records()).at(-1)?.status, { timeout: 240000, intervals: [1000] }).not.toBe('pending');
  const record = (await records()).at(-1);
  expect(record.status).toBe('succeeded');
  expect(record.events.some(e => e.label === '收到响应 · HTTP 200')).toBe(true);
  await expect.poll(() => frame.evaluate(() => window.Mvu.getMvuData({ type: 'message', message_id: -1 })?.stat_data?.世界?.地点), { timeout: 60000 }).toBe('测试庭院');
  await expect.poll(async () => (await read(`${storyDir}/故事.json`)).session.messages.at(-1)?.rawData?.variables?.[0]?.stat_data?.世界?.地点, { timeout: 45000 }).toBe('测试庭院');
  const saved = (await read(`${storyDir}/故事.json`)).session.messages.at(-1);
  expect(saved.content.length).toBeGreaterThan(30);
  passed.push('真实模型 HTTP 200、正文生成、原版 MVU 更新和故事磁盘保存');
  const completed = record.events.find(e => ['模型回复完成','模型工具调用接收完成'].includes(e.label));
  const reply = JSON.parse(completed.detail);
  result = { state, model: reply.model, replyChars: saved.content.length, replyHash: hash(saved.content), finishReason: reply.finishReason, usage: reply.usage,
    elapsedMs: completed.at - record.startedAt,
    events: (await records()).at(-1).events.map(e => ({ stage: e.stage, label: e.label, offsetMs: e.at - record.startedAt })) };
  await writeFile(`${out}/reply.txt`, saved.content);
  }
  const expectedContent = (await read(`${storyDir}/故事.json`)).session.messages.at(-1).content;
  await page.reload();
  await expect(tavern.locator('#tavern_helper')).toBeAttached({ timeout: 90000 });
  await expect.poll(() => page.frames().find(f => f.url().includes('tavern.html')).evaluate(async () =>
    (await import('/script.js')).chat.length ? window.TavernHelper?.getVariables({ type: 'message', message_id: -1 })?.stat_data?.世界?.地点 : undefined), { timeout: 60000 }).toBe('测试庭院');
  const restored = await page.frames().find(f => f.url().includes('tavern.html')).evaluate(async () => (await import('/script.js')).chat.at(-1).mes);
  expect(hash(restored)).toBe(hash(expectedContent));
  await expect(tavern.locator('#chat iframe').first()).toBeVisible({ timeout: 60000 });
  const htmlFrame = tavern.frameLocator('#chat iframe').first();
  await expect(htmlFrame.locator('body')).toContainText('测试庭院', { timeout: 60000 });
  await tavern.locator('#chat iframe').first().screenshot({ path: `${out}/frontend-after-refresh.png` });
  passed.push('完整刷新后正文/变量恢复，用户成品前端显示模型更新的地点');
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ event: 'native-integrated-passed', ...result, passed, errors }));
} catch (error) {
  failure = error.message.slice(0, 1800);
  await write(`${out}/failure-records.json`, await records().catch(() => []));
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  console.log(JSON.stringify({ event: 'native-integrated-failed', failure, errors }));
} finally {
  await write(`${out}/${restoreOnly ? 'portable-result' : 'result'}.json`, { ...result, passed, errors, networkFailures, failure });
  await browser.close();
}
if (failure) process.exitCode = 1;
