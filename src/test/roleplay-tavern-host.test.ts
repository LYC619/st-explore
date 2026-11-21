import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBranchFromSession, buildCharacterFromCard, buildStoryFromSession, getArchiveStory, getCharacter, getRoleplayPreferences, saveArchiveStory, saveCharacter, saveRoleplayPreferences, updateArchiveStory, updateCharacter } from '@/lib/archive-db';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { persistProfiles } from '@/components/ai-tools/api-profiles';
import { getCurrentRepo } from '@/lib/repo';
import type { WorldBookItem } from '@/types/worldbook';
import { parseWorldBook } from '@/types/worldbook';
import { extractCharacterFromPngBuffer } from '@/lib/png-parser';
import { base64ToBytes } from '@/lib/utils';
import { createWorldbookVersions } from '@/lib/roleplay/worldbook-versions';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';
import { sourceRefs } from '@/lib/roleplay/fingerprint';
import type { ArchiveStory } from '@/types/archive';
import * as liveChat from '@/lib/roleplay/live-chat';
import { chatKey } from '@/lib/roleplay/catalog';
import { assertStoryIdle } from '@/lib/story-activity';
import { Blob as NodeBlob } from 'node:buffer';
import { importEmbeddedAssets } from '@/lib/card-embedded-assets';
import { stScriptToRule } from '@/lib/st-regex-interop';
import { filterEmbeddedRegexScripts } from '@/tavern/regex-assets';
import { saveLibraryTagPreferences } from '@/lib/archive-db';
import { normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';

afterEach(() => { setActiveVault(null); localStorage.clear(); vi.unstubAllGlobals(); });

async function fixture() {
  const fs = createMemFs();
  setActiveVault(createVault(fs));
  persistProfiles([{ id: 'profile', name: '主模型', apiUrl: 'https://example.invalid/completion', apiKey: 'do-not-return-this-key', model: 'story-model' }], 'profile');
  const character = buildCharacterFromCard({ spec: 'chara_card_v3', data: {
    name: '林', description: '守着雨夜的书店', first_mes: '请进', extensions: { foreign: { preserve: true } },
  } });
  await saveCharacter(character);
  const story = buildStoryFromSession({ id: 'session', title: '雨夜来客', createdAt: 1, character: { name: '林' }, user: { name: '旅人' },
    messages: [{ id: 'm1', role: 'assistant', content: '请进' }],
  }, character.id);
  await saveArchiveStory(story);
  await getCurrentRepo<WorldBookItem>('worldbooks').put({ id: 'wb', title: '书店', worldbook: parseWorldBook({ entries: { 1: { uid: 1, key: ['书店'], content: '门向北开', position: 4, depth: 2, disable: false, foreign: 7 } } }), createdAt: 1, updatedAt: 1 });
  const commits = vi.fn();
  const host = await createTavernHost({ storyId: story.id, defaults: { settings: { username: 'User', oai_settings: { prompts: [] } } }, onCommit: commits });
  return { host, story, character, fs, commits };
}

describe('real Tavern host contracts', () => {
  it('refreshing the retained Tavern exposes a worldbook imported after startup', async () => {
    const { host } = await fixture();
    try {
      await getCurrentRepo<WorldBookItem>('worldbooks').put({ id: 'new-world', title: '新导入世界书', createdAt: 2, updatedAt: 2, worldbook: parseWorldBook({ entries: { 0: { uid: 0, content: '合成设定' } } }) });
      expect((await (await host.request('/api/settings/get')).json()).world_names).not.toContain('新导入世界书');
      expect((await host.request('/ste/library/refresh')).ok).toBe(true);
      expect((await (await host.request('/api/settings/get')).json()).world_names).toContain('新导入世界书');
      expect((await (await host.request('/api/worldinfo/get', { name: '新导入世界书' })).json()).entries['0'].content).toBe('合成设定');
    } finally { host.close(); }
  });
  it('a stored blank default remains visible for repair but cannot be selected or used to generate', async () => {
    const f = await fixture(); f.host.close();
    persistProfiles([{ id: 'placeholder', name: '默认', apiKey: '', apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }], 'placeholder');
    await saveRoleplayPreferences({ mainProfileId: 'placeholder' });
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      expect((await host.request('/api/bootstrap')).ok).toBe(true);
      expect(await (await host.request('/ste/configuration')).json()).toMatchObject({ profiles: [{ id: 'placeholder', configured: false }] });
      expect((await host.request('/ste/configuration', { mainProfileId: 'placeholder' })).ok).toBe(false);
      expect((await host.request('/api/backends/chat-completions/generate', { messages: [], stream: false })).ok).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      expect((await getRoleplayPreferences()).mainProfileId).toBe('placeholder');
    } finally { host.close(); }
  });
  it('loads existing chat with a missing connection and requires an explicit selection before generation', async () => {
    const f = await fixture(); f.host.close();
    await saveRoleplayPreferences({ mainProfileId: 'missing', toolProfileId: 'missing-tool' });
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    try {
      const bootstrap = await host.request('/api/bootstrap');
      expect(bootstrap.ok).toBe(true);
      const data = await bootstrap.json();
      expect(JSON.parse(data.settings.settings)).toMatchObject({ power_user: { auto_connect: false }, oai_settings: { custom_url: '', custom_model: '' } });
      const card = data.characters[0];
      expect(await (await host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json()).toEqual(expect.arrayContaining([expect.objectContaining({ mes: '请进' })]));
      expect(await (await host.request('/ste/configuration')).json()).toMatchObject({ mainProfileId: 'missing', toolProfileId: 'missing-tool', profiles: [expect.objectContaining({ id: 'profile' })] });
      const blocked = await host.request('/api/backends/chat-completions/generate', { messages: [], stream: false });
      expect(blocked.ok).toBe(false);
      expect((await blocked.json()).error.message).toContain('未找到所选主模型连接');
      expect(fetcher).not.toHaveBeenCalled();
      expect((await getRoleplayPreferences()).mainProfileId).toBe('missing');
      const chosen = await host.request('/ste/configuration', { mainProfileId: 'profile', toolProfileId: 'profile' });
      expect(chosen.ok).toBe(true);
      expect((await getRoleplayPreferences()).mainProfileId).toBe('profile');
      fetcher.mockResolvedValue(Response.json({ choices: [{ message: { content: '恢复后的回复' }, finish_reason: 'stop' }] }));
      const generated = await host.request('/api/backends/chat-completions/generate', { messages: [], stream: false });
      expect(generated.ok).toBe(true); await generated.text();
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { host.close(); }
  });
  it('observes the effective request, response and committed candidate without retaining connection secrets', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '模型原文' }, finish_reason: 'stop' }], usage: { total_tokens: 12 } })));
    try {
      const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
      const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
      const id = f.host.processEvent('start', { type: 'normal' })!;
      const response = await f.host.request('/api/backends/chat-completions/generate', { messages: [{ role: 'user', content: 'do-not-return-this-key' }], model: 'wrong', stream: false, ste_context: { processId: id, type: 'normal', chat } });
      expect(response.headers.get('x-ste-process-id')).toBe(id);
      expect(await response.json()).toMatchObject({ choices: [{ message: { content: '模型原文' } }] });
      expect(f.host.processLog.snapshot()).toHaveLength(1);
      expect(f.host.processLog.get(id)).toMatchObject({ status: 'succeeded', storyId: f.story.id });
      expect(f.host.processLog.get(id)!.events.find(e => e.stage === 'request')!.detail).toContain('story-model');
      expect(JSON.stringify(f.host.processLog.snapshot())).not.toContain('do-not-return-this-key');
      chat.push({ name: '林', is_user: false, mes: '处理后的正文', extra: { ste_runtime: { messageId: 'reply', candidateId: 'candidate' } }, variables: [{ stat_data: { trust: 1 } }] });
      f.host.processEvent('bind', { id, messageId: 'reply', candidateId: 'candidate', floor: 2 });
      expect(f.host.processLog.get(id)!.events.some(e => e.stage === 'saved')).toBe(false);
      const save = () => f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat });
      expect((await save()).ok).toBe(true);
      expect(f.host.processLog.get(id)!.events.find(e => e.stage === 'saved')!.detail).toContain('处理后的正文');
      expect((await getArchiveStory(f.story.id))!.session.messages.at(-1)!.content).toBe('处理后的正文');
      const priorCount = f.host.processLog.get(id)!.events.length;
      const continuation = f.host.processEvent('start', { type: 'continue' })!;
      f.host.processEvent('bind', { id: continuation, messageId: 'reply', candidateId: 'candidate', floor: 2 });
      chat.at(-1).mes += '续写'; chat.at(-1).variables[0].stat_data.trust = 2;
      chat[0].chat_metadata.variables = { weather: 'rain' };
      expect((await save()).ok).toBe(true);
      expect(f.host.processLog.get(id)!.events).toHaveLength(priorCount);
      expect(f.host.processLog.get(continuation)!.events.filter(e => e.stage === 'variables')).toHaveLength(2);
      // An archive conflict must not produce a successful save diagnostic.
      await updateArchiveStory(f.story.id, current => ({ session: { ...current.session, messages: current.session.messages.slice(0, 1) } }));
      const saves = f.host.processLog.get(continuation)!.events.filter(e => e.stage === 'saved').length;
      chat.at(-1).mes += '未保存'; expect((await save()).ok).toBe(false);
      expect(f.host.processLog.get(continuation)!.events.filter(e => e.stage === 'saved')).toHaveLength(saves);
      expect(f.host.processLog.get(continuation)!.events.at(-1)!.label).toBe('故事保存失败');
      setActiveVault(null); expect(f.host.processLog.snapshot()).toEqual([]);
    } finally { f.host.close(); }
  });

  it('keeps auxiliary requests separate and records HTTP errors and cancelled bodies', async () => {
    const f = await fixture();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'unavailable' } }, { status: 503 }))
      .mockResolvedValueOnce(new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } })));
    try {
      const normal = f.host.processEvent('start', { type: 'normal' })!;
      const response = await f.host.request('/api/backends/chat-completions/generate', { messages: [], stream: false, ste_context: { processId: normal, type: 'normal' } });
      await response.text(); expect(f.host.processLog.get(normal)!.status).toBe('failed');
      const quiet = await f.host.request('/api/backends/chat-completions/generate', { messages: [], stream: true, ste_context: { type: 'quiet' } });
      const quietId = quiet.headers.get('x-ste-process-id')!;
      expect(quietId).not.toBe(normal); await quiet.body!.cancel();
      expect(f.host.processLog.get(quietId)).toMatchObject({ type: 'quiet', status: 'cancelled' });
      expect(f.host.processLog.get(normal)!.status).toBe('failed');
    } finally { f.host.close(); }
  });

  it('starts with the linked preset instead of the factory Default and retains an explicitly saved selection', async () => {
    const f = await fixture(); f.host.close();
    const { parsePreset } = await import('@/lib/preset-parser');
    await getCurrentRepo<import('@/types/preset').PresetItem>('presets').put({ id: 'linked', title: 'Reborn2.3',
      preset: parsePreset({ prompts: [{ identifier: 'main', content: 'LINKED_PRESET_CONTENT' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }] }), createdAt: 1, updatedAt: 1 });
    await updateArchiveStory(f.story.id, () => ({ assets: [{ kind: 'preset', assetId: 'linked' }] }));
    const defaults = { settings: { oai_settings: { preset_settings_openai: 'Default', prompts: [{ identifier: 'main', content: 'FACTORY_DEFAULT' }] } } };
    const host = await createTavernHost({ storyId: f.story.id, defaults });
    try {
      const settings = JSON.parse((await (await host.request('/api/settings/get')).json()).settings).oai_settings;
      expect(settings.preset_settings_openai).toContain('Reborn');
      expect(settings.prompts).toEqual([{ identifier: 'main', content: 'LINKED_PRESET_CONTENT' }]);
      expect((await host.request('/api/settings/save', { oai_settings: { preset_settings_openai: 'Default', prompts: [{ identifier: 'main', content: 'EXPLICIT_USER_DRAFT' }] } })).ok).toBe(true);
    } finally { host.close(); }
    const reopened = await createTavernHost({ storyId: f.story.id, defaults });
    try {
      const settings = JSON.parse((await (await reopened.request('/api/settings/get')).json()).settings).oai_settings;
      expect(settings.preset_settings_openai).toBe('Default');
      expect(settings.prompts[0].content).toBe('EXPLICIT_USER_DRAFT');
    } finally { reopened.close(); }
  });
  it.each(['edit', 'merge-attributes'])('persists unfavoriting through %s and a fresh host, including stale top-level fav', async route => {
    const f = await fixture(); f.host.close();
    await updateCharacter(f.character.id, current => ({ card: { ...current.card, fav: true,
      data: { ...current.card.data!, extensions: { ...current.card.data!.extensions, fav: true } } } }));
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try {
      const card = (await (await host.request('/api/bootstrap')).json()).characters[0];
      expect(card.fav).toBe(true);
      expect((await host.request(`/api/characters/${route}`, { avatar_url: card.avatar, avatar: card.avatar,
        fav: route === 'edit' ? 'false' : false, ...(route === 'merge-attributes' ? { data: { extensions: { fav: false } } } : {}) })).ok).toBe(true);
      const read = await (await host.request('/api/characters/get', { avatar_url: card.avatar })).json();
      expect(read).toMatchObject({ fav: false, data: { extensions: { fav: false } } });
    } finally { host.close(); }
    const reopened = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try { expect((await (await reopened.request('/api/bootstrap')).json()).characters[0]).toMatchObject({ fav: false, data: { extensions: { fav: false } } }); }
    finally { reopened.close(); }
  });
  it('prefers the main bound worldbook over the embedded snapshot regardless of asset order', async () => {
    const f = await fixture(); f.host.close();
    await getCurrentRepo<WorldBookItem>('worldbooks').put({ id: 'embedded', title: '旧卡内世界书', createdAt: 1, updatedAt: 1,
      worldbook: parseWorldBook({ entries: {} }) });
    await updateCharacter(f.character.id, () => ({ assets: [
      { kind: 'worldbook', assetId: 'embedded', relations: ['embedded'] },
      { kind: 'worldbook', assetId: 'wb', relations: ['primary'] },
    ] }));
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try {
      const card = (await (await host.request('/api/bootstrap')).json()).characters[0];
      expect(card.data.extensions.world).toBe('书店');
      expect((await (await host.request('/api/characters/get', { avatar_url: card.avatar })).json()).data.extensions.world).toBe('书店');
      expect((await getCharacter(f.character.id))!.assets).toHaveLength(2);
      // The native editor sends world along with unrelated edits such as favorite.
      expect((await host.request('/api/characters/edit', { avatar_url: card.avatar, world: card.data.extensions.world, fav: 'false' })).ok).toBe(true);
      expect((await getCharacter(f.character.id))!.assets).toEqual([
        { kind: 'worldbook', assetId: 'embedded', relations: ['embedded'] },
        { kind: 'worldbook', assetId: 'wb', relations: ['primary'] },
      ]);
      expect((await host.request('/api/characters/edit', { avatar_url: card.avatar, world: '' })).ok).toBe(true);
      expect((await (await host.request('/api/characters/get', { avatar_url: card.avatar })).json()).data.extensions.world).toBe('');
      expect((await getCharacter(f.character.id))!.assets).toEqual([{ kind: 'worldbook', assetId: 'embedded', relations: ['embedded'] }]);
    } finally { host.close(); }
    const reopened = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try {
      const card = (await (await reopened.request('/api/bootstrap')).json()).characters[0];
      expect(card.data.extensions.world).toBe('');
      expect((await reopened.request('/api/characters/edit', { avatar_url: card.avatar, world: '书店' })).ok).toBe(true);
      expect((await (await reopened.request('/api/characters/get', { avatar_url: card.avatar })).json()).data.extensions.world).toBe('书店');
    } finally { reopened.close(); }
  });
  it('keeps character edits writable during an asynchronous library refresh', async () => {
    const f = await fixture();
    let release!: () => void;
    const characters = getCurrentRepo<import('@/types/archive').ArchiveCharacter>('characters');
    const original = characters.list.bind(characters);
    const gate = new Promise<void>(resolve => { release = resolve; });
    const list = vi.spyOn(characters, 'list').mockImplementationOnce(async () => { await gate; return original(); });
    const refreshing = f.host.request('/ste/library/refresh');
    try {
      await vi.waitFor(() => expect(list).toHaveBeenCalled());
      expect((await f.host.request('/api/characters/edit', { avatar_url: (await import('@/lib/roleplay/catalog')).avatarKey(f.character.id),
        chat: '实测聊天', description: '刷新期间保存' })).ok).toBe(true);
      expect((await getCharacter(f.character.id))!.card.data!.description).toBe('刷新期间保存');
    } finally { release(); await refreshing; list.mockRestore(); f.host.close(); }
  });
  it('projects library tags on first bootstrap and refreshes library edits without reopening the chat', async () => {
    const f = await fixture();
    try {
      await updateCharacter(f.character.id, () => ({ tags: ['题材/悬疑'], type: '人物', rating: 9 }));
      const bootstrap = await (await f.host.request('/api/bootstrap')).json();
      const first = JSON.parse(bootstrap.settings.settings);
      expect(first.tags).toEqual(expect.arrayContaining([expect.objectContaining({ name: '神作' }), expect.objectContaining({ name: '人物' })]));
      const avatar = bootstrap.characters[0].avatar;
      expect(first.tag_map[avatar]).toHaveLength(2);
      const { parsePreset } = await import('@/lib/preset-parser');
      const presets = getCurrentRepo<import('@/types/preset').PresetItem>('presets');
      await presets.put({ id: 'refresh-preset', title: '旧文件名', catalog: { name: '自用名', version: 'v2' },
        preset: parsePreset({ prompts: [], prompt_order: [] }), createdAt: 1, updatedAt: 1 });
      await updateCharacter(f.character.id, () => ({ tags: ['题材/日常'], rating: 6 }));
      const response = await f.host.request('/ste/library/refresh');
      expect(response.ok).toBe(true);
      const refreshed = await response.json();
      expect(refreshed.openai_setting_names).toContain('自用名 · v2');
      expect(refreshed.tags.map((tag: {name: string}) => tag.name)).toEqual(['人物','剧情','玩法','综合','同人','神作','精品','及格']);
      expect(refreshed.tag_map[avatar]).toHaveLength(2);
      expect(refreshed.tag_map[avatar]).not.toEqual(first.tag_map[avatar]);
      expect(refreshed.tags).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: '题材/悬疑' })]));
      await presets.put({ ...(await presets.get('refresh-preset'))!, catalog: { name: '自用名', version: 'v2', tags: ['状态/过期'] } });
      expect((await (await f.host.request('/ste/library/refresh')).json()).openai_setting_names).not.toContain('自用名 · v2');
      expect((await getArchiveStory(f.story.id))!.session.messages).toHaveLength(1);
    } finally { f.host.close(); }
  });
  it('keeps organizing tag ownership current across bootstrap, settings save, refresh and reopen', async () => {
    const f = await fixture();
    try {
      const preferences = normalizeLibraryTagPreferences({ version: 1, chatVisible: ['缺总结', '总结完', '日记完'] });
      await saveLibraryTagPreferences(preferences);
      await f.host.request('/ste/library/refresh');
      await updateCharacter(f.character.id, () => ({ tags: ['缺总结', '日记完', '保留标签'] }));
      const bootstrap = await (await f.host.request('/api/bootstrap')).json();
      const first = JSON.parse(bootstrap.settings.settings);
      const avatar = bootstrap.characters[0].avatar;
      const missing = first.tags.find((tag: { name: string }) => tag.name === '缺总结');
      expect(missing).toBeDefined();
      expect(first.tag_map[avatar]).toContain(missing.id);
      expect((await f.host.request('/api/settings/save', first)).ok).toBe(true);
      expect((await getCharacter(f.character.id))!.tags).toEqual(['缺总结', '日记完', '保留标签']);
      await updateCharacter(f.character.id, () => ({ tags: ['总结完', '日记完', '保留标签'] }));
      await saveLibraryTagPreferences({ ...preferences, chatVisible: ['总结完', '日记完'] });
      const refreshed = await (await f.host.request('/ste/library/refresh')).json();
      expect(refreshed.tag_map[avatar]).not.toContain(missing.id);
      expect(refreshed.tags.map((tag: { name: string }) => tag.name)).toContain('总结完');
      f.host.close();
      const reopened = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
      try {
        const data = await (await reopened.request('/api/bootstrap')).json();
        const settings = JSON.parse(data.settings.settings);
        expect(settings.tag_map[avatar]).toEqual(refreshed.tag_map[avatar]);
        expect(settings.tags.map((tag: { name: string }) => tag.name)).not.toContain('缺总结');
      } finally { reopened.close(); }
    } finally { f.host.close(); }
  });
  it('refreshes the provider model catalog on each explicit connection request and preserves the last list on failure', async () => {
    const f = await fixture();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'M1' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'M1' }, { id: 'M2' }] })))
      .mockRejectedValueOnce(new Error('断网'));
    vi.stubGlobal('fetch', fetcher);
    try {
      for (const expected of [['M1'], ['M1', 'M2']]) {
        const response = await (await f.host.request('/api/backends/chat-completions/status', {})).json();
        expect(response.data.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining(expected));
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
      const failed = await (await f.host.request('/api/backends/chat-completions/status', {})).json();
      expect(failed.data.map((item: { id: string }) => item.id)).toContain('M2');
      expect(failed.ste_warning).toContain('连接模型服务失败，请检查网络和接口地址。');
      expect(failed.ste_warning).toContain('已尝试 1 次');
      expect(failed.ste_warning).not.toContain('断网');
    } finally { f.host.close(); }
  });
  it('shares the startup character read and decorates bootstrap/single-card DTOs without rereading the library', async () => {
    const f = await fixture(); f.host.close();
    const characters = getCurrentRepo<import('@/types/archive').ArchiveCharacter>('characters');
    const stories = getCurrentRepo<ArchiveStory>('archiveStories');
    for (let index = 0; index < 8; index++) await saveCharacter(buildCharacterFromCard({ name: `无关角色${index}` }));
    const characterLists = vi.spyOn(characters, 'list');
    const characterGets = vi.spyOn(characters, 'get');
    const storyLists = vi.spyOn(stories, 'listLight');
    const storyBodies = vi.spyOn(stories, 'list');
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try {
      expect(characterLists).toHaveBeenCalledTimes(1);
      expect(storyLists).toHaveBeenCalledTimes(1);
      characterGets.mockClear();
      const bootstrap = await (await host.request('/api/bootstrap')).json();
      expect(bootstrap.characters).toHaveLength(9);
      expect(characterGets).not.toHaveBeenCalled();
      characterLists.mockClear(); storyLists.mockClear();
      const card = bootstrap.characters.find((character: { name: string }) => character.name === '林');
      const one = await (await host.request('/api/characters/get', { avatar_url: card.avatar })).json();
      expect(one).toMatchObject({ avatar: card.avatar, _ste_revision: card._ste_revision,
        data: { extensions: { foreign: { preserve: true } } } });
      expect(characterGets).toHaveBeenCalledTimes(1);
      expect(characterLists).not.toHaveBeenCalled();
      expect(storyLists).not.toHaveBeenCalled();
      expect(storyBodies).not.toHaveBeenCalled();
    } finally { host.close(); vi.restoreAllMocks(); }
  });

  it('saves and checkpoints a pending native swipe without mutating the live array or losing candidates', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    chat[1].swipes = ['请进']; chat[1].swipe_id = 1; chat[1].mes = '未完成的回复';
    const pending = structuredClone(chat);
    let complete!: (response: Response) => void;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url, options) => { requestSignal = options.signal; return new Promise<Response>(resolve => { complete = resolve; }); });
    vi.stubGlobal('fetch', fetcher);
    const generation = f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'user', content: '继续' }], stream: false, ste_context: { chat, type: 'swipe' },
    });
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      expect((await f.host.request('/ste/draft/capture', { chat, input: '' })).ok).toBe(true);
      const recovered = await (await f.host.request('/ste/draft/restore')).json();
      expect(recovered.chat[1]).toMatchObject({ swipe_id: 1, swipes: ['请进', '未完成的回复'] });
      expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
      expect(chat).toEqual(pending);
      expect(requestSignal?.aborted).toBe(false);
      expect((await getArchiveStory(f.story.id))!.session.messages[0].rawData?.swipes).toEqual(['请进', '未完成的回复']);
      chat[1].swipes.push('完整回复'); chat[1].mes = '完整回复';
      expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
      expect((await getArchiveStory(f.story.id))!.session.messages[0].rawData?.swipes).toEqual(['请进', '完整回复']);
      // A stopped overswipe can revert to its original array and selected candidate.
      chat[1].swipes = ['请进']; chat[1].swipe_id = 0; chat[1].mes = '请进';
      expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
      expect((await getArchiveStory(f.story.id))!.session.messages[0].rawData?.swipes).toEqual(['请进']);
    } finally {
      complete?.(new Response(JSON.stringify({ choices: [{ message: { content: '完整回复' } }] })));
      await (await generation).json(); f.host.close();
    }
  });

  it.each([true, false])('suppresses only imported embedded counterparts including legacy refs (source id=%s)', async hasId => {
    const f = await fixture(); f.host.close();
    const script = { ...(hasId ? { id: 'source-rule' } : {}), scriptName: '规则', findRegex: '/门/g', replaceString: '窗', placement: [2] };
    await updateCharacter(f.character.id, current => ({ card: { ...current.card,
      data: { ...current.card.data, extensions: { regex_scripts: [script] } } } }));
    const character = (await getCharacter(f.character.id))!;
    const imported = await importEmbeddedAssets(character);
    await updateCharacter(character.id, () => ({ assets: imported.map(({ relations: _relations, ...ref }) => ref) }));
    const regexes = getCurrentRepo<import('@/types/regex').RegexCollectionItem>('regexes');
    // Linked asset edits must keep suppressing the card's stale original copy,
    // including a source script for which the parser generated an ID.
    const importedRegex = (await regexes.get(imported.find(ref => ref.kind === 'regex')!.assetId))!;
    await regexes.put({ ...importedRegex, rules: importedRegex.rules.map(rule => ({ ...rule, replaceString: '修改后的窗' })) });
    await regexes.put({ id: 'independent', title: '有意重复', createdAt: 1, updatedAt: 1,
      rules: [stScriptToRule({ ...script, id: 'independent-rule' })] });
    await updateArchiveStory(f.story.id, current => ({ assets: [...current.assets ?? [], { kind: 'regex', assetId: 'independent' }] }));
    const host = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    try {
      const snapshot = await (await host.request('/ste/regex-assets')).json();
      expect(snapshot.suppressedEmbeddedScripts).toEqual([script]);
      const renderedSource = { ...script, id: hasId ? 'source-rule' : 'upstream-assigned-id' };
      const independent = { ...script, id: 'ordinary-independent' };
      const ordinary = filterEmbeddedRegexScripts([renderedSource, independent], snapshot);

      expect(ordinary).toEqual([independent]);
      expect(snapshot.embeddedScripts).toHaveLength(1);
      expect(snapshot.globalScripts).toHaveLength(1);
      const card = (await (await host.request('/api/bootstrap')).json()).characters[0];
      expect((await host.request('/api/characters/merge-attributes', { avatar: card.avatar,
        data: { extensions: { regex_scripts: [renderedSource, independent] } } })).ok).toBe(true);
      const saved = (await getCharacter(character.id))!.card.data!.extensions!.regex_scripts;
      expect(saved).toHaveLength(2);
      expect(saved).toContainEqual(independent);
      expect(saved).not.toContainEqual(renderedSource);
    } finally { host.close(); }
  });

  it('generates a native overswipe without decoding its pending slot or creating a branch', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    chat[1].swipes = ['请进']; chat[1].swipe_id = 1;
    const before = structuredClone(chat);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '另一种回答' } }] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    try {
      const response = await f.host.request('/api/backends/chat-completions/generate', {
        messages: [{ role: 'user', content: '继续' }], stream: false, ste_context: { chat, type: 'swipe' },
      });
      expect(await response.json()).toMatchObject({ choices: [{ message: { content: '另一种回答' } }] });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(chat).toEqual(before);
      // Upstream fills the pending slot only after completion, then performs a normal save.
      chat[1].mes = '另一种回答'; chat[1].swipes.push('另一种回答');
      expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
      const saved = (await getArchiveStory(f.story.id))!;
      expect(saved.branches ?? []).toHaveLength(0);
      expect(saved.session.messages).toHaveLength(1);
      expect(saved.session.messages[0].rawData?.swipes).toEqual(['请进', '另一种回答']);
      expect(saved.session.messages[0].rawData?.swipe_id).toBe(1);
    } finally { f.host.close(); }
  });
  it('persists concurrent persona avatar uploads, restores them on reopen and deletes one without losing the other', async () => {
    const f = await fixture();
    const avatar = new NodeBlob([new Uint8Array([137,80,78,71,13,10,26,10,0])], { type: 'image/png' });
    const responses = await Promise.all(['旅人.png', '朋友.png'].map(overwrite_name => f.host.request('/api/avatars/upload', { avatar, overwrite_name })));
    expect(responses.every(response => response.ok)).toBe(true);
    expect(await (await f.host.request('/api/avatars/get')).json()).toEqual(['旅人.png', '朋友.png']);
    f.host.close();
    const reopened = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    expect(reopened.userAvatar('旅人.png')).toMatch(/^data:image\/png;base64,/);
    expect((await (await reopened.request('/api/bootstrap')).json()).avatars).toHaveLength(2);
    expect((await reopened.request('/api/avatars/delete', { avatar: '旅人.png' })).ok).toBe(true);
    expect(await (await reopened.request('/api/avatars/get')).json()).toEqual(['朋友.png']);
    expect((await reopened.request('/api/avatars/upload', { avatar, overwrite_name: '../escape.png' })).ok).toBe(false);
    expect((await reopened.request('/api/avatars/upload', { avatar: new NodeBlob(['<svg/>']) })).ok).toBe(false);
    reopened.close();
  });
  it('restores the last viewed branch when no branch was requested and honours explicit main', async () => {
    const f = await fixture(); f.host.close();
    const branch = buildBranchFromSession({ ...structuredClone(f.story.session), id: 'branch-session', title: '分支会话' }, '另一个结局');
    await updateArchiveStory(f.story.id, () => ({ branches: [branch], lastViewedBranchId: branch.id }));
    const restored = await createTavernHost({ storyId: f.story.id, defaults: { settings: {} } });
    const state = await (await restored.request('/ste/branches')).json();
    expect(state.current.branchId).toBe(branch.id); expect(state.lines.map((line: { branchId: string | null }) => line.branchId)).toEqual([null, branch.id]); restored.close();
    const main = await createTavernHost({ storyId: f.story.id, branchId: null, defaults: { settings: {} } });
    expect((await (await main.request('/ste/branches')).json()).current.branchId).toBeNull(); main.close();
  });
  it('switches main → existing branch → main with each generation and save bound to that line', async () => {
    const f = await fixture();
    const branch = buildBranchFromSession({ ...structuredClone(f.story.session), id: 'branch-session', title: '不同结局', user: { name: '分支旅人' } }, '另一个结局');
    await updateArchiveStory(f.story.id, () => ({ branches: [branch] }));
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const decoded = vi.spyOn(liveChat, 'decodeLiveChat');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { role: 'assistant', content: '本地模拟回复' }, finish_reason: 'stop' }] })));
    try {
      for (const [branchId, expectedSessionId] of [[null, f.story.session.id], [branch.id, branch.session.id], [null, f.story.session.id]] as const) {
        const file = chatKey(f.story.id, branchId);
        const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: file })).json();
        decoded.mockClear();
        const response = await f.host.request('/api/backends/chat-completions/generate', { messages: [{ role: 'user', content: '继续' }], stream: false, ste_context: { chat, type: 'normal' } });
        expect(response.ok).toBe(true); await response.text();
        expect(decoded.mock.calls[0][1].id).toBe(expectedSessionId);
        chat.push({ name: '林', is_user: false, mes: `回复 ${branchId ?? '主线'}`, extra: { ste_runtime: { messageId: crypto.randomUUID() } } });
        expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: file, chat })).ok).toBe(true);
      }
      const saved = (await getArchiveStory(f.story.id))!;
      expect(saved.session.messages).toHaveLength(3); expect(saved.branches![0].session.messages).toHaveLength(2);
      expect(saved.branches![0].session.id).toBe('branch-session');
    } finally { decoded.mockRestore(); f.host.close(); }
  });
  it('bootstraps from STE cards, story and profile with ST stringified settings and no credentials', async () => {
    const f = await fixture();
    const response = await f.host.request('/api/bootstrap');
    const body = await response.json();
    expect(body.characters).toHaveLength(1);
    expect(body.characters[0]).toMatchObject({ name: '林', description: '守着雨夜的书店', data: { extensions: { foreign: { preserve: true } } } });
    expect(typeof body.settings.settings).toBe('string');
    const settings = JSON.parse(body.settings.settings);
    expect(settings).toMatchObject({ main_api: 'openai', firstRun: false, username: '旅人', oai_settings: { chat_completion_source: 'custom', custom_model: 'story-model' } });
    expect(settings.active_character).toBe(body.characters[0].avatar);
    expect(body.settings.world_names).toContain('书店');
    expect(JSON.stringify(body)).not.toContain('do-not-return-this-key');
  });

  it('reads and acknowledges saves through the same STE story, invoking observers only after durable persistence', async () => {
    const f = await fixture();
    const bootstrap = await (await f.host.request('/api/bootstrap')).json();
    const card = bootstrap.characters[0];
    const payload = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    expect(payload[1].extra.ste_runtime.messageId).toBe('m1');
    payload[1].mes = '请进，外面在下雨。';
    const response = await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat: payload });
    expect(response.ok).toBe(true);
    expect((await getArchiveStory(f.story.id))?.session.messages[0].content).toBe('请进，外面在下雨。');
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.commits.mock.calls[0][0]).toMatchObject({ storyId: f.story.id, branchId: null });
  });

  it('returns original worldbook numeric positions and unknown fields', async () => {
    const f = await fixture();
    const body = await (await f.host.request('/api/worldinfo/get', { name: '书店' })).json();
    expect(body.entries['1']).toMatchObject({ position: 4, depth: 2, foreign: 7, content: '门向北开' });
  });

  it('exports the persisted selected chat as raw ST JSONL with hidden messages, swipes and extension fields', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    chat[0].chat_metadata.foreign = { retained: true };
    chat[1] = { ...chat[1], mes: '另一种开场', is_system: true, swipes: ['请进', '另一种开场'], swipe_id: 1,
      swipe_info: [{ extra: { foreign: 1 } }, { extra: { foreign: 2 } }] };
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    const response = await f.host.request('/api/chats/export', { avatar_url: card.avatar, file: card.chat + '.jsonl', format: 'jsonl' });
    expect(response.ok).toBe(true);
    const rows = (await response.json()).result.split('\n').filter(Boolean).map(JSON.parse);
    expect(rows[0].chat_metadata.foreign).toEqual({ retained: true });
    expect(rows[1]).toMatchObject({ mes: '另一种开场', is_system: true, swipe_id: 1, swipes: ['请进', '另一种开场'],
      swipe_info: [{ extra: { foreign: 1 } }, { extra: { foreign: 2 } }] });
    expect((await f.host.request('/api/chats/export', { avatar_url: card.avatar, file: '../missing', format: 'jsonl' })).ok).toBe(false);
  });

  it('exposes accepted branch worldbook versions without replacing the original editor content', async () => {
    const f = await fixture();
    const versions = createWorldbookVersions({ storyId: f.story.id, branchId: null, store: createRuntimeStore(f.story.id),
      stories: getCurrentRepo<ArchiveStory>('archiveStories'), worldbooks: getCurrentRepo<WorldBookItem>('worldbooks') });
    const version = await versions.propose({ operationId: 'first-version', worldId: 'wb', entryId: 1,
      content: '大门已锁，改走侧门', reason: '剧情变化', sourceRefs: sourceRefs(f.story.session) });
    expect(await (await f.host.request('/ste/worldbook-versions/effective')).json()).toEqual([]);
    expect((await f.host.request('/ste/worldbook-versions/accept', { id: version.id })).ok).toBe(true);
    expect(await (await f.host.request('/ste/worldbook-versions/effective')).json())
      .toEqual([{ world: '书店', uid: '1', content: '大门已锁，改走侧门', version: 2 }]);
    expect((await (await f.host.request('/api/worldinfo/get', { name: '书店' })).json()).entries['1'].content).toBe('门向北开');
    const stale = await versions.propose({ operationId: 'later-version', worldId: 'wb', entryId: 1,
      content: '侧门也已锁', reason: '下一段', sourceRefs: sourceRefs(f.story.session) });
    expect((await f.host.request('/ste/worldbook-versions/reject', { id: version.id })).ok).toBe(true);
    expect((await f.host.request('/ste/worldbook-versions/accept', { id: stale.id })).ok).toBe(false);
  });

  it('does not report unknown commands or closed-session writes as successful', async () => {
    const f = await fixture();
    const unsupported = await f.host.request('/api/not-a-real-endpoint', {});
    expect(unsupported.status).toBe(501);
    f.host.close();
    const late = await f.host.request('/api/chats/save', { chat: [] });
    expect(late.ok).toBe(false);
    expect(f.commits).not.toHaveBeenCalled();
  });

  it('supplies the genuine frontend startup routes and a selectable persisted chat', async () => {
    const f = await fixture();
    expect(await (await f.host.request('/csrf-token')).json()).toMatchObject({ token: expect.any(String) });
    expect(await (await f.host.request('/ste/invoke', { command: 'get_tauritavern_settings' })).json())
      .toMatchObject({ chat_virtualization_enabled: true });
    const bootstrap = await (await f.host.request('/api/bootstrap')).json();
    expect(JSON.parse(bootstrap.settings.settings).power_user.auto_load_chat).toBe(true);
    const chats = await (await f.host.request('/api/characters/chats', { avatar_url: bootstrap.characters[0].avatar })).json();
    expect(Object.values(chats)).toContainEqual(expect.objectContaining({ file_name: bootstrap.characters[0].chat + '.jsonl' }));
    expect(await (await f.host.request('/api/extensions/discover')).json()).toEqual([{ name: 'regex', type: 'system' }]);
    expect(await (await f.host.request('/api/backgrounds/all')).json()).toEqual({ images: [], config: {} });
    expect(await (await f.host.request('/api/avatars/get')).json()).toEqual([]);
    expect(f.host.thumbnail('avatar', bootstrap.characters[0].avatar)).toBe('/img/ai4.png');
    await f.host.flush();
  });

  it('invalidates a session after switching away and back to the same vault object', async () => {
    const f = await fixture();
    const vault = getActiveVault();
    setActiveVault(null);
    setActiveVault(vault);
    expect((await f.host.request('/api/bootstrap')).status).toBe(409);
  });

  it('persists original Tavern settings in library preferences without a second secret store', async () => {
    const f = await fixture();
    expect((await f.host.request('/api/settings/save', { power_user: { font_scale: 1.25 },
      extension_settings: { example: { setting: true } }, oai_settings: { custom_model: 'old-model', proxy_password: 'secret' } })).ok).toBe(true);
    const prefs = await getRoleplayPreferences();
    expect(prefs.tavern).toMatchObject({ power_user: { font_scale: 1.25 }, extension_settings: { example: { setting: true } } });
    expect(JSON.stringify(prefs)).not.toContain('secret');
    const settings = JSON.parse((await (await f.host.request('/api/settings/get')).json()).settings);
    expect(settings.power_user.font_scale).toBe(1.25);
    expect(settings.oai_settings.custom_model).toBe('story-model');
  });

  it('forwards generation to the selected full endpoint and aborts it when the host closes', async () => {
    const f = await fixture();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'user', content: '门外有人吗？' }], model: 'wrong', stream: true,
    });
    expect(result.ok).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('https://example.invalid/completion');
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).model).toBe('story-model');
    f.host.close();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('tracks the real upstream generation lifecycle and persists statistics in library metadata', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const locator = { kind: 'character', characterId: card.avatar.replace(/\.png$/, ''), fileName: card.chat };
    expect((await f.host.request('/ste/invoke', { command: 'chat_history_generation_started', args: { locator } })).ok).toBe(true);
    expect(f.host.isGenerating()).toBe(true);
    expect(() => assertStoryIdle(f.story.id)).toThrow(/生成/);
    expect((await f.host.request('/ste/invoke', { command: 'chat_history_generation_finished', args: { locator } })).ok).toBe(true);
    expect(f.host.isGenerating()).toBe(false);
    expect(() => assertStoryIdle(f.story.id)).not.toThrow();
    const stats = { [card.avatar]: { user_msg_count: 2, total_gen_time: 25 } };
    expect((await f.host.request('/api/stats/update', stats)).ok).toBe(true);
    expect(await (await f.host.request('/api/stats/get')).json()).toEqual(stats);
    expect((await getRoleplayPreferences()).stats).toEqual(stats);
  });

  it.each(['edit', 'delete', 'reorder', 'hide', 'candidate'] as const)('aborts a completion when a save changes its captured history: %s', async change => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    chat.push({ name: '旅人', is_user: true, mes: '有人吗？', extra: { ste_runtime: { messageId: 'm2' } } });
    let requestSignal: AbortSignal | undefined;
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const response = await f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'user', content: '有人吗？' }], stream: true,
      ste_context: { type: 'normal', chat: structuredClone(chat) },
    });
    const received = response.text().catch(error => error);
    if (change === 'edit') chat[1].mes = '已修改开场';
    if (change === 'delete') chat.splice(1, 1);
    if (change === 'reorder') [chat[1], chat[2]] = [chat[2], chat[1]];
    if (change === 'hide') chat[1].is_system = true;
    if (change === 'candidate') chat[1].extra.ste_runtime.candidateId = 'different-candidate';
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await received).toMatchObject({ name: 'AbortError' });
    f.host.close();
  });

  it('keeps a completion alive for metadata saves and appended generated text', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'assistant', content: '请进' }], stream: true,
      ste_context: { type: 'normal', chat: structuredClone(chat) },
    });
    chat[0].chat_metadata.note = '界面状态';
    chat[1].extra.display = { expanded: true };
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(false);
    chat.push({ name: '林', is_user: false, mes: '新的回复', extra: { ste_runtime: { messageId: 'm2' } } });
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    chat[2].mes += '继续生成。';
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(false);
    f.host.close();
  });

  it.each(['swipe', 'continue'])('allows %s to replace its target without changing the captured prefix', async type => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    chat.push({ name: '林', is_user: false, mes: '需要继续或换一版的回复', extra: { ste_runtime: { messageId: 'm2' } } });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'assistant', content: '请进' }], stream: true,
      ste_context: { type, chat: structuredClone(chat) },
    });
    chat[2].mes = '生成中的新正文';
    chat[2].extra.ste_runtime.candidateId = 'new-candidate';
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(false);
    chat[1].mes = '较早的历史已变化';
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    f.host.close();
  });

  it('compares each active completion with its own captured input', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    }));
    await f.host.request('/api/backends/chat-completions/generate', { messages: [], stream: true });
    await f.host.request('/api/backends/chat-completions/generate', {
      messages: [], stream: true, ste_context: { type: 'quiet', chat: [...chat,
        { name: '旅人', is_user: true, mes: '尚未保存的新输入', extra: { ste_runtime: { messageId: 'm2' } } }],
      },
    });
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(signals.map(signal => signal.aborted)).toEqual([false, true]);
    f.host.close();
  });

  it.each(['preparing', 'streaming'])('rejects late Agent output after history changes while %s', async phase => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    expect((await f.host.request('/ste/runtime', { mode: 'agent', memoryOwner: 'native-agent' })).ok).toBe(true);
    let resolveTool!: (response: Response) => void;
    const toolResponse = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'context', type: 'function',
      function: { name: 'submit_context', arguments: JSON.stringify({ references: [], reminders: [] }) },
    }] }, finish_reason: 'tool_calls' }] }));
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      if (JSON.parse(String(init.body)).tools) return phase === 'preparing' ? new Promise<Response>(resolve => { resolveTool = resolve; }) : toolResponse();
      return new Response(new ReadableStream(), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'assistant', content: '请进' }], stream: true,
      ste_context: { type: 'normal', worldHandled: true, chat: structuredClone(chat) },
    });
    let response: Response | undefined;
    if (phase === 'preparing') await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    else response = await pending;
    const received = response?.text().catch(error => error);
    chat[1].mes = '历史已经修改';
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat })).ok).toBe(true);
    expect(signals.at(-1)?.aborted).toBe(true);
    if (phase === 'preparing') {
      resolveTool(toolResponse()); // A provider that ignores abort must still not start prose generation.
      expect((await pending).ok).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    } else {
      expect(await received).toMatchObject({ name: 'AbortError' });
      expect((await f.host.request('/ste/runtime/confirm-candidate', { turnId: response!.headers.get('x-ste-turn-id'),
        messageId: 'late', candidateId: 'late:main', content: '迟到的回复',
      })).ok).toBe(false);
    }
    f.host.close();
  });

  it('retains the preceding assistant when regenerate already removed its target upstream', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    const chat = await (await f.host.request('/api/chats/get', { avatar_url: card.avatar, file_name: card.chat })).json();
    const removed = { name: '林', is_user: false, mes: '需要重新生成的第二条助手回复', extra: { ste_runtime: { messageId: 'm2' } } };
    expect((await f.host.request('/api/chats/save', { avatar_url: card.avatar, file_name: card.chat, chat: [...chat, removed] })).ok).toBe(true);
    expect((await f.host.request('/ste/runtime', { mode: 'agent', memoryOwner: 'native-agent' })).ok).toBe(true);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: body.tools
        ? { tool_calls: [{ id: 'context', type: 'function', function: { name: 'submit_context', arguments: JSON.stringify({ references: [], reminders: [] }) } }] }
        : { content: '重新生成完成' }, finish_reason: body.tools ? 'tool_calls' : 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    const response = await f.host.request('/api/backends/chat-completions/generate', {
      messages: [{ role: 'assistant', content: '请进' }], stream: false,
      ste_context: { type: 'regenerate', worldHandled: true, chat },
    });
    expect(response.ok).toBe(true);
    await response.text();
    const retrieval = JSON.parse(JSON.parse(String(fetcher.mock.calls[0][1].body)).messages[1].content);
    expect(retrieval.recentMessages).toEqual([{ id: 'm1', role: 'assistant', content: '请进' }]);
    f.host.close();
  });
  it('writes edited card metadata into the existing PNG as well as the STE record', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    await updateCharacter(f.character.id, () => ({ pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGIAAQAABQABo6FV5QAAAABJRU5ErkJggg==' }));
    const response = await f.host.request('/api/characters/edit', { avatar_url: card.avatar, ch_name: '林', description: '已编辑的角色描述' });
    expect(response.ok).toBe(true);
    const saved = (await getCharacter(f.character.id))!;
    const pngCard = extractCharacterFromPngBuffer(base64ToBytes(saved.pngBase64!).buffer as ArrayBuffer);
    expect(pngCard?.data?.description).toBe('已编辑的角色描述');
    expect(f.host.thumbnail('avatar', card.avatar)).toBe(`data:image/png;base64,${saved.pngBase64}`);
    f.host.close();
    expect(f.host.thumbnail('avatar', card.avatar)).toBe('/img/ai4.png');
  });
  it('rejects stale card editors while allowing narrow extension merges without clobbering other fields', async () => {
    const f = await fixture();
    const card = (await (await f.host.request('/api/bootstrap')).json()).characters[0];
    await updateCharacter(f.character.id, current => ({ card: { ...current.card, data: { ...current.card.data, description: '外部已更新' } } }));
    expect((await f.host.request('/api/characters/edit', { avatar_url: card.avatar, description: '旧字段' })).ok).toBe(false);
    expect((await f.host.request('/api/characters/merge-attributes', { avatar: card.avatar, data: { extensions: { localVariables: { trust: 2 } } } })).ok).toBe(true);
    const saved = (await getCharacter(f.character.id))!;
    expect(saved.card.data?.description).toBe('外部已更新');
    expect(saved.card.data?.extensions).toMatchObject({ foreign: { preserve: true }, localVariables: { trust: 2 } });
    expect((await f.host.request('/api/characters/edit', { avatar_url: card.avatar, _ste_revision: card._ste_revision, description: '仍然过期' })).ok).toBe(false);
    const refreshed = (await (await f.host.request('/api/characters/get', { avatar_url: card.avatar })).json());
    expect((await f.host.request('/api/characters/edit', { avatar_url: card.avatar, _ste_revision: refreshed._ste_revision, description: '重新打开后的编辑' })).ok).toBe(true);
  });
});
