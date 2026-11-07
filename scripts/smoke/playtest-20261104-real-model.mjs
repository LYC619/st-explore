import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Explicit opt-in: uses the user's configured real service, with read-only local samples.
// Credentials stay in this process and the isolated browser; summaries omit headers/content.
if (process.env.STE_REAL_MODEL_TEST !== '1') throw new Error('Set STE_REAL_MODEL_TEST=1 to authorize real provider requests');
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:4214';
const historyMode = process.env.STE_REAL_HISTORY_TEST === '1';
const out = '.cache/1104-real-model' + (historyMode ? '-history' : ''); await mkdir(out, { recursive: true });
const read = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const config = await read('C:/Users/yicha/AppData/Roaming/com.ste.explorer/config.json');
const profiles = typeof config.apiProfiles === 'string' ? JSON.parse(config.apiProfiles) : config.apiProfiles;
const profile = profiles.find(item => item.id === config.apiActiveProfile);
if (!profile?.apiKey) throw new Error('The active local connection has no key');
const root = 'D:/2.数据库/我的STExplore';
const card = await read(root + '/角色/我的双胞胎老婆/档案.json');
const preset = await read(root + '/资产/预设/Reborn2.3.json');
const sourceStory = historyMode ? await read(root + '/角色/我的双胞胎老婆/故事/第1-6卷 小总结版/故事.json') : undefined;
const worlds = await Promise.all(['！！！！！我的双胞胎女友.json', '！！！！！我的双胞胎女友·2.json'].map(name => read(root + '/资产/世界书/' + name)));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const scrub = value => JSON.stringify(value).split(profile.apiKey).join('[hidden]');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [], responses = [], passed = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (request.url() !== profile.apiUrl || request.method() !== 'POST') return;
  const body = request.postDataJSON();
  requests.push({ model: body.model, stream: body.stream, maxTokens: body.max_tokens ?? body.max_completion_tokens,
    reasoning: body.reasoning_effort, messageCount: body.messages?.length,
    textChars: JSON.stringify(body.messages).length, messageHash: hash(body.messages), fields: Object.keys(body), at: Date.now() });
  console.log(JSON.stringify({ event: 'real-request-sent', ...requests.at(-1) }));
});
page.on('response', async response => {
  if (response.url() === profile.apiUrl && response.request().method() === 'POST') {
    responses.push({ status: response.status(), contentType: response.headers()['content-type'], at: Date.now() });
    console.log(JSON.stringify({ event: 'real-response-headers', ...responses.at(-1) }));
  }
});
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
const records = () => page.evaluate(() => [...window.__STE_TAVERN_HOSTS__.values()][0].processLog.snapshot());
let ids, state, result, failure;
try {
  await page.goto(base + '/settings'); await page.getByRole('button', { name: '显示', exact: true }).waitFor();
  ids = await page.evaluate(async ({ card, preset, worlds, profile, sourceStory }) => {
    const db = await import('/src/lib/archive-db.ts');
    const { getCurrentRepo } = await import('/src/lib/repo/index.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    const { persistProfiles } = await import('/src/components/ai-tools/api-profiles.ts');
    persistProfiles([profile], profile.id); localStorage.setItem('ste-play-guide-seen', '1');
    await db.saveCharacter(card);
    for (const world of worlds) await getCurrentRepo('worldbooks').put({ ...world.__ste, worldbook: parseWorldBook(world) });
    const presetId = preset.__ste.id;
    await getCurrentRepo('presets').put({ ...preset.__ste, preset: parsePreset(preset) });
    const data = card.card.data ?? card.card;
    const story = db.buildStoryFromSession(sourceStory ? structuredClone(sourceStory.session) : { id: 'real-model-test', title: '真实模型隔离测试', createdAt: Date.now(),
      character: { name: card.name }, user: { name: '测试旅人' },
      messages: [{ id: 'greeting', role: 'assistant', content: data.first_mes }] }, card.id);
    story.assets = [{ kind: 'preset', assetId: presetId }];
    await db.saveArchiveStory(story);
    return { storyId: story.id, cardId: card.id, sourceMessages: story.session.messages.length };
  }, { card, preset, worlds, profile, sourceStory });
  await navigate('/play/' + ids.storyId);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_play_mode')).toBeAttached({ timeout: 60000 });
  await expect(page.getByRole('button', { name: '过程', exact: true })).toBeEnabled({ timeout: 60000 });
  const frame = page.frames().find(f => f.url().includes('tavern.html'));
  state = await frame.evaluate(async () => {
    const st = await import('/script.js'), { oai_settings } = await import('/scripts/openai.js');
    const { world_info } = await import('/scripts/world-info.js');
    return { preset: oai_settings.preset_settings_openai, world: st.characters[st.this_chid].data.extensions.world,
      stream: oai_settings.stream_openai, maxTokens: oai_settings.openai_max_tokens,
      worldNames: world_info?.globalSelect, originalGreetingChars: st.chat[0].mes.length };
  });
  expect(state.preset).toContain('Reborn'); expect(state.maxTokens).toBe(preset.openai_max_tokens);
  expect(state.world).toContain(worlds[0].__ste.id.slice(-6));
  console.log(JSON.stringify({ event: 'loaded-local-data', state, model: profile.model }));
  await tavern.locator('#send_textarea').fill('请写一段普通的早餐日常：我问今天早餐吃什么，两位角色各回答一句，再描写一下窗外的天气。这是功能测试，只写约150到300字的非露骨日常内容。');
  await tavern.locator('#send_but').click();
  await expect.poll(async () => (await records()).length, { timeout: 30000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await records()).at(-1)?.status, { timeout: 240000, intervals: [1000] }).not.toBe('pending');
  let record = (await records()).at(-1);
  expect(record.status).toBe('succeeded');
  await expect.poll(async () => (await records()).at(-1)?.events.some(e => e.stage === 'saved'), { timeout: 30000 }).toBe(true);
  record = (await records()).at(-1);
  const snapshot = await page.evaluate(async id => {
    const story = await (await import('/src/lib/archive-db.ts')).getArchiveStory(id);
    return story.session.messages.at(-1);
  }, ids.storyId);
  expect(snapshot.content.trim().length).toBeGreaterThan(20);
  const worldEvent = record.events.find(e => e.stage === 'world');
  expect(worldEvent).toBeTruthy();
  const activated = JSON.parse(worldEvent.detail);
  const sourceEntries = Array.isArray(worlds[0].entries) ? worlds[0].entries : Object.values(worlds[0].entries);
  const enabledIds = sourceEntries.filter(entry => entry.enabled !== false && entry.disable !== true).map(entry => entry.uid).sort();
  expect(activated.map(entry => entry.uid).sort()).toEqual(enabledIds);
  expect(activated.every(entry => entry.world === state.world)).toBe(true);
  passed.push('原卡、原始 Reborn2.3 和真实主世界书，经当前已配置模型返回正文并保存');
  await page.getByRole('button', { name: '过程', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '聊天过程' });
  await expect(panel).toContainText('正文已保存到故事');
  await page.screenshot({ path: out + '/real-process.png' });
  result = { model: profile.model, provider: new URL(profile.apiUrl).host, sourceMessages: ids.sourceMessages, state, requests, responses,
    outputChars: snapshot.content.length, outputHash: hash(snapshot.content),
    elapsedMs: record.events.find(e => e.stage === 'saved').at - record.startedAt,
    stages: record.events.map(e => ({ stage: e.stage, label: e.label, offsetMs: e.at - record.startedAt })),
    worldEvent: worldEvent.detail,
    outcome: record.events.find(e => e.label === '模型回复完成')?.detail,
    savedCandidate: record.candidateId, passed, errors };
  // Store real output locally for later inspection, never include it in terminal logs.
  await writeFile(out + '/reply.txt', snapshot.content);
  await writeFile(out + '/process-records.json', scrub(await records()));
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload(); await expect(tavern.locator('#ste_play_mode')).toBeAttached({ timeout: 60000 });
  const restored = await page.frames().find(f => f.url().includes('tavern.html')).evaluate(async () => (await import('/script.js')).chat.at(-1).mes);
  expect(hash(restored)).toBe(hash(snapshot.content));
  expect(requests).toHaveLength(1); expect(responses.map(response => response.status)).toEqual([200]); expect(errors).toEqual([]);
  passed.push('真实回复刷新重进后正文一致');
  const safeResult = { ...result }; delete safeResult.outcome;
  console.log(JSON.stringify(safeResult));
} catch (error) {
  failure = error.message;
  await writeFile(out + '/failure-records.json', scrub(await records().catch(() => [])));
  await page.screenshot({ path: out + '/failure.png' }).catch(() => {});
  console.log(JSON.stringify({ event: 'test-failed', failure: failure.slice(0, 1200), requests, responses, errors }));
} finally {
  await writeFile(out + '/result.json', scrub({ ...(result ?? { state, requests, responses, passed, errors }), failure }));
  await browser.close();
}
if (failure) process.exitCode = 1;
