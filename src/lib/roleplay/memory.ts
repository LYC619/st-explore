import { getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo, type Repo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/vault/frontmatter';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { digest, refsAreCurrent, sourceRefs, stableJson, type SourceRef } from './fingerprint';
import { branchKey, isRuntimePath } from './paths';
import type { RuntimeStore } from './runtime-store';

export interface MemoryChange { path: string; body: string; expectedDigest: string | null }
export interface MemoryProposal {
  operationId: string;
  sourceRefs: SourceRef[];
  manual?: boolean;
  changes: MemoryChange[];
}
export interface MemoryDocument {
  path: string;
  body: string;
  digest: string;
  revision: number;
  owner: 'agent' | 'manual';
  status: 'active' | 'invalidated' | 'conflict';
  sourceRefs: SourceRef[];
}
export interface MemorySnapshot { documents: MemoryDocument[]; conflicts: string[] }
/** Re-reading and making a new proposal is safe; never reuse its old transaction identity. */
export class StaleMemoryProposalError extends Error {
  override name = 'StaleMemoryProposalError';
}
interface Journal {
  schema: 1;
  operationId: string;
  proposalDigest: string;
  status: 'prepared' | 'committed' | 'rolled-back' | 'conflict' | 'resolved';
  sourceRefs: SourceRef[];
  manual: boolean;
  changes: { path: string; before: string | null; after: string }[];
}

function validRefs(value: unknown): value is SourceRef[] {
  return Array.isArray(value) && value.every(ref => ref && typeof ref === 'object'
    && typeof ref.messageId === 'string' && typeof ref.candidateId === 'string'
    && typeof ref.contentDigest === 'string' && /^[a-f0-9]{64}$/.test(ref.contentDigest)
    && typeof ref.historyDigest === 'string' && /^[a-f0-9]{64}$/.test(ref.historyDigest));
}

/** Markdown is authoritative. The journal only makes interrupted multi-file changes recoverable. */
export function createMemoryRepository(options: {
  storyId: string;
  branchId: string | null;
  store: RuntimeStore;
  repo?: Repo<ArchiveStory>;
  isCurrent?: () => boolean;
}) {
  const { storyId, branchId } = options;
  const store = options.store.underStoryLock ?? options.store;
  if (store.storyId !== storyId) throw new Error('记忆与故事不匹配');
  const repo = options.repo ?? getCurrentRepo<ArchiveStory>('archiveStories');
  const epoch = getVaultEpoch();
  const root = `memory/${branchKey(branchId)}`;
  const journalRoot = `.ste-control/roleplay/${branchKey(branchId)}/memory-journal`;
  const journalPath = (operationId: string) => `${journalRoot}/${digest(operationId)}.json`;
  function check() {
    if (getVaultEpoch() !== epoch || options.isCurrent?.() === false) throw new Error('文件库或会话已切换，记忆操作已停止');
  }
  function validPath(path: unknown): path is string {
    return typeof path === 'string' && path !== 'index.md' && path.endsWith('.md') && isRuntimePath(`${root}/${path}`);
  }
  async function inStory<T>(action: (session: ChatSession) => Promise<T>): Promise<T> {
    check();
    let result: T;
    const story = await updateArchiveStory(storyId, async current => {
      check();
      const line = getBranchLine(current, branchId);
      if (!line) throw new Error('记忆所属分支不存在');
      result = await action(line.session);
      return undefined;
    }, repo);
    if (!story) throw new Error('记忆所属故事不存在');
    return result!;
  }
  async function saveJournal(journal: Journal) {
    check();
    await store.write(journalPath(journal.operationId), JSON.stringify(journal, null, 2));
  }
  function parseJournal(text: string, path: string): Journal {
    let value: Journal;
    try { value = JSON.parse(text); } catch { throw new Error(`记忆恢复日志损坏：${path}`); }
    if (value?.schema !== 1 || typeof value.operationId !== 'string' || journalPath(value.operationId) !== path
      || typeof value.proposalDigest !== 'string' || !validRefs(value.sourceRefs) || typeof value.manual !== 'boolean'
      || !['prepared', 'committed', 'rolled-back', 'conflict', 'resolved'].includes(value.status)
      || !Array.isArray(value.changes) || !value.changes.length
      || value.changes.some(change => !validPath(change.path) || typeof change.after !== 'string'
        || (change.before !== null && typeof change.before !== 'string'))
      || new Set(value.changes.map(change => change.path)).size !== value.changes.length) {
      throw new Error(`记忆恢复日志格式无效：${path}`);
    }
    return value;
  }
  async function journals(): Promise<Journal[]> {
    const result: Journal[] = [];
    for (const path of await store.list(journalRoot)) {
      if (!path.endsWith('.json')) continue;
      const text = await store.read(path);
      if (text !== null) result.push(parseJournal(text, path));
    }
    return result;
  }
  async function recover(session: ChatSession): Promise<Journal[]> {
    const entries = await journals();
    for (const journal of entries) {
      if (journal.status !== 'prepared') continue;
      const actual = await Promise.all(journal.changes.map(change => store.read(`${root}/${change.path}`)));
      if (journal.changes.some((change, index) => actual[index] !== change.before && actual[index] !== change.after)) {
        journal.status = 'conflict';
        await saveJournal(journal);
        continue;
      }
      const current = journal.manual || (journal.sourceRefs.length > 0 && refsAreCurrent(journal.sourceRefs, session));
      for (const change of journal.changes) {
        const path = `${root}/${change.path}`;
        const latest = await store.read(path);
        if (latest !== change.before && latest !== change.after) {
          journal.status = 'conflict';
          break;
        }
        const target = current ? change.after : change.before;
        if (latest !== target) {
          check();
          if (target === null) await store.remove(path);
          else await store.write(path, target);
        }
      }
      if (journal.status !== 'conflict') journal.status = current ? 'committed' : 'rolled-back';
      await saveJournal(journal);
    }
    return entries;
  }
  function document(path: string, text: string, session: ChatSession, conflicts: Set<string>, entries: Journal[]): MemoryDocument {
    const { fields, body } = parseFrontmatter(text);
    const owned = fields.owner === 'agent';
    const recorded = entries.find(entry => entry.operationId === fields.operationId)?.changes.find(change => change.path === path)?.after;
    const externallyEdited = owned && recorded !== undefined && recorded !== text;
    const refs = validRefs(fields.sourceRefs) ? fields.sourceRefs : [];
    const invalid = owned && (!refs.length || !refsAreCurrent(refs, session) || fields.status !== 'active');
    return {
      path, body, digest: digest(text),
      revision: Number.isSafeInteger(fields.revision) && Number(fields.revision) > 0 ? Number(fields.revision) : 0,
      owner: owned && !externallyEdited ? 'agent' : 'manual', sourceRefs: refs,
      status: conflicts.has(path) ? 'conflict' : invalid ? 'invalidated' : 'active',
    };
  }
  async function snapshot(session: ChatSession, entries: Journal[]): Promise<MemorySnapshot> {
    const unresolved = entries.filter(entry => entry.status === 'conflict' || entry.status === 'prepared');
    const paths = new Set(unresolved.flatMap(entry => entry.changes.map(change => change.path)));
    const documents: MemoryDocument[] = [];
    for (const full of await store.list(root)) {
      const relative = full.slice(root.length + 1);
      if (!validPath(relative)) continue;
      const text = await store.read(full);
      if (text !== null) documents.push(document(relative, text, session, paths, entries));
    }
    const index = serializeFrontmatter({ generated: true, description: '自动目录；正文请编辑各 Markdown 文件。' },
      documents.map(item => `- [${item.path}](${item.path}) · ${item.status} · v${item.revision} · ${item.owner}`).join('\n'));
    if (await store.read(`${root}/index.md`) !== index) { check(); await store.write(`${root}/index.md`, index); }
    return { documents, conflicts: unresolved.map(entry => entry.operationId) };
  }
  return {
    /** Read only, under the caller's story lock. Never recover or rewrite the parent during a fork. */
    async inheritanceFiles(targetBranchId: string, session: ChatSession, forkRefs: SourceRef[]): Promise<{ path: string; text: string }[]> {
      const targetRoot = `memory/${branchKey(targetBranchId)}`;
      const targetJournals = `.ste-control/roleplay/${branchKey(targetBranchId)}/memory-journal`;
      if (targetBranchId === branchId || !isRuntimePath(targetRoot, true)) throw new Error('记忆继承的目标分支无效');
      check();
      const entries = await journals();
      check();
      const allowed = new Set(forkRefs.map(ref => stableJson(ref)));
      const currentRefs = new Set(sourceRefs(session).map(ref => stableJson(ref)));
      const eligible = (text: string) => {
        const { fields } = parseFrontmatter(text);
        return fields.owner !== 'agent' || fields.status === 'active' && typeof fields.operationId === 'string'
          && validRefs(fields.sourceRefs) && fields.sourceRefs.length > 0
          && fields.sourceRefs.every(ref => allowed.has(stableJson(ref)) && currentRefs.has(stableJson(ref)));
      };
      const committed = entries.filter(entry => entry.status === 'committed');
      const unresolved = entries.filter(entry => entry.status === 'prepared' || entry.status === 'conflict');
      const current = new Map<string, string>();
      for (const full of await store.list(root)) {
        check();
        const path = full.slice(root.length + 1);
        if (!full.startsWith(root + '/') || !validPath(path)) continue;
        const text = await store.read(full);
        check();
        if (text !== null) current.set(path, text);
      }
      const selected = new Map<string, string>();
      for (const [path, text] of current) {
        const fields = parseFrontmatter(text).fields;
        const pending = unresolved.filter(entry => entry.changes.some(change => change.path === path));
        const partial = pending.some(entry => entry.changes.some(change => change.path === path && change.after === text));
        if (eligible(text) && !partial && (fields.owner !== 'agent' || !pending.length)) {
          selected.set(path, text);
          continue;
        }
        const past = committed.flatMap(entry => entry.changes.filter(change => change.path === path && eligible(change.after)))
          .sort((a, b) => Number(parseFrontmatter(b.after).fields.revision ?? 0) - Number(parseFrontmatter(a.after).fields.revision ?? 0));
        if (past[0]) selected.set(path, past[0].after);
      }
      const files = [...selected].map(([path, text]) => ({ path: `${targetRoot}/${path}`, text }));
      // Keep safe historical after-images so a later fork can go further back. Before-images and
      // uncommitted operations are deliberately absent; these receipts never replay parent work.
      const receipts = new Map<string, Journal>();
      for (const entry of committed) {
        const changes = entry.changes.filter(change => current.has(change.path) && eligible(change.after))
          .map(change => ({ path: change.path, before: null, after: change.after }));
        if (!changes.length) continue;
        const refs = changes.flatMap(change => {
          const fields = parseFrontmatter(change.after).fields;
          return fields.owner === 'agent' && validRefs(fields.sourceRefs) ? fields.sourceRefs : [];
        });
        receipts.set(entry.operationId, { ...entry, sourceRefs: [...new Map(refs.map(ref => [stableJson(ref), ref])).values()], changes });
      }
      for (const [path, text] of selected) {
        const fields = parseFrontmatter(text).fields;
        if (fields.owner !== 'agent' || typeof fields.operationId !== 'string' || !validRefs(fields.sourceRefs)) continue;
        if (!receipts.has(fields.operationId)) receipts.set(fields.operationId, { schema: 1,
          operationId: fields.operationId, proposalDigest: digest(stableJson({ inherited: true, operationId: fields.operationId })),
          status: 'committed', sourceRefs: fields.sourceRefs, manual: false, changes: [] });
        const receipt = receipts.get(fields.operationId)!;
        if (!receipt.changes.some(change => change.path === path)) receipt.changes.push({ path, before: null, after: text });
      }
      for (const entry of receipts.values()) files.push({ path: `${targetJournals}/${digest(entry.operationId)}.json`, text: JSON.stringify(entry, null, 2) });
      check();
      return files.sort((a, b) => a.path.localeCompare(b.path));
    },
    list: () => inStory(async session => snapshot(session, await recover(session))),
    read: (path: string) => inStory(async session => {
      if (!validPath(path)) throw new Error('记忆文件路径无效');
      const result = await snapshot(session, await recover(session));
      return result.documents.find(item => item.path === path) ?? null;
    }),
    commit(proposal: MemoryProposal): Promise<MemorySnapshot> {
      const input = structuredClone(proposal);
      return inStory(async session => {
        if (!input.operationId || typeof input.operationId !== 'string' || input.operationId.length > 512
          || !validRefs(input.sourceRefs) || (!input.manual && !input.sourceRefs.length)
          || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 24
          || input.changes.some(change => !validPath(change.path) || typeof change.body !== 'string' || change.body.length > 64000
            || (change.expectedDigest !== null && (typeof change.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(change.expectedDigest))))
          || new Set(input.changes.map(change => change.path)).size !== input.changes.length) {
          throw new Error('记忆修改格式或来源无效');
        }
        const entries = await recover(session);
        const proposalDigest = digest(stableJson(input));
        const prior = entries.find(entry => entry.operationId === input.operationId);
        if (prior) {
          if (prior.proposalDigest !== proposalDigest) throw new Error('同一记忆操作不能使用不同的修改内容');
          if (prior.status === 'committed') return snapshot(session, entries);
          if (prior.status === 'resolved' || prior.status === 'rolled-back') throw new StaleMemoryProposalError('旧记忆操作已结束，请重新读取当前文件后提交');
          throw new Error('记忆操作已失效或存在冲突，请检查文件后重新提交');
        }
        if (!input.manual && !refsAreCurrent(input.sourceRefs, session)) throw new Error('记忆来源已修改，迟到的更新已停止');
        const overlapping = entries.filter(entry => entry.status === 'conflict'
          && entry.changes.some(change => input.changes.some(item => item.path === change.path)));
        if (overlapping.length && (!input.manual || overlapping.some(entry => entry.changes.some(change => !input.changes.some(item => item.path === change.path))))) {
          throw new Error('记忆存在未处理冲突，请将该次操作涉及的文件一起手动确认');
        }
        const changes: Journal['changes'] = [];
        for (const change of input.changes) {
          const before = await store.read(`${root}/${change.path}`);
          if ((before === null ? null : digest(before)) !== change.expectedDigest) throw new StaleMemoryProposalError(`记忆已被修改：${change.path}；请重新读取后再保存`);
          const previous = before === null ? null : document(change.path, before, session, new Set(), entries);
          if (!input.manual && previous?.owner === 'manual') throw new StaleMemoryProposalError(`手动记忆需要由用户修改：${change.path}`);
          const after = serializeFrontmatter({ schema: 1, id: change.path, kind: change.path.split(/[/.]/)[0],
            revision: (previous?.revision ?? 0) + 1, owner: input.manual ? 'manual' : 'agent', status: 'active',
            sourceRefs: input.manual ? [] : input.sourceRefs, validFrom: input.sourceRefs.at(-1)?.messageId,
            operationId: input.operationId }, change.body);
          changes.push({ path: change.path, before, after });
        }
        const journal: Journal = { schema: 1, operationId: input.operationId, proposalDigest, status: 'prepared',
          sourceRefs: input.sourceRefs, manual: !!input.manual, changes };
        await saveJournal(journal);
        for (const change of changes) {
          if (await store.read(`${root}/${change.path}`) !== change.before) {
            journal.status = 'conflict'; await saveJournal(journal);
            throw new Error(`记忆已被修改：${change.path}；已保留当前文件`);
          }
          check();
          await store.write(`${root}/${change.path}`, change.after);
        }
        journal.status = 'committed';
        await saveJournal(journal);
        for (const entry of overlapping) { entry.status = 'resolved'; await saveJournal(entry); }
        return snapshot(session, [...entries, journal]);
      });
    },
  };
}

export type MemoryRepository = ReturnType<typeof createMemoryRepository>;
