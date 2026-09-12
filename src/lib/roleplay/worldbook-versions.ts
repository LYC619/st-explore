import { getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import type { Repo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import type { WorldBookItem } from '@/types/worldbook';
import { digest, refsAreCurrent, stableJson, type SourceRef } from './fingerprint';
import { branchKey, isRuntimePath } from './paths';
import type { RuntimeStore } from './runtime-store';

export interface WorldbookVersionProposal {
  operationId: string;
  worldId: string;
  entryId: string | number;
  content: string;
  reason: string;
  sourceRefs: SourceRef[];
}

export type WorldbookVersionStatus = 'draft' | 'active' | 'superseded' | 'invalidated' | 'rejected';

export interface WorldbookVersion {
  id: string;
  operationId: string;
  storyId: string;
  branchId: string | null;
  worldId: string;
  entryId: string;
  version: number;
  content: string;
  reason: string;
  sourceRefs: SourceRef[];
  validFrom: string;
  accepted: boolean;
  status: WorldbookVersionStatus;
  baseEntryDigest: string;
  baseVersionId: string | null;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorldbookVersionsOptions {
  storyId: string;
  branchId: string | null;
  store: RuntimeStore;
  stories: Repo<ArchiveStory>;
  worldbooks: Repo<WorldBookItem>;
  isCurrent?: () => boolean;
}

export interface WorldbookVersions {
  /** Read only, for callers already holding the story queue. */
  inheritanceFiles(targetBranchId: string, session: ChatSession, forkRefs: SourceRef[]): Promise<{ path: string; text: string }[]>;
  list(): Promise<WorldbookVersion[]>;
  effective(worldId: string, entryId: string | number): Promise<WorldbookVersion | null>;
  propose(proposal: WorldbookVersionProposal): Promise<WorldbookVersion>;
  accept(id: string): Promise<WorldbookVersion>;
  reject(id: string): Promise<WorldbookVersion>;
}

type Proposal = Omit<WorldbookVersionProposal, 'entryId'> & { entryId: string };
interface StoredVersion extends Omit<WorldbookVersion, 'status' | 'path'> {
  schema: 1;
  proposalDigest: string;
  rejected: boolean;
}
interface VersionFile { path: string; text: string; record: StoredVersion }

const validTextId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 1024;
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const entryKey = (worldId: string, entryId: string) => stableJson([worldId, entryId]);
const proposalDigest = (proposal: Proposal) => digest(stableJson({ operationId: proposal.operationId,
  worldId: proposal.worldId, entryId: proposal.entryId, content: proposal.content, reason: proposal.reason, sourceRefs: proposal.sourceRefs }));

function validRefs(value: unknown): value is SourceRef[] {
  return Array.isArray(value) && value.length > 0 && value.every(ref => ref && typeof ref === 'object'
    && validTextId(ref.messageId) && validTextId(ref.candidateId) && validDigest(ref.contentDigest) && validDigest(ref.historyDigest));
}

function normalizeEntryId(value: string | number): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('世界书条目 ID 无效');
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('世界书条目 ID 无效');
  const id = String(value);
  if (!validTextId(id)) throw new Error('世界书条目 ID 无效');
  return id;
}

function originalDigest(world: WorldBookItem | undefined, entryId: string): string | null {
  const entries = world?.worldbook.entries;
  return entries && Object.prototype.hasOwnProperty.call(entries, entryId) ? digest(stableJson(entries[entryId])) : null;
}

/** Original assets stay authoritative; accepted branch versions are a sourced overlay in separate JSON files. */
export function createWorldbookVersions(options: WorldbookVersionsOptions): WorldbookVersions {
  const { storyId, branchId, stories, worldbooks } = options;
  const store = options.store.underStoryLock ?? options.store;
  if (!validTextId(storyId) || store.storyId !== storyId) throw new Error('世界书版本与故事不匹配');
  if (branchId !== null && !validTextId(branchId)) throw new Error('世界书版本分支无效');
  const epoch = getVaultEpoch();
  const root = `.ste-control/roleplay/${branchKey(branchId)}/worldbook-versions`;
  if (!isRuntimePath(root, true)) throw new Error('世界书版本目录无效');
  const pathOf = (value: Proposal) => `${root}/${digest(entryKey(value.worldId, value.entryId))}/${digest(value.operationId)}.json`;
  const idOf = (value: Proposal) => digest(stableJson([storyId, branchId, value.worldId, value.entryId, value.operationId]));
  function check() {
    if (getVaultEpoch() !== epoch || options.isCurrent?.() === false) throw new Error('文件库或会话已切换，世界书版本操作已停止');
  }
  function checkSources(refs: SourceRef[], session: ChatSession) {
    if (!refsAreCurrent(refs, session)) throw new Error('世界书版本来源已修改，不能提交旧剧情版本');
  }
  async function inStory<T>(action: (session: ChatSession) => Promise<T>): Promise<T> {
    check();
    let result!: T;
    const story = await updateArchiveStory(storyId, async current => {
      check();
      const line = getBranchLine(current, branchId);
      if (!line) throw new Error('世界书版本所属分支不存在');
      result = await action(line.session);
      check();
      return undefined;
    }, stories);
    if (!story) throw new Error('世界书版本所属故事不存在');
    check();
    return result;
  }
  function parse(text: string, path: string): StoredVersion {
    let value: StoredVersion;
    try { value = JSON.parse(text); } catch { throw new Error(`世界书版本 JSON 损坏：${path}`); }
    if (value?.schema !== 1 || value.storyId !== storyId || value.branchId !== branchId
      || !validTextId(value.worldId) || !validTextId(value.entryId) || !validTextId(value.operationId)
      || typeof value.content !== 'string' || typeof value.reason !== 'string' || !validRefs(value.sourceRefs)
      || !Number.isSafeInteger(value.version) || value.version < 2 || !validDigest(value.baseEntryDigest)
      || (value.baseVersionId !== null && !validDigest(value.baseVersionId))
      || typeof value.accepted !== 'boolean' || typeof value.rejected !== 'boolean' || (value.accepted && value.rejected)
      || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
      || !value.sourceRefs.some(ref => ref.messageId === value.validFrom)
      || value.id !== idOf(value) || path !== pathOf(value) || value.proposalDigest !== proposalDigest(value)) {
      throw new Error(`世界书版本文件格式或校验无效：${path}`);
    }
    return value;
  }
  async function files(): Promise<VersionFile[]> {
    check();
    const paths = await store.list(root);
    check();
    const result: VersionFile[] = [];
    const operations = new Set<string>(), versions = new Set<string>();
    for (const path of paths) {
      if (!path.startsWith(`${root}/`) || !path.endsWith('.json')) continue;
      const text = await store.read(path);
      check();
      if (text === null) continue;
      const record = parse(text, path);
      const versionKey = stableJson([record.worldId, record.entryId, record.version]);
      if (operations.has(record.operationId) || versions.has(versionKey)) throw new Error(`世界书版本文件存在重复操作或编号：${path}`);
      operations.add(record.operationId); versions.add(versionKey);
      result.push({ path, text, record });
    }
    return result;
  }
  async function readOriginal(worldId: string, entryId: string): Promise<string | null> {
    check();
    const world = await worldbooks.get(worldId);
    check();
    return originalDigest(world, entryId);
  }
  async function snapshot(session: ChatSession) {
    const records = await files();
    const worlds = new Map(await Promise.all([...new Set(records.map(file => file.record.worldId))]
      .map(async worldId => [worldId, await worldbooks.get(worldId)] as const)));
    check();
    const originals = new Map<string, string | null>();
    const valid = new Set<string>();
    const active = new Map<string, StoredVersion>();
    for (const { record } of records) {
      const key = entryKey(record.worldId, record.entryId);
      const base = originalDigest(worlds.get(record.worldId), record.entryId);
      originals.set(key, base);
      if (!record.rejected && base === record.baseEntryDigest && refsAreCurrent(record.sourceRefs, session)) {
        valid.add(record.id);
        if (record.accepted && record.version > (active.get(key)?.version ?? 1)) active.set(key, record);
      }
    }
    const views: WorldbookVersion[] = records.map(({ record, path }) => {
      const effective = active.get(entryKey(record.worldId, record.entryId));
      const status: WorldbookVersionStatus = record.rejected ? 'rejected' : !valid.has(record.id) ? 'invalidated'
        : record.accepted ? effective?.id === record.id ? 'active' : 'superseded'
          : record.baseVersionId === (effective?.id ?? null) ? 'draft' : 'invalidated';
      return { id: record.id, operationId: record.operationId, storyId, branchId, worldId: record.worldId, entryId: record.entryId,
        version: record.version, content: record.content, reason: record.reason, sourceRefs: structuredClone(record.sourceRefs),
        validFrom: record.validFrom, accepted: record.accepted, status, baseEntryDigest: record.baseEntryDigest,
        baseVersionId: record.baseVersionId, path, createdAt: record.createdAt, updatedAt: record.updatedAt };
    }).sort((a, b) => a.worldId.localeCompare(b.worldId) || a.entryId.localeCompare(b.entryId) || b.version - a.version);
    return { records, views, originals, active };
  }
  async function write(record: StoredVersion, expected: string | null, session: ChatSession) {
    check();
    checkSources(record.sourceRefs, session);
    const path = pathOf(record);
    if (await store.read(path) !== expected) throw new Error(`世界书版本文件已被修改，请重新读取：${path}`);
    // Worldbook editors use a separate asset queue, so reread the original at the write boundary too.
    if (await readOriginal(record.worldId, record.entryId) !== record.baseEntryDigest) throw new Error('世界书原条目已修改或删除，请重新提出版本');
    check();
    await store.write(path, JSON.stringify(record, null, 2));
  }
  async function decide(id: string, accept: boolean): Promise<WorldbookVersion> {
    if (!validDigest(id)) throw new Error('世界书版本不存在');
    return inStory(async session => {
      const state = await snapshot(session);
      const file = state.records.find(item => item.record.id === id);
      if (!file) throw new Error('世界书版本不存在');
      const record = file.record;
      if (record.rejected) {
        if (accept) throw new Error('世界书版本已拒绝，请重新提出草稿');
        return state.views.find(item => item.id === id)!;
      }
      checkSources(record.sourceRefs, session);
      const key = entryKey(record.worldId, record.entryId);
      if (state.originals.get(key) !== record.baseEntryDigest) throw new Error('世界书原条目已修改或删除，请重新提出版本');
      if (accept && record.accepted) return state.views.find(item => item.id === id)!;
      if (accept && record.baseVersionId !== (state.active.get(key)?.id ?? null)) throw new Error('已接受版本已变化，草稿的基础版本已过期');
      await write({ ...record, accepted: accept, rejected: !accept, updatedAt: Date.now() }, file.text, session);
      return (await snapshot(session)).views.find(item => item.id === id)!;
    });
  }
  return {
    async inheritanceFiles(targetBranchId, session, forkRefs) {
      const targetRoot = `.ste-control/roleplay/${branchKey(targetBranchId)}/worldbook-versions`;
      if (targetBranchId === branchId || !isRuntimePath(targetRoot, true)) throw new Error('世界书继承的目标分支无效');
      const state = await snapshot(session);
      const allowed = new Set(forkRefs.map(ref => stableJson(ref)));
      const valid = new Set(state.views.filter(view => view.accepted && ['active', 'superseded'].includes(view.status)
        && view.sourceRefs.every(ref => allowed.has(stableJson(ref)))).map(view => view.id));
      const selected: StoredVersion[] = [];
      // A version based on excluded future lore must not carry that dependency into the fork.
      for (const { record } of [...state.records].sort((a, b) => a.record.version - b.record.version)) {
        if (valid.has(record.id) && (record.baseVersionId === null || selected.some(base => base.id === record.baseVersionId))) selected.push(record);
      }
      const ids = new Map(selected.map(record => [record.id,
        digest(stableJson([storyId, targetBranchId, record.worldId, record.entryId, record.operationId]))]));
      check();
      return selected.map(record => ({
        path: `${targetRoot}/${digest(entryKey(record.worldId, record.entryId))}/${digest(record.operationId)}.json`,
        text: JSON.stringify({ ...record, branchId: targetBranchId, id: ids.get(record.id),
          baseVersionId: record.baseVersionId === null ? null : ids.get(record.baseVersionId) }, null, 2),
      }));
    },
    list: () => inStory(async session => (await snapshot(session)).views),
    async effective(worldId, entryId) {
      if (!validTextId(worldId)) throw new Error('世界书 ID 无效');
      const normalized = normalizeEntryId(entryId);
      return inStory(async session => (await snapshot(session)).views
        .find(item => item.worldId === worldId && item.entryId === normalized && item.status === 'active') ?? null);
    },
    async propose(proposal) {
      const input: Proposal = { ...structuredClone(proposal), entryId: normalizeEntryId(proposal.entryId) };
      if (!validTextId(input.operationId) || !validTextId(input.worldId) || typeof input.content !== 'string'
        || typeof input.reason !== 'string' || !validRefs(input.sourceRefs)) throw new Error('世界书版本修改格式或来源无效');
      return inStory(async session => {
        const state = await snapshot(session);
        const prior = state.records.find(file => file.record.operationId === input.operationId);
        if (prior) {
          if (prior.record.proposalDigest !== proposalDigest(input)) throw new Error('同一世界书版本操作不能使用不同的内容或来源');
          return state.views.find(item => item.id === prior.record.id)!;
        }
        checkSources(input.sourceRefs, session);
        const key = entryKey(input.worldId, input.entryId);
        const baseEntryDigest = state.originals.has(key) ? state.originals.get(key)! : await readOriginal(input.worldId, input.entryId);
        if (baseEntryDigest === null) throw new Error('世界书原条目不存在');
        const version = state.records.reduce((highest, file) => entryKey(file.record.worldId, file.record.entryId) === key
          ? Math.max(highest, file.record.version) : highest, 1) + 1;
        if (!Number.isSafeInteger(version)) throw new Error('世界书版本编号超出范围');
        const ids = new Set(input.sourceRefs.map(ref => ref.messageId));
        const now = Date.now();
        const record: StoredVersion = { ...input, schema: 1, id: idOf(input), storyId, branchId, version,
          validFrom: session.messages.filter(message => ids.has(message.id)).at(-1)!.id,
          accepted: false, rejected: false, baseEntryDigest, baseVersionId: state.active.get(key)?.id ?? null,
          proposalDigest: proposalDigest(input), createdAt: now, updatedAt: now };
        await write(record, null, session);
        return (await snapshot(session)).views.find(item => item.id === record.id)!;
      });
    },
    accept: id => decide(id, true),
    reject: id => decide(id, false),
  };
}
