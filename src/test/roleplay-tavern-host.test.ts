import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCharacterFromCard, buildStoryFromSession, getArchiveStory, getCharacter, getRoleplayPreferences, saveArchiveStory, saveCharacter, updateCharacter } from '@/lib/archive-db';
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
    expect((await f.host.request('/ste/invoke', { command: 'chat_history_generation_finished', args: { locator } })).ok).toBe(true);
    expect(f.host.isGenerating()).toBe(false);
    const stats = { [card.avatar]: { user_msg_count: 2, total_gen_time: 25 } };
    expect((await f.host.request('/api/stats/update', stats)).ok).toBe(true);
    expect(await (await f.host.request('/api/stats/get')).json()).toEqual(stats);
    expect((await getRoleplayPreferences()).stats).toEqual(stats);
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
