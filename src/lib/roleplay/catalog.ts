import type { Repo } from '@/lib/repo';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import {
  buildBranchFromSession, buildStoryFromSession, getBranchLine, resolveInitialBranchId,
  saveArchiveStory, sortStoriesForDisplay, updateArchiveStory, type BranchLine,
} from '@/lib/archive-db';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { normalizeCharacterCard, type STCharacterCard } from '@/lib/png-parser';
import { decodeLiveChat, encodeLiveChat } from './live-chat';
import { captureBranchRuntimeParent } from './branch-inheritance';
import { characterFilterTags } from '@/lib/tag-taxonomy';
import { toStoryIndex, type StoryIndexEntry } from '@/lib/story-index';

export interface ChatLocator {
  storyId: string;
  branchId: string | null;
  avatar: string;
  fileName: string;
  key: string;
}

export interface CatalogLine {
  locator: ChatLocator;
  story: ArchiveStory;
  line: BranchLine;
}

export interface CatalogCharacterDto extends Record<string, unknown> {
  name: string;
  avatar: string;
  chat: string;
  data: Record<string, unknown>;
}

export interface CatalogChatDto {
  key: string;
  file_name: string;
  display_name: string;
  file_size: number;
  chat_items: number;
  mes: string;
  last_mes: number;
  metadata: Record<string, unknown>;
}

export interface RoleplayCatalogOptions {
  stories: Repo<ArchiveStory>;
  characters: Repo<ArchiveCharacter>;
  storyId: string;
  branchId?: string | null;
  isCurrent?: () => boolean;
  /** Project small host metadata while a full card is already being read. */
  onCharacterRead?: (character: ArchiveCharacter) => void;
}

export interface RoleplayCatalog {
  readonly initial: ChatLocator;
  characters(): Promise<CatalogCharacterDto[]>;
  character(avatar: string): Promise<CatalogCharacterDto | undefined>;
  chats(avatar: string): Promise<CatalogChatDto[]>;
  locate(avatar: string, fileName: string): Promise<ChatLocator | undefined>;
  existingLine(avatar: string, fileName: string): Promise<CatalogLine | undefined>;
  /** Existing chat bodies are saved by openStorySession; only first creation writes here. */
  resolveForSave(avatar: string, fileName: string, payload: unknown): Promise<ChatLocator & { created: boolean }>;
  rename(avatar: string, oldName: string, newName: string): Promise<{ sanitizedFileName: string; locator: ChatLocator }>;
}

const encodeKey = (value: string) => encodeURIComponent(value).replace(/[.!'()*~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export const avatarKey = (characterId: string): string => `ste-${encodeKey(characterId)}.png`;
export const chatKey = (storyId: string, branchId: string | null): string => `ste-chat-${encodeKey(storyId)}~${branchId === null ? 'main' : `branch-${encodeKey(branchId)}`}`;
// Qualified filenames may start with a key, but are still ordinary aliases.
const isChatKey = (name: string) => /^ste-chat-(?:[\w-]|%[0-9A-F]{2})*~(?:main|branch-(?:[\w-]|%[0-9A-F]{2})*)$/.test(name);
const orphanAvatar = (storyId: string) => `ste~story~${encodeKey(storyId)}.png`;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** ST sends both stems and .jsonl names. These are labels, never filesystem paths. */
function chatName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('聊天名称必须是文本');
  const name = value.trim().replace(/\.jsonl$/i, '').trim();
  if (!name || name.length > 1024 || /\p{Cc}/u.test(name)) throw new Error('聊天名称无效');
  return name;
}

function optionalName(value: unknown): string | undefined {
  try { return chatName(value); } catch { return undefined; }
}

function catalogMetadata(session: ChatSession) {
  return object(session.rawMetadata?.ste_catalog);
}

function storedAliases(session: ChatSession): string[] {
  const metadata = catalogMetadata(session);
  return [metadata.fileName, ...(Array.isArray(metadata.aliases) ? metadata.aliases : [])]
    .map(optionalName).filter((name): name is string => name !== undefined);
}

function storyAvatar(story: ArchiveStory): string {
  if (story.characterId) return avatarKey(story.characterId);
  const saved = catalogMetadata(story.session).avatar;
  return typeof saved === 'string' && saved.startsWith('ste~story~') ? saved : orphanAvatar(story.id);
}

function withCatalogMetadata(session: ChatSession, locator: ChatLocator, aliases: string[]): ChatSession {
  return {
    ...session,
    rawMetadata: {
      ...structuredClone(session.rawMetadata ?? {}),
      ste_catalog: {
        ...structuredClone(catalogMetadata(session)),
        fileName: locator.fileName,
        aliases: [...new Set([locator.key, locator.fileName, ...aliases])],
        avatar: locator.avatar,
      },
    },
  };
}

interface Person {
  id?: string;
  synthetic?: boolean;
  name?: string;
  displayMeta?: ArchiveCharacter['displayMeta'];
  tags?: string[];
  type?: ArchiveCharacter['type'];
  rating?: number;
  avatar: string;
  card: STCharacterCard;
  createdAt: number;
  updatedAt: number;
}

interface Entry {
  locator: ChatLocator;
  story: StoryIndexEntry;
  aliases: string[];
  displayName: string;
  updatedAt: number;
}

interface Snapshot {
  people: Map<string, Person>;
  entries: Entry[];
  byKey: Map<string, Entry>;
  aliases: Map<string, Map<string, Set<string>>>;
}

// Share alias/create serialization only between catalogs using this exact captured repo.
const catalogQueues = new WeakMap<Repo<ArchiveStory>, KeyedSerialQueue>();

export async function createRoleplayCatalog(options: RoleplayCatalogOptions): Promise<RoleplayCatalog> {
  const { stories, characters } = options;
  const mutations = catalogQueues.get(stories) ?? new KeyedSerialQueue();
  catalogQueues.set(stories, mutations);
  const seenAliases = new Map<string, string | null>();
  const knownLocators = new Map<string, ChatLocator>();
  const knownPeople = new Map<string, { id?: string }>();
  let initialKey: string | undefined = undefined;

  function assertCurrent() {
    if (options.isCurrent && !options.isCurrent()) throw new Error('文件库或游玩会话已切换，目录操作已停止');
  }

  // saveArchiveStory also queues new records. Check again at its actual put boundary.
  const guardedStories: Repo<ArchiveStory> = {
    list: () => stories.list(), listLight: () => stories.listLight(), get: id => stories.get(id),
    put: (item, settings) => { assertCurrent(); return stories.put(item, settings); },
    remove: id => { assertCurrent(); return stories.remove(id); },
  };

  const aliasId = (avatar: string, name: string) => JSON.stringify([avatar, name]);

  function rememberAlias(avatar: string, name: string, key: string | null) {
    const id = aliasId(avatar, name);
    // An issued name must never acquire a different owner during this catalog's lifetime.
    if (!seenAliases.has(id)) seenAliases.set(id, key);
  }

  async function snapshot(): Promise<Snapshot> {
    assertCurrent();
    const [records, allCharacters] = await Promise.all([stories.listLight(), characters.list()]);
    // Full bodies remain behind get(). The persistent vault projection includes
    // only names/aliases needed to disambiguate every mainline and branch.
    const allStories = records.map(toStoryIndex);
    assertCurrent();
    const people = new Map(allCharacters.map(character => {
      const avatar = avatarKey(character.id);
      options.onCharacterRead?.(character);
      return [avatar, { ...character, avatar }] as [string, Person];
    }));
    const entries: Entry[] = [];
    for (const story of sortStoriesForDisplay(allStories)) {
      const info = story.chatIndex;
      if (!info) throw new Error('故事目录摘要缺失，请重新打开文件库');
      const avatar = story.characterId ? avatarKey(story.characterId)
        : info.avatar?.startsWith('ste~story~') ? info.avatar : orphanAvatar(story.id);
      if (!people.has(avatar)) people.set(avatar, {
        id: story.characterId, synthetic: true, name: story.title, avatar, card: { name: info.characterName },
        createdAt: story.createdAt, updatedAt: story.updatedAt,
      });
      for (const line of info.lines) {
        const key = chatKey(story.id, line.branchId);
        const displayName = line.branchId !== null ? `${story.title} · ${line.name}` : story.title;
        const fileName = optionalName(line.fileName) ?? optionalName(displayName) ?? key;
        const aliases = [line.fileName, ...line.aliases].map(optionalName).filter((name): name is string => name !== undefined);
        entries.push({ locator: { storyId: story.id, branchId: line.branchId, avatar, fileName, key }, story, aliases, displayName, updatedAt: line.updatedAt });
      }
    }
    const byKey = new Map(entries.map(entry => [entry.locator.key, entry]));
    const aliases = new Map<string, Map<string, Set<string>>>();
    function add(entry: Entry, name: string) {
      const names = aliases.get(entry.locator.avatar) ?? new Map<string, Set<string>>();
      const owners = names.get(name) ?? new Set<string>();
      owners.add(entry.locator.key);
      names.set(name, owners);
      aliases.set(entry.locator.avatar, names);
    }
    for (const entry of entries) {
      for (const name of [entry.locator.key, entry.locator.fileName, ...entry.aliases]) add(entry, name);
    }
    // Equal display titles remain readable, but never select an arbitrary story.
    for (const entry of [...entries].sort((a, b) => a.locator.key.localeCompare(b.locator.key))) {
      const { locator } = entry;
      const names = aliases.get(locator.avatar)!;
      const occupied = (name: string) => {
        const id = aliasId(locator.avatar, name);
        return (seenAliases.has(id) ? seenAliases.get(id) !== locator.key : [...names.get(name) ?? []].some(key => key !== locator.key))
          || (byKey.has(name) && name !== locator.key);
      };
      if (occupied(locator.fileName)) {
        const base = `${locator.fileName} [${locator.key}]`;
        locator.fileName = base;
        let suffix = 2;
        while (occupied(locator.fileName)) locator.fileName = `${base} ${suffix++}`;
        add(entry, locator.fileName);
      }
    }
    for (const entry of entries) knownLocators.set(entry.locator.key, { ...entry.locator });
    for (const [avatar, person] of people) knownPeople.set(avatar, { id: person.id });
    for (const [avatar, names] of aliases) {
      for (const [name, owners] of names) rememberAlias(avatar, name, owners.size === 1 ? [...owners][0] : null);
    }
    entries.sort((a, b) => Number(b.locator.key === initialKey) - Number(a.locator.key === initialKey));
    return { people, entries, byKey, aliases };
  }

  function find(state: Snapshot, avatar: string, fileName: string): Entry | undefined {
    if (!state.people.has(avatar)) throw new Error('角色不存在');
    const name = chatName(fileName);
    // Imports can copy aliases, but a stable key only identifies its own captured line.
    let key = knownLocators.has(name) ? name : undefined;
    if (!key) {
      if (isChatKey(name)) throw new Error('故事或分支不存在');
      const remembered = seenAliases.get(aliasId(avatar, name));
      const owners = state.aliases.get(avatar)?.get(name);
      if (remembered === null || (remembered === undefined && owners && owners.size > 1)) throw new Error('聊天名称重名，对应多个故事或分支，请使用列表中的名称');
      key = remembered ?? (owners?.size ? [...owners][0] : undefined);
    }
    if (key) {
      const entry = state.byKey.get(key);
      if (!entry) throw new Error('故事或分支已删除，聊天不存在');
      if (entry.locator.avatar !== avatar) throw new Error('聊天角色与故事不匹配');
      return entry;
    }
    if (name.startsWith('ste-chat-')) throw new Error('故事或分支不存在');
    return undefined;
  }

  /** Cache only identities. Every known lookup still reads its current story and line. */
  async function knownEntry(avatar: string, fileName: string): Promise<CatalogLine | undefined> {
    assertCurrent();
    const name = chatName(fileName);
    let locator = knownLocators.get(name);
    if (!locator && !isChatKey(name)) {
      const remembered = seenAliases.get(aliasId(avatar, name));
      if (remembered === null) throw new Error('聊天名称重名，对应多个故事或分支，请使用列表中的名称');
      locator = knownLocators.get(remembered ?? name);
    }
    if (!locator) return undefined;
    if (locator.avatar !== avatar) throw new Error('聊天角色与故事不匹配');
    const story = await stories.get(locator.storyId);
    assertCurrent();
    if (!story) throw new Error('故事已删除，聊天不存在');
    if (storyAvatar(story) !== avatar) throw new Error('聊天角色与故事不匹配');
    const line = getBranchLine(story, locator.branchId);
    if (!line) throw new Error('故事分支已删除，聊天不存在');
    // Refresh the body, retaining the catalog's already disambiguated filename.
    return { locator, story, line };
  }

  const first = await snapshot();
  const initialStory = await stories.get(options.storyId);
  assertCurrent();
  if (!initialStory) throw new Error('故事不存在');
  if (options.branchId !== undefined && options.branchId !== null && !getBranchLine(initialStory, options.branchId)) throw new Error('故事分支不存在');
  const initialBranch = resolveInitialBranchId(initialStory, options.branchId);
  initialKey = chatKey(initialStory.id, initialBranch);
  const initialEntry = first.byKey.get(initialKey);
  if (!initialEntry) throw new Error('故事或分支不存在');
  const initial = Object.freeze({ ...initialEntry.locator });
  const initialUser = structuredClone(getBranchLine(initialStory, initialBranch)!.session.user);

  function characterDto(person: Person, chats: Pick<Entry, 'locator' | 'updatedAt'>[]): CatalogCharacterDto {
    const normalized = normalizeCharacterCard(person.card);
    const original = structuredClone(person.card);
    const data = original.data ?? original;
    const extensions = object(data.extensions);
    const rawFavorite = extensions.fav ?? original.fav;
    const favorite = rawFavorite === true || rawFavorite === 'true';
    const placeholder = !normalized.name.trim() || /^unused$/i.test(normalized.name.trim());
    const name = person.synthetic && placeholder ? `未绑定角色 · ${person.name || '聊天'}` : person.displayMeta?.name || normalized.name || person.name || '未命名角色';
    const tags = person.tags ? [...characterFilterTags({ tags: person.tags, rating: person.rating }), ...(person.type ? [`类型/${person.type}`] : [])] : normalized.tags;
    return {
      ...original,
      fav: favorite,
      name, description: normalized.description, personality: normalized.personality,
      scenario: normalized.scenario, first_mes: normalized.firstMessage, mes_example: normalized.messageExample,
      creatorcomment: normalized.creatorNotes, tags,
      avatar: person.avatar, chat: chats[0]?.locator.fileName ?? `${normalized.name} - 新聊天`,
      create_date: person.createdAt, date_last_chat: Math.max(0, ...chats.map(entry => entry.updatedAt)),
      data: { ...data, name, tags, extensions: { ...extensions, fav: favorite } },
    };
  }

  return {
    initial,
    async characters() {
      const state = await snapshot();
      return [...state.people.values()].filter(person => !person.synthetic || person.avatar === initial.avatar || !/^\s*(?:unused)?\s*$/i.test(normalizeCharacterCard(person.card).name))
        .map(person => characterDto(person, state.entries.filter(entry => entry.locator.avatar === person.avatar)));
    },
    async character(avatar) {
      assertCurrent();
      if (!knownPeople.has(avatar)) {
        const state = await snapshot();
        const person = state.people.get(avatar);
        return person ? characterDto(person, state.entries.filter(entry => entry.locator.avatar === avatar)) : undefined;
      }
      const known = knownPeople.get(avatar)!;
      const locators = [...knownLocators.values()].filter(locator => locator.avatar === avatar);
      const [character, related] = await Promise.all([
        known.id ? characters.get(known.id) : undefined,
        Promise.all([...new Set(locators.map(locator => locator.storyId))].map(id => stories.get(id))),
      ]);
      assertCurrent();
      const currentStories = sortStoriesForDisplay(related.filter(story => story && storyAvatar(story) === avatar) as ArchiveStory[]);
      const chats = currentStories.flatMap(story => locators.filter(locator => locator.storyId === story.id && getBranchLine(story, locator.branchId))
        .map(locator => ({ locator, updatedAt: story.branches?.find(branch => branch.id === locator.branchId)?.updatedAt ?? story.updatedAt })));
      chats.sort((a, b) => Number(b.locator.key === initialKey) - Number(a.locator.key === initialKey));
      if (character) options.onCharacterRead?.(character);
      const story = currentStories[0];
      const person = character ? { ...character, avatar } : story ? { avatar, synthetic: true, name: story.title, card: { name: story.session.character.name },
        createdAt: story.createdAt, updatedAt: story.updatedAt } : undefined;
      return person ? characterDto(person, chats) : undefined;
    },
    async chats(avatar) {
      const state = await snapshot();
      if (!state.people.has(avatar)) throw new Error('角色不存在');
      const selectedEntries = state.entries.filter(entry => entry.locator.avatar === avatar);
      // ST's list exposes exact serialized size, latest content and extension
      // metadata. Read just this character's stories to preserve that contract.
      const current = new Map(await Promise.all([...new Set(selectedEntries.map(entry => entry.story.id))]
        .map(async id => [id, await stories.get(id)] as const)));
      assertCurrent();
      return selectedEntries.flatMap(({ locator, displayName, updatedAt }) => {
        const story = current.get(locator.storyId);
        const line = story && storyAvatar(story) === avatar ? getBranchLine(story, locator.branchId) : undefined;
        if (!line) return [];
        return [{
        key: locator.key, file_name: `${locator.fileName}.jsonl`, display_name: displayName,
        file_size: new TextEncoder().encode(JSON.stringify(encodeLiveChat(line.session))).byteLength,
        chat_items: line.session.messages.length, mes: line.session.messages.at(-1)?.content ?? '',
        last_mes: line.session.messages.at(-1)?.timestamp ?? updatedAt,
        metadata: structuredClone(line.session.rawMetadata?.chat_metadata ?? {}),
        }];
      });
    },
    async locate(avatar, fileName) {
      const entry = await knownEntry(avatar, fileName) ?? find(await snapshot(), avatar, fileName);
      return entry ? { ...entry.locator } : undefined;
    },
    async existingLine(avatar, fileName) {
      let entry = await knownEntry(avatar, fileName);
      if (!entry) {
        const summary = find(await snapshot(), avatar, fileName);
        if (summary) entry = await knownEntry(avatar, summary.locator.key);
      }
      return entry ? structuredClone({ locator: entry.locator, story: entry.story, line: entry.line }) : undefined;
    },
    async resolveForSave(avatar, fileName, payload) {
      const name = chatName(fileName);
      const incoming = structuredClone(payload);
      return mutations.enqueue(avatar, async () => {
        assertCurrent();
        const known = await knownEntry(avatar, name);
        if (known) return { ...known.locator, created: false };
        const state = await snapshot();
        const existing = find(state, avatar, name);
        if (existing) return { ...existing.locator, created: false };
        const person = state.people.get(avatar)!;
        const seed: ChatSession = {
          id: crypto.randomUUID(), title: name, createdAt: Date.now(), messages: [],
          character: { name: normalizeCharacterCard(person.card).name }, user: structuredClone(initialUser),
        };
        // Validate all stamped IDs before allocating any story or branch.
        const decoded = decodeLiveChat(incoming, seed);
        const mainChat = decoded.rawMetadata?.chat_metadata?.main_chat;
        if (mainChat !== undefined && mainChat !== null && mainChat !== '' && typeof mainChat !== 'string') throw new Error('父聊天名称无效');
        let locator: ChatLocator;
        if (mainChat) {
          const parent = find(state, avatar, mainChat);
          if (!parent) throw new Error('父聊天不存在，不能创建故事分支');
          const saved = await updateArchiveStory(parent.story.id, current => {
            assertCurrent();
            if (storyAvatar(current) !== avatar) throw new Error('聊天角色与故事不匹配');
            const parentLine = getBranchLine(current, parent.locator.branchId);
            if (!parentLine) throw new Error('父聊天分支不存在');
            const session = decodeLiveChat(incoming, { ...parentLine.session, id: seed.id, title: name, createdAt: seed.createdAt });
            session.rawMetadata = { ...session.rawMetadata, chat_metadata: {
              ...structuredClone(parentLine.session.rawMetadata?.chat_metadata ?? {}),
              ...structuredClone(session.rawMetadata?.chat_metadata ?? {}),
            } };
            const branch = buildBranchFromSession(session, name);
            locator = { storyId: current.id, branchId: branch.id, avatar, fileName: name, key: chatKey(current.id, branch.id) };
            branch.session = withCatalogMetadata(session, locator, []);
            branch.session.rawMetadata!.ste_catalog.runtimeParent = captureBranchRuntimeParent(current.id, branch.id,
              parent.locator.branchId, parentLine.session, session);
            const indices = new Map(session.messages.map((message, index) => [message.id, index]));
            branch.markers = parentLine.markers.filter(marker => indices.has(marker.messageId))
              .map(marker => ({ ...structuredClone(marker), messageIndex: indices.get(marker.messageId)! }));
            branch.favorites = parentLine.favorites.filter(id => indices.has(id));
            return { branches: [...current.branches ?? [], branch], updatedAt: Date.now() };
          }, guardedStories);
          if (!saved) throw new Error('父聊天故事不存在');
        } else {
          const story = buildStoryFromSession(decoded, person.id);
          locator = { storyId: story.id, branchId: null, avatar, fileName: name, key: chatKey(story.id, null) };
          story.session = withCatalogMetadata(story.session, locator, []);
          assertCurrent();
          await saveArchiveStory(story, guardedStories);
        }
        knownLocators.set(locator!.key, locator!);
        rememberAlias(avatar, name, locator!.key);
        rememberAlias(avatar, locator!.key, locator!.key);
        return { ...locator!, created: true };
      });
    },
    async rename(avatar, oldName, newName) {
      const name = chatName(newName);
      const originalName = chatName(oldName);
      return mutations.enqueue(avatar, async () => {
        assertCurrent();
        const state = await snapshot();
        const entry = find(state, avatar, originalName);
        if (!entry) throw new Error('聊天不存在');
        const occupied = find(state, avatar, name);
        if (occupied && occupied.locator.key !== entry.locator.key) throw new Error('聊天名称已被占用，不能重名');
        const locator = { ...entry.locator, fileName: name };
        const saved = await updateArchiveStory(locator.storyId, current => {
          assertCurrent();
          if (storyAvatar(current) !== avatar) throw new Error('聊天角色与故事不匹配');
          const line = getBranchLine(current, locator.branchId);
          if (!line) throw new Error('故事分支不存在');
          const session = withCatalogMetadata({ ...line.session, title: name }, locator,
            [...storedAliases(line.session), originalName, entry.locator.fileName]);
          const updatedAt = Date.now();
          if (locator.branchId === null) return { title: name, session, updatedAt };
          return { updatedAt, branches: current.branches!.map(branch => branch.id === locator.branchId ? { ...branch, name, session, updatedAt } : branch) };
        }, guardedStories);
        if (!saved) throw new Error('故事不存在');
        knownLocators.set(locator.key, locator);
        rememberAlias(avatar, name, locator.key);
        return { sanitizedFileName: name, locator };
      });
    },
  };
}
