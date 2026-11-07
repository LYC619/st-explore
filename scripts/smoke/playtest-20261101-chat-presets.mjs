import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// User samples are read-only inputs. All writes occur in an isolated browser or memory vault.
const base = process.env.STE_SMOKE_URL || 'http://127.0.0.1:4213';
const presetPath = process.env.STE_PRESET_SAMPLE;
const cardPath = process.env.STE_CARD_SAMPLE;
if (!presetPath || !cardPath) throw new Error('Set STE_PRESET_SAMPLE and STE_CARD_SAMPLE to local read-only JSON samples');
const rawPreset = JSON.parse((await readFile(presetPath, 'utf8')).replace(/^\uFEFF/, ''));
const profile = JSON.parse((await readFile(cardPath, 'utf8')).replace(/^\uFEFF/, ''));
const out = '.cache/playtest-20261101'; await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], passed = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/https:\/\//, route => route.abort());
await page.route('**/fixture-completion', async route => {
  if (route.request().method() === 'GET') {
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { data: [{ id: 'fixture-model' }] } }); return;
  }
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } }); return;
  }
  const request = route.request().postDataJSON(); requests.push(request);
  const content = '测试回复：雨停了，门外传来敲门声。';
  if (request.stream) await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/event-stream', body:
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` });
  else await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] } });
});
const navigate = path => page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
try {
  await page.goto(base + '/settings');
  const ids = await page.evaluate(async ({ rawPreset, rawCard, base }) => {
    const db = await import('/src/lib/archive-db.ts');
    const { getCurrentRepo } = await import('/src/lib/repo/index.ts');
    const { parsePreset } = await import('/src/lib/preset-parser.ts');
    const { parseWorldBook } = await import('/src/types/worldbook.ts');
    const { persistProfiles } = await import('/src/components/ai-tools/api-profiles.ts');
    const { setTourCompleted } = await import('/src/lib/tour-steps.ts');
    for (const tour of ['home', 'chat', 'library', 'preset']) setTourCompleted(tour);
    localStorage.setItem('ste-play-guide-seen', '1');
    persistProfiles([{ id: 'fixture', name: '本地响应夹具', apiUrl: base + '/fixture-completion', apiKey: '', model: 'fixture-model' }], 'fixture');
    const character = db.buildCharacterFromCard({ ...rawCard, fav: true,
      data: { ...(rawCard.data ?? rawCard), extensions: { ...(rawCard.data ?? rawCard).extensions, fav: true } } });
    character.assets = [{ kind: 'worldbook', assetId: 'embedded', relations: ['embedded'] }, { kind: 'worldbook', assetId: 'primary', relations: ['primary'] }];
    await db.saveCharacter(character);
    for (const [id, content] of [['embedded', 'OLD_EMBEDDED_SHOULD_NOT_APPEAR'], ['primary', 'CURRENT_PRIMARY_MUST_APPEAR']]) {
      await getCurrentRepo('worldbooks').put({ id, title: id, createdAt: 1, updatedAt: 1,
        worldbook: parseWorldBook({ entries: { 1: { uid: 1, constant: true, content, position: 0, disable: false } } }) });
    }
    await getCurrentRepo('presets').put({ id: 'reborn-fixture', title: 'Reborn2.3', preset: parsePreset(rawPreset), createdAt: 1, updatedAt: 1 });
    const story = db.buildStoryFromSession({ id: 'fixture-session', title: '只读样本链路检查', createdAt: 1,
      character: { name: character.name }, user: { name: '测试用户' }, messages: [{ id: 'greeting', role: 'assistant', content: '请进，外面在下雨。' }] }, character.id);
    story.assets = [{ kind: 'preset', assetId: 'reborn-fixture' }];
    await db.saveArchiveStory(story);
    return { storyId: story.id, characterId: character.id };
  }, { rawPreset, rawCard: profile.card ?? profile, base });
  await navigate(`/play/${ids.storyId}`);
  const tavern = page.frameLocator('iframe[title="SillyTavern 角色扮演"]');
  await expect(tavern.locator('#ste_play_mode')).toBeAttached({ timeout: 45000 });
  const state = await tavern.locator('body').evaluate(async () => {
    const st = await import('/script.js'); const { oai_settings } = await import('/scripts/openai.js');
    return { world: st.characters[st.this_chid].data.extensions.world, favorite: st.characters[st.this_chid].fav,
      preset: oai_settings.preset_settings_openai, orders: oai_settings.prompt_order.map(group => ({ id: group.character_id, length: group.order.length })) };
  });
  expect(state.world).toBe('primary'); expect(state.favorite).toBe(true);
  expect(state.preset).toContain('Reborn');
  passed.push('真实角色卡结构：内嵌引用在前时，聊天仍选择主绑定世界书');
  await tavern.locator('#send_textarea').fill('请继续描写雨夜的场景。'); await tavern.locator('#send_but').click();
  await expect(tavern.locator('#chat')).toContainText('测试回复：雨停了', { timeout: 30000 });
  expect(requests).toHaveLength(1);
  const requestText = JSON.stringify(requests[0].messages);
  expect(requestText).toContain('CURRENT_PRIMARY_MUST_APPEAR');
  expect(requestText).not.toContain('OLD_EMBEDDED_SHOULD_NOT_APPEAR');
  expect(requestText).toContain('请继续描写雨夜的场景');
  expect(requests[0].model).toBe('fixture-model');
  await writeFile(out + '/request-summary.json', JSON.stringify({ model: requests[0].model, stream: requests[0].stream,
    fields: Object.keys(requests[0]), messageCount: requests[0].messages.length,
    roles: requests[0].messages.map(message => message.role), maxTokens: requests[0].max_tokens,
    state, primaryIncluded: true, embeddedExcluded: true }, null, 2));
  passed.push('真实 Reborn2.3 副本：原 ST 组装、主绑定注入、请求、SSE 接收和正文显示');
  await tavern.locator('#rightNavHolder > .drawer-toggle').click();
  await tavern.locator('#rm_button_selected_ch').click();
  await expect(tavern.locator('#favorite_button')).toBeVisible();
  await expect(tavern.locator('#favorite_button')).toHaveClass(/fav_on/);
  await tavern.locator('#favorite_button').click();
  await expect.poll(() => page.evaluate(async id => {
    const c = await (await import('/src/lib/archive-db.ts')).getCharacter(id);
    return { top: c.card.fav, nested: c.card.data.extensions.fav };
  }, ids.characterId)).toEqual({ top: false, nested: false });
  await page.reload(); await expect(tavern.locator('#ste_play_mode')).toBeAttached({ timeout: 45000 });
  const favorite = await tavern.locator('body').evaluate(async () => { const st = await import('/script.js'); return st.characters[st.this_chid].fav; });
  expect(favorite).toBe(false);
  await expect(tavern.locator('#chat')).toContainText('测试回复：雨停了');
  passed.push('真实收藏按钮取消后刷新：收藏保持取消，生成正文已持久保存');
  await page.screenshot({ path: out + '/chat.png' });
  await navigate('/settings');
  await page.evaluate(async rawPreset => {
    const { createMemFs } = await import('/src/lib/vault/fs.ts'); const { createVault } = await import('/src/lib/vault/vault-backend.ts');
    const { setActiveVault } = await import('/src/lib/vault/active.ts');
    const fs = createMemFs(); window.followupFixture = { fs, vault: createVault(fs) };
    const { __ste, ...raw } = rawPreset;
    await fs.writeText('资产/预设/Reborn2.3.json', JSON.stringify({ ...raw, __ste: { id: 'reborn', title: 'Reborn2.3', catalog: { series: 'Reborn' }, createdAt: 1, updatedAt: 1 } }));
    setActiveVault(window.followupFixture.vault);
  }, rawPreset);
  await navigate('/presets');
  await expect(page.locator('[data-preset-series]')).toHaveCount(1);
  expect(await page.evaluate(() => window.followupFixture.vault.pathOf('presets', 'reborn'))).toBe('资产/预设/Reborn/Reborn2.3.json');
  await expect(page.getByRole('button', { name: '刷新文件', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '整理系列文件夹', exact: true })).toHaveCount(0);
  passed.push('预设库真实入口自动升级旧扁平结构，两个维护按钮移除');
  await navigate('/presets/reborn'); await page.getByRole('tab', { name: '正则与脚本', exact: true }).click();
  await expect(page.getByRole('region', { name: '预设内嵌资源' })).toContainText('13 条正则 · 1 个脚本');
  await expect(page.getByText('SPreset', { exact: true })).toBeVisible();
  await page.screenshot({ path: out + '/reborn-resources.png' });
  await page.getByRole('button', { name: '读取到正则库并管理', exact: true }).click();
  await expect(page).toHaveURL(/\/regex\?assetId=preset-regex-/);
  const assetId = new URL(page.url()).searchParams.get('assetId');
  expect(await page.evaluate(async id => (await window.followupFixture.vault.repo('regexes').get(id)).rules.length, assetId)).toBe(13);
  passed.push('Reborn2.3 实际格式：13 条正则读取到正则库，1 个脚本在独立页签可查看管理');
  expect(errors).toEqual([]);
  await writeFile(out + '/results.json', JSON.stringify({ passed, errors }, null, 2)); console.log(JSON.stringify({ passed, errors }));
} catch (error) {
  await page.screenshot({ path: out + '/failure.png', fullPage: true });
  await writeFile(out + '/failure.txt', (await page.locator('body').innerText()).slice(0, 18000));
  await writeFile(out + '/errors.json', JSON.stringify(errors));
  throw error;
} finally { await browser.close(); }
