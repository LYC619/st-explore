import { getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import type { Repo } from '@/lib/repo';
import type { APIConfig } from '@/components/ai-tools/api-profiles';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { createMemoryRepository } from './memory';
import { createContextLedger, type CacheMetrics, type ContextTurn } from './context-ledger';
import type { CompletionOutcome } from './completion-monitor';
import { digest, refsAreCurrent, sourceRefs, type SourceRef } from './fingerprint';
import { branchKey } from './paths';
import type { PreparedCompletion } from './provider';
import type { RuntimeStore } from './runtime-store';
import type { StoryCommit } from './story-session';
import { runToolAgent, type AgentResource, type ToolAgentResult, type WorldbookProposal, type AgentReference } from './tool-agent';

export interface RuntimeConfiguration {
  mode: 'classic' | 'agent';
  memoryOwner: 'none' | 'native-agent' | 'baibai';
}
export interface WorldScopeEntry { world: string; uid: string | number; content?: string }
export interface AgentStatus {
  phase: 'idle' | 'retrieving' | 'generating' | 'saving' | 'memory' | 'memory-pending' | 'failed';
  message: string;
  turnId?: string;
  cache?: CacheMetrics;
  usage?: unknown;
  references?: AgentReference[];
}
interface PendingTurn {
  record: ContextTurn;
  scope: WorldScopeEntry[];
  outcome?: CompletionOutcome;
  adoptedRef?: SourceRef;
  scheduled?: boolean;
  controller?: AbortController;
  receiptWrite?: Promise<void>;
  receiptError?: unknown;
}
interface CompletionReceipt {
  status: CompletionOutcome['status'];
  contentDigest: string;
  canonicalDigest?: string;
  messageId?: string;
  candidateId?: string;
  finishReason?: string;
  usage?: unknown;
}
interface MaintenanceRecord {
  schema: 1;
  turnId: string;
  sourceRef: SourceRef;
  proposal: ToolAgentResult;
  status: 'prepared' | 'committed';
}

export function createAgentRuntime(options: {
  storyId: string;
  branchId: string | null;
  store: RuntimeStore;
  stories: Repo<ArchiveStory>;
  toolProfile: () => APIConfig;
  isCurrent: () => boolean;
  worldResources: (scope: WorldScopeEntry[], session: ChatSession, phase: 'context' | 'memory') => Promise<AgentResource[]>;
  proposeWorldVersions?: (turnId: string, proposals: WorldbookProposal[], scope: WorldScopeEntry[], refs: SourceRef[]) => Promise<void>;
  onStatus?: (status: AgentStatus) => void;
}) {
  const { storyId, branchId, store, stories } = options;
  const root = `.ste-control/roleplay/${branchKey(branchId)}`;
  const memory = createMemoryRepository({ storyId, branchId, store, repo: stories, isCurrent: options.isCurrent });
  const ledger = createContextLedger({ store, branchId });
  const pending = new Map<string, PendingTurn>();
  const controllers = new Set<AbortController>();
  let maintenance = Promise.resolve();
  let lastStatus: AgentStatus = { phase: 'idle', message: '自动保存' };
  let closed = false;
  let resumed = false;
  function check() { if (closed || !options.isCurrent()) throw new Error('故事或文件库已切换，Agent 工作已停止'); }
  function report(status: AgentStatus) { lastStatus = status; options.onStatus?.(structuredClone(status)); }
  async function configuration(): Promise<RuntimeConfiguration> {
    check();
    const text = await store.read(`${root}/settings.json`);
    const value = text ? JSON.parse(text) : { mode: 'classic', memoryOwner: 'none' };
    validateConfig(value);
    return value;
  }
  function validateConfig(value: RuntimeConfiguration) {
    if (!['classic', 'agent'].includes(value.mode) || !['none', 'native-agent', 'baibai'].includes(value.memoryOwner)
      || value.mode === 'agent' && value.memoryOwner !== 'native-agent' || value.mode === 'classic' && value.memoryOwner === 'native-agent') {
      throw new Error('每个分支只能由一个记忆维护者负责；Agent 使用内置记忆，无 Agent 可选柏宝书');
    }
  }
  async function sources(session: ChatSession, scope: WorldScopeEntry[], phase: 'context' | 'memory'): Promise<AgentResource[]> {
    const snapshot = await memory.list();
    const sourceIds = new Set(session.messages.map(message => message.id));
    const durableIds = phase === 'memory' ? new Set((await currentSession()).messages.map(message => message.id)) : sourceIds;
    // Deleted sources can be rewritten; sources still present after this turn's cutoff must stay excluded.
    const docs = snapshot.documents.filter(doc => (doc.status === 'active' || phase === 'memory' && doc.status === 'invalidated')
      && doc.sourceRefs.every(ref => sourceIds.has(ref.messageId)
        || phase === 'memory' && doc.status === 'invalidated' && !durableIds.has(ref.messageId)));
    return [
      ...docs.filter(doc => phase === 'memory' || refsAreCurrent(doc.sourceRefs, session)).map(doc => ({
        id: `memory:${doc.path}`, kind: 'memory' as const, label: `${doc.path}${doc.status === 'invalidated' ? '（旧来源已失效，须依据当前原文重写）' : ''}`,
        content: doc.body, digest: doc.digest, owner: doc.owner,
      })),
      ...await options.worldResources(scope, session, phase),
      ...session.messages.filter(message => !message.hidden).map((message, index) => ({
        id: `message:${message.id}`, kind: 'message' as const, label: `第 ${index + 1} 条 · ${message.name ?? message.role}`,
        content: message.content,
      })),
    ];
  }
  async function currentSession() {
    const story = await stories.get(storyId);
    const line = story && getBranchLine(story, branchId);
    if (!line) throw new Error('故事分支不存在');
    return line.session;
  }
  function schedule(turn: PendingTurn, session: ChatSession) {
    if (turn.scheduled || !turn.adoptedRef) return;
    turn.scheduled = true;
    const controller = new AbortController(); turn.controller = controller; controllers.add(controller);
    const sourceRef = turn.adoptedRef;
    const turnId = turn.record.turnId;
    maintenance = maintenance.then(async () => {
      check(); controller.signal.throwIfAborted();
      if (turn.outcome?.status !== 'succeeded') return;
      if (!refsAreCurrent([sourceRef], await currentSession())) return;
      const config = await configuration();
      if (config.memoryOwner !== 'native-agent') return;
      report({ ...lastStatus, phase: 'memory', message: '正文已保存，正在整理记忆…', turnId });
      const path = `${root}/maintenance/${digest(turnId)}.json`;
      const saved = await store.read(path);
      let record: MaintenanceRecord;
      if (saved) {
        record = JSON.parse(saved);
        if (record.schema !== 1 || record.turnId !== turnId || !refsAreCurrent([record.sourceRef], session)) throw new Error('记忆更新记录与当前采用回复不匹配');
        if (record.status === 'committed') { report({ ...lastStatus, phase: 'idle', message: '正文与记忆已保存' }); return; }
      } else {
        const proposal = await runToolAgent({ phase: 'memory', session, resources: await sources(session, turn.scope, 'memory'),
          profile: options.toolProfile(), signal: controller.signal });
        check(); controller.signal.throwIfAborted();
        if (!refsAreCurrent([sourceRef], await currentSession())) return;
        record = { schema: 1, turnId, sourceRef, proposal, status: 'prepared' };
        await store.write(path, JSON.stringify(record, null, 2));
      }
      controller.signal.throwIfAborted();
      if (record.proposal.changes.length) await memory.commit({ operationId: `memory:${turnId}`, sourceRefs: [sourceRef], changes: record.proposal.changes });
      if (record.proposal.worldbookVersions.length) await options.proposeWorldVersions?.(turnId, record.proposal.worldbookVersions, turn.scope, [sourceRef]);
      record.status = 'committed'; check();
      await store.write(path, JSON.stringify(record, null, 2));
      report({ ...lastStatus, phase: 'idle', message: '正文与记忆已保存', turnId });
    }).catch(error => {
      report({ ...lastStatus, phase: 'memory-pending', message: `正文已保存，记忆待补全：${error instanceof Error ? error.message : String(error)}`, turnId });
    }).finally(() => { controllers.delete(controller); });
  }
  async function afterCommit(commit: StoryCommit) {
    check();
    if (commit.storyId !== storyId || commit.branchId !== branchId) return;
    const durable = await currentSession();
    for (const turn of pending.values()) {
      if (turn.adoptedRef && !refsAreCurrent([turn.adoptedRef], durable)) turn.controller?.abort();
      if (turn.scheduled || turn.outcome?.status !== 'succeeded') continue;
      const message = commit.session.messages.find(item => item.role === 'assistant' && item.rawData?.extra?.ste_runtime?.turnId === turn.record.turnId);
      if (!message) continue;
      await turn.receiptWrite;
      if (turn.receiptError) throw turn.receiptError;
      const receipt = await readReceipt(turn.record.turnId);
      if (!matchesReceipt(receipt, message)) continue;
      const ref = sourceRefs(commit.session).find(item => item.messageId === message.id)!;
      // A UI event alone is insufficient: the same adopted candidate must already exist in the repository.
      if (!refsAreCurrent([ref], durable)) continue;
      try {
        const adopted = await ledger.adopt(turn.record.turnId, durable, message.id);
        turn.adoptedRef = adopted.adoptedRef;
        const index = durable.messages.findIndex(item => item.id === message.id);
        schedule(turn, structuredClone({ ...durable, messages: durable.messages.slice(0, index + 1) }));
      } catch (error) {
        report({ ...lastStatus, phase: 'memory-pending', message: `正文已保存，记忆来源需重新核对：${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
  async function readReceipt(turnId: string): Promise<CompletionReceipt | null> {
    const text = await store.read(`${root}/receipts/${digest(turnId)}.json`);
    return text ? JSON.parse(text) : null;
  }
  function matchesReceipt(receipt: CompletionReceipt | null, message: ChatSession['messages'][number]) {
    return receipt?.status === 'succeeded' && (receipt.canonicalDigest ?? receipt.contentDigest) === digest(message.content)
      && (!receipt.messageId || receipt.messageId === message.id)
      && (!receipt.candidateId || receipt.candidateId === message.rawData?.extra?.ste_runtime?.candidateId);
  }
  return {
    memory, ledger, configuration,
    status: () => structuredClone(lastStatus),
    fail: (error: unknown) => report({ ...lastStatus, phase: 'failed', message: error instanceof Error ? error.message : String(error) }),
    async configure(value: RuntimeConfiguration) {
      check(); validateConfig(value);
      if (value.mode === 'agent') options.toolProfile();
      await updateArchiveStory(storyId, async current => {
        check(); if (!getBranchLine(current, branchId)) throw new Error('分支不存在');
        await (store.underStoryLock ?? store).write(`${root}/settings.json`, JSON.stringify(value));
        return undefined;
      }, stories);
      if (value.memoryOwner !== 'native-agent') for (const controller of controllers) controller.abort();
      report({ phase: 'idle', message: value.mode === 'agent' ? 'Agent · 自动保存' : '无 Agent · 自动保存' });
    },
    async prepare(prepared: PreparedCompletion, session: ChatSession, scope: WorldScopeEntry[], signal?: AbortSignal) {
      await maintenance; check(); signal?.throwIfAborted();
      if ((await configuration()).mode !== 'agent') throw new Error('当前分支未开启 Agent');
      // Unadopted completions from a prior attempt must not become memory on a later unrelated save.
      for (const [id, turn] of pending) if (!turn.adoptedRef) pending.delete(id);
      const turnId = crypto.randomUUID();
      report({ phase: 'retrieving', message: '正在查找人物、地点与记忆…', turnId });
      const context = await runToolAgent({ phase: 'context', session, resources: await sources(session, scope, 'context'),
        profile: options.toolProfile(), signal,
        onTool: name => report({ phase: 'retrieving', message: name === 'read_source' ? '正在读取相关原文…' : '正在准备本轮资料…', turnId }),
      });
      check(); signal?.throwIfAborted();
      const frozen = await ledger.prepare(prepared, context.supplement, session, turnId);
      await store.write(`${root}/inputs/${digest(turnId)}.json`, JSON.stringify({ scope }));
      pending.set(turnId, { record: frozen.record, scope: structuredClone(scope) });
      report({ phase: 'generating', message: '资料就绪，正在生成正文…', turnId, cache: frozen.metrics, references: context.references });
      return { prepared: frozen.prepared, turnId };
    },
    async finish(turnId: string, outcome: CompletionOutcome) {
      const turn = pending.get(turnId);
      if (!turn) return;
      if (turn.outcome?.status === 'cancelled' || turn.outcome?.status === 'failed') return;
      turn.outcome = outcome;
      if (outcome.status !== 'succeeded') turn.controller?.abort();
      const write = (turn.receiptWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
        await ledger.finish(turnId, outcome.status);
        await store.write(`${root}/receipts/${digest(turnId)}.json`, JSON.stringify({ status: outcome.status,
          contentDigest: digest(outcome.content), finishReason: outcome.finishReason, usage: outcome.usage } satisfies CompletionReceipt));
        turn.receiptError = undefined;
      });
      turn.receiptWrite = write;
      await write;
      if (turn.outcome !== outcome) return;
      report({ ...lastStatus, usage: outcome.usage, phase: outcome.status === 'succeeded' ? 'saving' : 'idle',
        message: outcome.status === 'succeeded' ? '正文完成，等待保存…' : '本轮未完成，未写入事实记忆', turnId });
    },
    async confirmCandidate(turnId: string, value: { messageId: string; candidateId: string; content: string }) {
      check();
      const turn = pending.get(turnId);
      if (!turn || turn.outcome?.status !== 'succeeded') throw new Error('本轮没有可采纳的完整回复');
      const write = (turn.receiptWrite ?? Promise.resolve()).then(async () => {
        const receipt = await readReceipt(turnId);
        if (turn.outcome?.status !== 'succeeded' || receipt?.status !== 'succeeded') return '生成已停止，不能登记事实来源';
        if (receipt.canonicalDigest && (receipt.canonicalDigest !== digest(value.content) || receipt.messageId !== value.messageId || receipt.candidateId !== value.candidateId)) {
          return '本轮候选已登记，不能用后续编辑替换完成回执';
        }
        await store.write(`${root}/receipts/${digest(turnId)}.json`, JSON.stringify({ ...receipt,
          canonicalDigest: digest(value.content), messageId: value.messageId, candidateId: value.candidateId } satisfies CompletionReceipt));
        turn.receiptError = undefined;
      });
      turn.receiptWrite = write.then(() => {}, error => { turn.receiptError = error; });
      const rejected = await write;
      if (rejected) throw new Error(rejected);
    },
    afterCommit,
    async resume(retry = false) {
      check();
      if (resumed && !retry) return;
      resumed = true;
      if ((await configuration()).memoryOwner !== 'native-agent') return;
      const session = await currentSession();
      const latest = [...session.messages].reverse().find(message => message.role === 'assistant' && message.rawData?.extra?.ste_runtime?.turnId);
      if (!latest) return;
      const turnId = latest.rawData!.extra!.ste_runtime.turnId;
      if (pending.get(turnId)?.scheduled && !retry) return;
      const records = await ledger.list();
      const record = records.find(turn => turn.turnId === turnId && ['succeeded', 'adopted'].includes(turn.status));
      if (!record) return;
      if (!matchesReceipt(await readReceipt(turnId), latest)) return;
      const input = await store.read(`${root}/inputs/${digest(turnId)}.json`);
      pending.set(turnId, { record, scope: input ? JSON.parse(input).scope : [], outcome: { status: 'succeeded', content: latest.content } });
      await afterCommit({ storyId, branchId, previous: session, session });
    },
    flush: () => maintenance,
    close() { closed = true; for (const controller of controllers) controller.abort(); },
  };
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>;
