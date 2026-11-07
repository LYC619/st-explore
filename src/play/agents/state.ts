import type { WorldState } from '../world/schema';
import type { WorldIntelligence, WorldFact } from './types';

export const DEFAULT_AI_SETTINGS = { mode: 'rules' as const, profileId: '', model: '', narration: true,
  reflectionEvery: 6, maxCalls: 30, maxTokens: 64000, requestTimeoutMs: 30000, outputTokens: 2048 };
const temperaments = ['谨慎、信守承诺，优先准备物资', '重情义，遇人困顿会伸手相助', '善于交涉，重视对等交换', '好奇心强，喜欢探索和结交新朋友', '勤勉自律，珍惜每次修行机会', '独立好胜，不轻易依赖别人'];
export function intelligence(world: WorldState): WorldIntelligence {
  return world.intelligence ?? { version: 1, contextRevision: 0, settings: { ...DEFAULT_AI_SETTINGS },
    personas: Object.fromEntries(world.actors.map((a, i) => [a.id, {
      identity: `${a.name}是一位${a.role}，生活在山海之间。`, temperament: temperaments[i % temperaments.length],
      privateNotes: '', ambition: `希望在${world.regions[a.home].name}站稳脚跟，备足药粮并精进修为。`,
    }])), facts: [], receipts: [], narratives: [], cursor: 0 };
}
export function withIntelligence(world: WorldState): WorldState {
  const copy = structuredClone(world); copy.intelligence = structuredClone(intelligence(world)); return copy;
}
export function validateIntelligence(world: WorldState): void {
  const data = world.intelligence; if (!data) return;
  const ids = new Set(world.actors.map(a => a.id)), finite = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const settings = data.settings;
  if (data.version !== 1 || !finite(data.contextRevision) || !finite(data.cursor) || !settings
    || !['rules', 'ai'].includes(settings.mode) || !text(settings.profileId, 200) || !text(settings.model, 200)
    || typeof settings.narration !== 'boolean' || !finite(settings.reflectionEvery) || settings.reflectionEvery > 100
    || !finite(settings.maxCalls) || settings.maxCalls < 1 || settings.maxCalls > 100 || !finite(settings.maxTokens) || settings.maxTokens < 1000 || settings.maxTokens > 200000
    || !finite(settings.requestTimeoutMs) || settings.requestTimeoutMs < 1000 || settings.requestTimeoutMs > 120000
    || settings.outputTokens !== undefined && (!finite(settings.outputTokens) || settings.outputTokens < 256 || settings.outputTokens > 4096)
    || !Array.isArray(data.facts) || data.facts.length > 500 || !Array.isArray(data.receipts) || data.receipts.length > 100
    || !Array.isArray(data.narratives) || data.narratives.length > 40 || !data.personas) throw new Error('世界智能设置损坏或超出容量');
  for (const [id, p] of Object.entries(data.personas)) if (!ids.has(id) || !p || !text(p.identity, 4000) || !text(p.temperament, 1200)
    || !text(p.privateNotes, 4000) || !text(p.ambition, 1200)) throw new Error('角色人设无效');
  const factIds = new Set<string>();
  for (const fact of data.facts) {
    if (!fact || !text(fact.id, 100) || factIds.has(fact.id) || !text(fact.text, 240) || !text(fact.subject, 100)
      || !['promise', 'status', 'event', 'secret'].includes(fact.type) || !['public', 'private'].includes(fact.visibility)
      || fact.visibility === 'private' && (!fact.owner || !ids.has(fact.owner))
      || !Array.isArray(fact.knownBy) || !fact.knownBy.every(id => ids.has(id)) || !finite(fact.tick) || !finite(fact.revision)
      || !['enabled', 'disabled', 'pending', 'deleted'].includes(fact.status) || !['manual', 'witness', 'model', 'import'].includes(fact.origin)
      || fact.expiresAt !== undefined && !finite(fact.expiresAt)) throw new Error('记忆条目无效');
    factIds.add(fact.id);
  }
  for (const row of data.receipts) if (!row || !text(row.id, 100) || !text(row.runId, 100) || !text(row.model, 200)
    || !['plan', 'narrative', 'reflection', 'scene'].includes(row.purpose) || row.actorId !== undefined && !ids.has(row.actorId)
    || !['reserved', 'completed', 'failed', 'cancelled'].includes(row.status) || !finite(row.charged) || !finite(row.reserved)
    || !Array.isArray(row.factIds) || row.factIds.length > 500 || !row.factIds.every(id => text(id, 100)) || !finite(row.contextRevision)) throw new Error('模型预算记录无效');
  if (data.budget && (!text(data.budget.id, 100) || !finite(data.budget.startedAt) || !finite(data.budget.calls) || !finite(data.budget.charged)
    || !finite(data.budget.maxCalls) || !finite(data.budget.maxTokens))) throw new Error('预算状态无效');
  for (const n of data.narratives) if (!finite(n.tick) || !text(n.text, 1600) || !Array.isArray(n.eventIds) || n.eventIds.length > 100) throw new Error('事件旁白无效');
}
export function factActive(fact: WorldFact, tick: number): boolean {
  return fact.status === 'enabled' && (fact.expiresAt === undefined || fact.expiresAt >= tick);
}
