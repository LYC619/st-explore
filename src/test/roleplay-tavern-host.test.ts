import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBranchFromSession, buildCharacterFromCard, buildStoryFromSession, getArchiveStory, getCharacter, getRoleplayPreferences, saveArchiveStory, saveCharacter, updateArchiveStory, updateCharacter } from '@/lib/archive-db';
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
    expect((await f.host.request('/ste/invoke', { command: 'chat_history_generation_finished', args: { locator } })).ok).toBe(true);
    expect(f.host.isGenerating()).toBe(false);
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
