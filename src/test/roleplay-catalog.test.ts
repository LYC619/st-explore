import { describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/repo';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { buildBranchFromSession, buildCharacterFromCard, buildStoryFromSession, updateArchiveStory } from '@/lib/archive-db';
import { avatarKey, chatKey, createRoleplayCatalog } from '@/lib/roleplay/catalog';
import { encodeLiveChat } from '@/lib/roleplay/live-chat';

function memoryRepo<T extends { id: string; updatedAt: number }>(initial: T[]) {
  const items = new Map(initial.map(item => [item.id, structuredClone(item)]));
  let writes = 0;
  let listReads = 0;
  let getReads = 0;
  let lightReads = 0;
  let fail = false;
  const repo: Repo<T> = {
    list: async () => { listReads++; return [...items.values()].map(item => structuredClone(item)); },
    listLight: async () => {
      lightReads++;
      return [...items.values()].map(({ id, updatedAt }) => ({ id, updatedAt } as T));
    },
    get: async id => { getReads++; return structuredClone(items.get(id)); },
    put: async item => {
      if (fail) throw new Error('磁盘写入失败');
      items.set(item.id, structuredClone(item));
      writes++;
    },
    remove: async id => { items.delete(id); },
  };
  return { repo, items, writes: () => writes, listReads: () => listReads, getReads: () => getReads,
    lightReads: () => lightReads, fail: (value: boolean) => { fail = value; } };
}

function character(id: string): ArchiveCharacter {
  return { ...buildCharacterFromCard({ spec: 'chara_card_v2', spec_version: '2.0',
    data: { name: '林', description: '守门人', first_mes: '请进', extensions: { plugin: { keep: true } } },
    custom_card_field: ['keep'],
  }), id };
}

function session(id = 'session'): ChatSession {
  return {
    id, title: '雨夜', createdAt: 1, character: { name: '林' }, user: { name: '旅人' },
    rawMetadata: { foreign_header: { keep: true }, chat_metadata: { plugin: { count: 2 } } },
    messages: [
      { id: 'm1', role: 'user', content: '开门' },
      { id: 'm2', role: 'assistant', content: '请进', rawData: { extra: { plugin: [1, 2] } } },
      { id: 'm3', role: 'user', content: '外面有雨' },
    ],
  };
}

function fixture() {
  const main: ArchiveStory = { ...buildStoryFromSession(session(), 'character-a'), id: 'story-a',
    rating: 8, status: '进行中', sourcePath: '原始聊天.jsonl', lastFloor: 2,
    meta: { modelsUsed: ['model'], playTimeMs: 10, assetSnapshot: { world: 123 } },
    markers: [
      { messageId: 'm2', messageIndex: 1, title: '初见', createdAt: 1 },
      { messageId: 'm3', messageIndex: 2, title: '雨声', createdAt: 2 },
    ],
    favorites: ['m2', 'm3'], lastViewedBranchId: 'branch-a',
    branches: [{ id: 'branch-a', name: '另一条线', session: session('branch-session'),
      markers: [], favorites: ['m1'], createdAt: 2, updatedAt: 3 }],
  };
  const second = { ...buildStoryFromSession(session('second'), 'character-a'), id: 'story-b' };
  const other = { ...buildStoryFromSession(session('other'), 'character-b'), id: 'story-c' };
  const stories = memoryRepo([main, second, other]);
  const characters = memoryRepo([character('character-a'), character('character-b'), character('character-empty')]);
  const options = { stories: stories.repo, characters: characters.repo, storyId: main.id };
  return { stories, characters, options, main };
}

function replacementFixture() {
  const f = fixture();
  const original = f.stories.items.get('story-a')!;
  original.title = 'same-name';
  original.session.rawMetadata = { ...original.session.rawMetadata, ste_catalog: { fileName: 'same-name' } };
  const replacement = { ...buildStoryFromSession(session('replacement-session'), 'character-a'),
    id: 'replacement-story', title: 'same-name',
  };
  replacement.session.messages[0].content = 'replacement-only prose';
  replacement.session.rawMetadata = { ...replacement.session.rawMetadata, ste_catalog: { fileName: 'same-name' } };
  function replace(change: 'delete' | 'rebind') {
    if (change === 'delete') f.stories.items.delete(original.id);
    else f.stories.items.set(original.id, { ...original, characterId: 'character-b' });
    f.stories.items.set(replacement.id, structuredClone(replacement));
  }
  return { ...f, replacement, replace };
}

describe('roleplay character/chat catalog', () => {
  it('uses stable, collision-free keys and enumerates all stored mainlines and internal branches', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    expect(chatKey('a~b', null)).not.toBe(chatKey('a', 'b'));
    expect(chatKey('a', null)).not.toBe(chatKey('a', 'main'));
    expect(avatarKey('a/b')).not.toBe(avatarKey('a%2Fb'));
    expect(catalog.initial).toMatchObject({ storyId: 'story-a', branchId: null, avatar: avatarKey('character-a'), key: chatKey('story-a', null) });
    const chats = await catalog.chats(avatarKey('character-a'));
    expect(chats).toHaveLength(3);
    expect(new Set(chats.map(chat => chat.file_name)).size).toBe(3);
    expect(chats[0].key).toBe(catalog.initial.key);
    expect(chats[0]).toMatchObject({ chat_items: 3, mes: '外面有雨' });
    for (const chat of chats) expect((await catalog.locate(avatarKey('character-a'), chat.file_name))?.key).toBe(chat.key);
    expect(await catalog.chats(avatarKey('character-b'))).toHaveLength(1);
    expect(f.stories.lightReads()).toBe(0);
    expect(f.stories.writes()).toBe(0);
  });

  it('prefers the requested branch, restores the last line only when omitted, and rejects an explicit missing branch', async () => {
    const f = fixture();
    const selected = await createRoleplayCatalog({ ...f.options, branchId: 'branch-a' });
    expect(selected.initial.branchId).toBe('branch-a');
    const chars = await selected.characters();
    expect(chars.find(item => item.avatar === avatarKey('character-a'))?.chat).toBe(selected.initial.fileName);
    expect((await createRoleplayCatalog(f.options)).initial.branchId).toBe('branch-a');
    await expect(createRoleplayCatalog({ ...f.options, branchId: 'missing' })).rejects.toThrow(/分支不存在/);
    await expect(createRoleplayCatalog({ ...f.options, storyId: 'missing' })).rejects.toThrow(/故事不存在/);
    expect(chars[0]).toMatchObject({ name: '林', description: '守门人', custom_card_field: ['keep'], data: { extensions: { plugin: { keep: true } } } });
  });

  it('keeps two captured repositories isolated even when their character and story IDs match', async () => {
    const a = fixture(); const b = fixture();
    const first = await createRoleplayCatalog({ ...a.options, branchId: null });
    const second = await createRoleplayCatalog({ ...b.options, branchId: null });
    await first.rename(first.initial.avatar, first.initial.fileName, '库 A 的新名字');
    expect(a.stories.items.get('story-a')?.title).toBe('库 A 的新名字');
    expect(b.stories.items.get('story-a')?.title).toBe('雨夜');
    expect((await second.existingLine(second.initial.avatar, second.initial.fileName))?.story.title).toBe('雨夜');
    expect(b.stories.writes()).toBe(0);
  });

  it('reads known chats from their current story without loading every body on each lookup or save', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const lists = f.stories.listReads();
    await catalog.locate(catalog.initial.avatar, catalog.initial.key);
    await updateArchiveStory('story-a', current => ({ session: { ...current.session,
      messages: current.session.messages.map(message => ({ ...message, content: '最新正文' })),
    } }), f.stories.repo);
    const line = await catalog.existingLine(catalog.initial.avatar, catalog.initial.fileName);
    expect(line?.line.session.messages[0].content).toBe('最新正文');
    await catalog.resolveForSave(catalog.initial.avatar, catalog.initial.fileName, encodeLiveChat(session()));
    expect(f.stories.listReads()).toBe(lists);
    expect(f.stories.getReads()).toBeGreaterThanOrEqual(3);
    await f.stories.repo.remove('story-a');
    await expect(catalog.locate(catalog.initial.avatar, catalog.initial.fileName)).rejects.toThrow(/不存在|删除/);
    expect(f.stories.listReads()).toBe(lists);
    expect(f.stories.items.size).toBe(2);
  });

  for (const change of ['delete', 'rebind'] as const) {
    it(`never transfers an issued filename to a replacement story after ${change} and a directory refresh`, async () => {
      const f = replacementFixture();
      const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
      const issued = { ...catalog.initial };
      expect(issued.fileName).toBe('same-name');
      f.replace(change);
      const refreshed = await catalog.chats(issued.avatar);
      const stale = encodeLiveChat(session()); stale[1].mes = 'late original prose';
      await expect(catalog.resolveForSave(issued.avatar, issued.fileName, stale)).rejects.toThrow(/不存在|删除|角色/);
      await expect(catalog.existingLine(issued.avatar, issued.fileName)).rejects.toThrow(/不存在|删除|角色/);
      const replacement = refreshed.find(chat => chat.key === chatKey('replacement-story', null))!;
      expect(replacement.file_name).not.toBe(`${issued.fileName}.jsonl`);
      const located = await catalog.locate(issued.avatar, replacement.file_name);
      expect(located?.storyId).toBe('replacement-story');
      expect((await catalog.resolveForSave(issued.avatar, located!.fileName, encodeLiveChat(f.replacement.session))).storyId).toBe('replacement-story');
      expect(f.stories.items.get('replacement-story')).toEqual(f.replacement);
      expect(f.stories.writes()).toBe(0);
    });

    it(`does not rename a replacement story when an old rename was already awaiting its list during ${change}`, async () => {
      const f = replacementFixture();
      let blockList = false;
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      const queuedRepo: Repo<ArchiveStory> = { ...f.stories.repo, list: async () => {
        if (blockList) { blockList = false; started(); await gate; }
        return f.stories.repo.list();
      } };
      const catalog = await createRoleplayCatalog({ ...f.options, stories: queuedRepo, branchId: null });
      blockList = true;
      const rename = catalog.rename(catalog.initial.avatar, catalog.initial.fileName, 'late original rename');
      const rejected = expect(rename).rejects.toThrow(/不存在|删除|角色/);
      await entered;
      f.replace(change);
      release();
      await rejected;
      expect(f.stories.items.get('replacement-story')).toEqual(f.replacement);
      expect(f.stories.writes()).toBe(0);
    });
  }

  it('keeps a disambiguated persistent filename round-trippable through locate, existingLine and save resolution', async () => {
    const f = fixture();
    for (const id of ['story-a', 'story-b']) {
      const story = f.stories.items.get(id)!;
      story.session.rawMetadata = { ...story.session.rawMetadata, ste_catalog: { fileName: 'shared-alias' } };
    }
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const sharedKeys = new Set([chatKey('story-a', null), chatKey('story-b', null)]);
    const chats = (await catalog.chats(catalog.initial.avatar)).filter(chat => sharedKeys.has(chat.key));
    expect(new Set(chats.map(chat => chat.file_name)).size).toBe(2);
    for (const chat of chats) {
      const located = await catalog.locate(catalog.initial.avatar, chat.file_name);
      expect(located?.fileName).toBe(chat.file_name.replace(/\.jsonl$/, ''));
      const current = await catalog.existingLine(catalog.initial.avatar, located!.fileName);
      expect(current?.locator).toEqual(located);
      const resolved = await catalog.resolveForSave(catalog.initial.avatar, located!.fileName, encodeLiveChat(current!.line.session));
      expect(resolved).toMatchObject({ key: chat.key, fileName: located!.fileName, created: false });
      expect((await catalog.locate(catalog.initial.avatar, chat.key))?.fileName).toBe(located!.fileName);
    }
    await expect(catalog.locate(catalog.initial.avatar, 'shared-alias')).rejects.toThrow(/重名|多个/);
    expect(f.stories.writes()).toBe(0);
  });

  it('leaves another character’s chat pending until saving and creates it once for overlapping saves', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const empty = (await catalog.characters()).find(item => item.avatar === avatarKey('character-empty'))!;
    expect(await catalog.locate(empty.avatar, empty.chat)).toBeUndefined();
    expect(await catalog.existingLine(empty.avatar, empty.chat)).toBeUndefined();
    expect(await catalog.chats(empty.avatar)).toEqual([]);
    expect(f.stories.writes()).toBe(0);
    const payload = encodeLiveChat(session('new'));
    const anotherCatalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const [first, second] = await Promise.all([
      catalog.resolveForSave(empty.avatar, empty.chat, payload),
      anotherCatalog.resolveForSave(empty.avatar, `${empty.chat}.jsonl`, payload),
    ]);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ storyId: first.storyId, branchId: null, created: false, key: first.key });
    expect(f.stories.writes()).toBe(1);
    const stored = f.stories.items.get(first.storyId)!;
    expect(stored.characterId).toBe('character-empty');
    expect(stored.session.messages.map(message => message.id)).toEqual(['m1', 'm2', 'm3']);
    expect(stored.session.rawMetadata?.foreign_header).toEqual({ keep: true });
    const changed = structuredClone(payload); changed[2].mes = '由 session 保存的下一版';
    await catalog.resolveForSave(empty.avatar, empty.chat, changed);
    expect(f.stories.writes()).toBe(1);
    expect(f.stories.items.get(first.storyId)?.session.messages[1].content).toBe('请进');
  });

  it('creates a checkpoint inside the parent story while retaining the parent, other branches and surviving bookmarks', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    await updateArchiveStory('story-a', () => ({ rating: 9 }), f.stories.repo);
    const before = structuredClone(f.stories.items.get('story-a')!);
    const payload = encodeLiveChat(before.session).slice(0, 3);
    payload[0] = { user_name: 'unused', character_name: 'unused', chat_metadata: { main_chat: catalog.initial.fileName, checkpoint: true } };
    const child = await catalog.resolveForSave(catalog.initial.avatar, '雨夜 - Checkpoint #1', payload);
    expect(child).toMatchObject({ storyId: 'story-a', created: true });
    expect(child.branchId).not.toBeNull();
    expect(f.stories.items.size).toBe(3);
    const after = f.stories.items.get('story-a')!;
    expect(after.session).toEqual(before.session);
    expect(after.markers).toEqual(before.markers);
    expect(after.favorites).toEqual(before.favorites);
    expect(after.meta).toEqual(before.meta);
    expect(after.rating).toBe(9);
    expect(after.branches?.[0]).toEqual(before.branches?.[0]);
    const branch = after.branches!.find(item => item.id === child.branchId)!;
    expect(branch.session.id).not.toBe(before.session.id);
    expect(branch.session.messages.map(message => message.id)).toEqual(['m1', 'm2']);
    expect(branch.markers).toEqual([before.markers[0]]);
    expect(branch.favorites).toEqual(['m2']);
    expect(branch.session.rawMetadata).toMatchObject({ foreign_header: { keep: true }, chat_metadata: { plugin: { count: 2 }, main_chat: catalog.initial.fileName, checkpoint: true } });
    expect((await catalog.resolveForSave(catalog.initial.avatar, '雨夜 - Checkpoint #1', payload)).created).toBe(false);
    expect(f.stories.items.get('story-a')?.branches).toHaveLength(2);
    const grandchildPayload = encodeLiveChat(branch.session);
    grandchildPayload[0].chat_metadata!.main_chat = child.fileName;
    const grandchild = await catalog.resolveForSave(child.avatar, '分支的分支', grandchildPayload);
    expect(grandchild.storyId).toBe('story-a');
    expect(grandchild.branchId).not.toBe(child.branchId);
  });

  it('renames only display metadata, persists old aliases across reopening, and rejects ambiguous names', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    await expect(catalog.locate(catalog.initial.avatar, '雨夜')).rejects.toThrow(/重名|多个/);
    const before = structuredClone(f.stories.items.get('story-a')!);
    const renamed = await catalog.rename(catalog.initial.avatar, `${catalog.initial.fileName}.jsonl`, '新故事名.jsonl');
    expect(renamed.sanitizedFileName).toBe('新故事名');
    expect(renamed.locator.key).toBe(catalog.initial.key);
    const after = f.stories.items.get('story-a')!;
    expect(after).toMatchObject({ title: '新故事名', rating: 8, status: '进行中', sourcePath: '原始聊天.jsonl' });
    expect(after.session.messages).toEqual(before.session.messages);
    expect(after.meta).toEqual(before.meta);
    expect(after.branches).toEqual(before.branches);
    expect(after.markers).toEqual(before.markers);
    expect(after.session.rawMetadata).toMatchObject({ foreign_header: { keep: true }, chat_metadata: { plugin: { count: 2 } } });
    const reopened = await createRoleplayCatalog({ ...f.options, branchId: null });
    expect((await reopened.locate(catalog.initial.avatar, catalog.initial.fileName))?.key).toBe(catalog.initial.key);
    expect((await reopened.locate(catalog.initial.avatar, '新故事名'))?.key).toBe(catalog.initial.key);
    await expect(reopened.rename(catalog.initial.avatar, chatKey('story-b', null), '新故事名')).rejects.toThrow(/重名|占用/);
    const other = await reopened.rename(avatarKey('character-b'), chatKey('story-c', null), '新故事名');
    expect(other.locator.storyId).toBe('story-c');
    const branch = await reopened.rename(catalog.initial.avatar, chatKey('story-a', 'branch-a'), '改名的支线');
    expect(branch.locator.branchId).toBe('branch-a');
    expect(f.stories.items.get('story-a')?.title).toBe('新故事名');
    expect(f.stories.items.get('story-a')?.branches?.[0].name).toBe('改名的支线');
  });

  it('treats ST filenames as opaque aliases and never as source paths', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const named = await catalog.rename(catalog.initial.avatar, catalog.initial.fileName, '../名字/只是别名');
    expect(named.sanitizedFileName).toBe('../名字/只是别名');
    expect((await catalog.locate(catalog.initial.avatar, '../名字/只是别名.jsonl'))?.storyId).toBe('story-a');
    expect(f.stories.items.get('story-a')?.sourcePath).toBe('原始聊天.jsonl');
  });

  it.each(['display name', 'stable key'] as const)('resolves stable identities after renaming to a %s and importing a branch copy', async renameTo => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    await catalog.rename(catalog.initial.avatar, catalog.initial.fileName, renameTo === 'stable key' ? catalog.initial.key : '改名后的主线');
    const copied = structuredClone(f.stories.items.get('story-a')!.session);
    expect(copied.rawMetadata?.ste_catalog).toMatchObject({ aliases: expect.arrayContaining([catalog.initial.key]) });
    const imported = buildBranchFromSession(copied, '导入的支线');
    await updateArchiveStory('story-a', current => ({ branches: [...current.branches ?? [], imported] }), f.stories.repo);

    const reopened = await createRoleplayCatalog({ ...f.options, branchId: null });
    const chats = await reopened.chats(reopened.initial.avatar);
    const writes = f.stories.writes();
    const lists = f.stories.listReads();
    for (const branchId of [null, imported.id]) {
      const key = chatKey('story-a', branchId);
      const expected = { storyId: 'story-a', branchId, key };
      const listed = chats.find(chat => chat.key === key)!;
      const located = await reopened.locate(reopened.initial.avatar, key);
      expect(located).toMatchObject(expected);
      expect(located?.fileName).toBe(listed.file_name.replace(/\.jsonl$/, ''));
      expect(await reopened.locate(reopened.initial.avatar, listed.file_name)).toEqual(located);
      expect(await reopened.existingLine(reopened.initial.avatar, key)).toMatchObject({ locator: expected });
      expect(await reopened.resolveForSave(reopened.initial.avatar, key, encodeLiveChat(copied)))
        .toMatchObject({ ...expected, created: false });
      await expect(reopened.locate(avatarKey('character-b'), key)).rejects.toThrow(/角色/);
    }
    expect(f.stories.writes()).toBe(writes);
    expect(f.stories.listReads()).toBe(lists);
  });

  for (const reopen of [false, true]) {
    it(`rejects a deleted branch key retained in an imported copy's aliases ${reopen ? 'after reopening' : 'after refreshing'}`, async () => {
      const f = fixture();
      const catalog = await createRoleplayCatalog({ ...f.options, branchId: 'branch-a' });
      const original = catalog.initial;
      await catalog.rename(original.avatar, original.key, '改名后的分支');
      const copied = structuredClone(f.stories.items.get('story-a')!.branches![0].session);
      expect(copied.rawMetadata?.ste_catalog).toMatchObject({ aliases: expect.arrayContaining([original.key]) });
      const imported = buildBranchFromSession(copied, '导入的分支副本');
      await updateArchiveStory('story-a', current => ({ branches: [...current.branches ?? [], imported] }), f.stories.repo);
      const beforeDeletion = await createRoleplayCatalog({ ...f.options, branchId: null });
      await updateArchiveStory('story-a', current => ({ branches: current.branches!.filter(branch => branch.id !== original.branchId) }), f.stories.repo);
      const current = reopen ? await createRoleplayCatalog({ ...f.options, branchId: null }) : beforeDeletion;
      await current.chats(original.avatar);
      const writes = f.stories.writes();

      await expect(current.locate(original.avatar, original.key)).rejects.toThrow(/不存在|删除/);
      await expect(current.existingLine(original.avatar, original.key)).rejects.toThrow(/不存在|删除/);
      await expect(current.resolveForSave(original.avatar, original.key, encodeLiveChat(copied))).rejects.toThrow(/不存在|删除/);
      const child = encodeLiveChat(copied);
      child[0].chat_metadata!.main_chat = original.key;
      await expect(current.resolveForSave(original.avatar, '已删父聊天的新分支', child)).rejects.toThrow(/不存在|删除/);
      expect(await current.locate(original.avatar, chatKey('story-a', imported.id))).toMatchObject({ branchId: imported.id });
      expect(f.stories.writes()).toBe(writes);
    });
  }

  it('keeps unbound stories accessible through synthetic character DTOs without creating character records', async () => {
    const f = fixture();
    const unbound = { ...buildStoryFromSession(session('unbound')), id: 'unbound' };
    f.stories.items.set(unbound.id, unbound);
    const catalog = await createRoleplayCatalog({ ...f.options, storyId: unbound.id, branchId: null });
    expect((await catalog.characters()).some(item => item.avatar === catalog.initial.avatar)).toBe(true);
    expect((await catalog.existingLine(catalog.initial.avatar, catalog.initial.fileName))?.story.id).toBe(unbound.id);
    const created = await catalog.resolveForSave(catalog.initial.avatar, '未绑定的新聊天', encodeLiveChat(session('unbound-new')));
    expect(f.stories.items.get(created.storyId)?.characterId).toBeUndefined();
    expect((await catalog.locate(catalog.initial.avatar, '未绑定的新聊天'))?.key).toBe(created.key);
    expect(f.characters.writes()).toBe(0);
  });

  it('rejects invalid identities, missing parents, cross-character keys and deleted lines without writes', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    const payload = encodeLiveChat(session());
    payload.push({ mes: '没有 ID', is_user: false });
    await expect(catalog.resolveForSave(catalog.initial.avatar, '坏消息', payload)).rejects.toThrow(/消息.*ID/);
    const missingParent = encodeLiveChat(session()); missingParent[0].chat_metadata!.main_chat = '不存在的父聊天';
    await expect(catalog.resolveForSave(catalog.initial.avatar, '坏分支', missingParent)).rejects.toThrow(/父聊天|原聊天/);
    await expect(catalog.resolveForSave('missing.png', '坏角色', encodeLiveChat(session()))).rejects.toThrow(/角色不存在/);
    await expect(catalog.locate(avatarKey('character-b'), catalog.initial.key)).rejects.toThrow(/角色/);
    await expect(catalog.rename(catalog.initial.avatar, catalog.initial.fileName, ' ')).rejects.toThrow(/名称/);
    await expect(catalog.rename(catalog.initial.avatar, catalog.initial.fileName, 'bad\u0000name')).rejects.toThrow(/名称/);
    await f.stories.repo.remove('story-a');
    await expect(catalog.resolveForSave(catalog.initial.avatar, catalog.initial.fileName, encodeLiveChat(session()))).rejects.toThrow(/不存在|删除/);
    expect(f.stories.writes()).toBe(0);
  });

  it('does not publish a failed creation or rename, and an explicit retry creates one story', async () => {
    const f = fixture();
    const catalog = await createRoleplayCatalog({ ...f.options, branchId: null });
    f.stories.fail(true);
    await expect(catalog.resolveForSave(avatarKey('character-empty'), '重试聊天', encodeLiveChat(session()))).rejects.toThrow('磁盘写入失败');
    await expect(catalog.rename(catalog.initial.avatar, catalog.initial.fileName, '失败的改名')).rejects.toThrow('磁盘写入失败');
    expect(await catalog.locate(avatarKey('character-empty'), '重试聊天')).toBeUndefined();
    expect(await catalog.locate(catalog.initial.avatar, '失败的改名')).toBeUndefined();
    f.stories.fail(false);
    const created = await catalog.resolveForSave(avatarKey('character-empty'), '重试聊天', encodeLiveChat(session()));
    expect(created.created).toBe(true);
    expect(f.stories.writes()).toBe(1);
  });

  it('checks isCurrent inside the existing story queue before a delayed rename can write', async () => {
    const f = fixture();
    let current = true;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queuedRepo: Repo<ArchiveStory> = { ...f.stories.repo, get: async id => {
      const story = await f.stories.repo.get(id);
      started();
      await gate;
      return story;
    } };
    const catalog = await createRoleplayCatalog({ ...f.options, stories: queuedRepo, branchId: null, isCurrent: () => current });
    const rename = catalog.rename(catalog.initial.avatar, catalog.initial.fileName, '迟到的名字');
    const rejected = expect(rename).rejects.toThrow(/切换|关闭|失效/);
    await entered;
    current = false;
    release();
    await rejected;
    expect(f.stories.items.get('story-a')?.title).toBe('雨夜');
    expect(f.stories.writes()).toBe(0);
    await expect(catalog.resolveForSave(avatarKey('character-empty'), '迟到的新故事', encodeLiveChat(session()))).rejects.toThrow(/切换|关闭|失效/);
    expect(f.stories.writes()).toBe(0);
  });
});
