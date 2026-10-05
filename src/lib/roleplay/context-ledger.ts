import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { getVaultEpoch } from '@/lib/vault/active';
import type { ChatSession } from '@/types/chat';
import { digest, stableJson, refsAreCurrent, sourceRefs, type SourceRef } from './fingerprint';
import { branchKey } from './paths';
import type { PreparedCompletion } from './provider';
import { postProcessPrompt } from './prompt-post-processing';
import type { RuntimeStore } from './runtime-store';

export interface CacheMetrics {
  sharedPrefixMessages: number;
  estimatedPrefixTokens: number;
  reason: string;
}
export interface ContextTurn {
  schema: 1;
  turnId: string;
  cycleId: string;
  status: 'prepared' | 'succeeded' | 'failed' | 'cancelled' | 'adopted';
  envelopeDigest: string;
  requestDigest: string;
  anchorCount: number;
  anchorDigest: string;
  supplement: { role: 'system'; content: string };
  sourceRefs: SourceRef[];
  adoptedRef?: SourceRef;
  metrics: CacheMetrics;
}
interface LedgerState { schema: 1; turnIds: string[]; lastMessageDigests: string[]; lastTurnId?: string }
const operations = new KeyedSerialQueue();

/** Stores only frozen turn additions and fingerprints, never another copy of the whole chat. */
export function createContextLedger({ store, branchId }: { store: RuntimeStore; branchId: string | null }) {
  const root = `.ste-control/roleplay/${branchKey(branchId)}`;
  const key = stableJson([getVaultEpoch(), store.storyId, branchId]);
  const path = (turnId: string) => `${root}/turns/${digest(turnId)}.json`;
  async function readState(): Promise<LedgerState> {
    const text = await store.read(`${root}/context.json`);
    if (text === null) return { schema: 1, turnIds: [], lastMessageDigests: [] };
    const state = JSON.parse(text) as LedgerState;
    if (state.schema !== 1 || !Array.isArray(state.turnIds) || state.turnIds.some(id => typeof id !== 'string')
      || !Array.isArray(state.lastMessageDigests) || state.lastMessageDigests.some(hash => typeof hash !== 'string')) throw new Error('上下文记录损坏，请在记忆面板重建上下文周期');
    return state;
  }
  async function readTurn(turnId: string): Promise<ContextTurn> {
    const text = await store.read(path(turnId));
    if (text === null) throw new Error('生成记录不存在');
    const turn = JSON.parse(text) as ContextTurn;
    if (turn.schema !== 1 || turn.turnId !== turnId || !Array.isArray(turn.sourceRefs)
      || !Number.isSafeInteger(turn.anchorCount) || turn.anchorCount < 1 || turn.supplement?.role !== 'system'
      || typeof turn.supplement.content !== 'string') throw new Error('生成记录格式无效');
    return turn;
  }
  const saveTurn = (turn: ContextTurn) => store.write(path(turn.turnId), JSON.stringify(turn, null, 2));
  return {
    read: readTurn,
    list: () => operations.enqueue(key, async () => Promise.all((await readState()).turnIds.map(readTurn))),
    reserve: () => operations.enqueue(key, async () => {
      const turns = await Promise.all((await readState()).turnIds.map(readTurn));
      return 2600 + turns.filter(turn => turn.status === 'adopted').reduce((total, turn) => total
        + encode(turn.supplement.content, { disallowedSpecial: new Set() }).length + 8, 0);
    }),
    prepare(prepared: PreparedCompletion, supplement: string, session: ChatSession, turnId: string) {
      return operations.enqueue(key, async () => {
        const state = await readState();
        const processing = prepared.promptProcessing;
        const base = structuredClone(processing?.sourceMessages ?? prepared.body.messages) as Record<string, unknown>[];
        if (!Array.isArray(base) || !base.length || base.some(message => !message || typeof message !== 'object')) throw new Error('Agent 请求缺少有效消息');
        const envelope = { ...prepared.body }; delete envelope.messages;
        const envelopeDigest = digest(stableJson({ url: prepared.url, headers: prepared.headers, body: envelope,
          ...(processing ? { processing: { mode: processing.mode, names: processing.names } } : {}) }));
        let chain = digest('STE provider messages v1');
        const prefixes = base.map(message => chain = digest(chain + stableJson(message)));
        // ST may place post-history instructions at the end. Keep that moving tail after this turn.
        let anchorCount = base.length;
        while (anchorCount > 1 && ['system', 'developer'].includes(String(base[anchorCount - 1].role))) anchorCount--;
        const known = await Promise.all(state.turnIds.map(readTurn));
        const adopted = known.filter(turn => turn.status === 'adopted');
        const latest = adopted.at(-1);
        const reusable = !!latest && adopted.every(turn => turn.envelopeDigest === envelopeDigest
          && turn.anchorCount < anchorCount && prefixes[turn.anchorCount - 1] === turn.anchorDigest
          && !!turn.adoptedRef && refsAreCurrent([turn.adoptedRef], session));
        const retained = reusable ? adopted : [];
        const reason = !known.length ? '首次上下文' : reusable ? '沿用已冻结资料'
          : latest?.envelopeDigest !== envelopeDigest && latest ? '连接或请求配置变化'
          : '历史、候选或请求布局变化';
        const cycleId = reusable ? latest!.cycleId : crypto.randomUUID();
        const frozen = { role: 'system' as const, content: `本轮背景资料（生效回合 ${turnId}，历史资料只代表当时状态）：\n${supplement}` };
        const messages: Record<string, unknown>[] = [];
        base.forEach((message, index) => {
          messages.push(message);
          for (const turn of retained) if (turn.anchorCount === index + 1) messages.push(turn.supplement);
          if (index + 1 === anchorCount) messages.push(frozen);
        });
        const finalMessages = processing ? postProcessPrompt(messages, processing.mode, processing.names) : messages;
        const hashes = finalMessages.map(message => digest(stableJson(message)));
        let sharedPrefixMessages = 0;
        while (sharedPrefixMessages < Math.min(hashes.length, state.lastMessageDigests.length)
          && hashes[sharedPrefixMessages] === state.lastMessageDigests[sharedPrefixMessages]) sharedPrefixMessages++;
        const metrics: CacheMetrics = { sharedPrefixMessages,
          estimatedPrefixTokens: sharedPrefixMessages ? encode(stableJson(finalMessages.slice(0, sharedPrefixMessages)), { disallowedSpecial: new Set() }).length : 0,
          reason };
        const result: PreparedCompletion = { ...prepared, body: { ...prepared.body, messages: finalMessages } };
        const refs = sourceRefs(session);
        const record: ContextTurn = { schema: 1, turnId, cycleId, status: 'prepared', envelopeDigest,
          requestDigest: digest(stableJson(result.body)), anchorCount, anchorDigest: prefixes[anchorCount - 1],
          supplement: frozen, sourceRefs: refs.length ? [refs[refs.length - 1]] : [], metrics };
        if (await store.read(path(turnId)) !== null) throw new Error('生成 ID 已使用，不能覆盖旧回合');
        await saveTurn(record);
        await store.write(`${root}/context.json`, JSON.stringify({ schema: 1,
          turnIds: [...retained.map(turn => turn.turnId), turnId], lastMessageDigests: hashes, lastTurnId: turnId } satisfies LedgerState));
        return { prepared: result, record, metrics };
      });
    },
    finish(turnId: string, status: 'succeeded' | 'failed' | 'cancelled') {
      return operations.enqueue(key, async () => {
        const turn = await readTurn(turnId);
        if (turn.status === 'prepared' || status !== 'succeeded' && ['succeeded', 'adopted'].includes(turn.status)) {
          turn.status = status; delete turn.adoptedRef; await saveTurn(turn);
        }
      });
    },
    adopt(turnId: string, session: ChatSession, messageId: string) {
      return operations.enqueue(key, async () => {
        const turn = await readTurn(turnId);
        if (turn.status !== 'succeeded' && turn.status !== 'adopted') throw new Error('仅成功完成的回复可以采纳为记忆来源');
        if (!refsAreCurrent(turn.sourceRefs, session)) throw new Error('生成来源已变化，不能采纳旧回复');
        const index = session.messages.findIndex(message => message.id === messageId && message.role === 'assistant');
        if (index < 0) throw new Error('采纳的回复不存在');
        const adoptedRef = sourceRefs(session)[index];
        if (turn.adoptedRef && stableJson(turn.adoptedRef) !== stableJson(adoptedRef)) throw new Error('已采纳回复发生变化');
        turn.status = 'adopted'; turn.adoptedRef = adoptedRef;
        await saveTurn(turn);
        return turn;
      });
    },
    reset: () => operations.enqueue(key, () => store.remove(`${root}/context.json`)),
  };
}
