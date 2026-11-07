import { sha256 } from 'js-sha256';
import type { WorldEvent, WorldState } from '../world/schema';
import { factActive, intelligence, withIntelligence } from '../agents/state';
import type { Perspective, WorldFact } from '../agents/types';

export function factVisible(fact: WorldFact, view: Perspective): boolean {
  return view.kind === 'director' || fact.visibility === 'public'
    || view.kind === 'actor' && (fact.owner === view.actorId || fact.knownBy.includes(view.actorId));
}
export function visibleFacts(world: WorldState, view: Perspective, onlyActive = false): WorldFact[] {
  return intelligence(world).facts.filter(f => factVisible(f, view) && (!onlyActive || factActive(f, world.tick)));
}
export function eventVisible(event: WorldEvent, view: Perspective): boolean {
  return view.kind === 'director' || view.kind === 'observer' && event.kind !== 'plan'
    || view.kind === 'actor' && (event.actors.includes(view.actorId) || event.witnesses?.includes(view.actorId) === true);
}
function boundFacts(facts: WorldFact[]): WorldFact[] {
  const authored = facts.filter(f => f.origin !== 'witness'), derived = facts.filter(f => f.origin === 'witness');
  return [...authored, ...derived.slice(-Math.max(0, 500 - authored.length))];
}
export function captureKnowledge(world: WorldState, events: WorldEvent[]): WorldState {
  const copy = withIntelligence(world), data = copy.intelligence!;
  for (const event of events.filter(e => e.kind !== 'plan')) {
    const publicEvent = ['weather', 'supply', 'gathering'].includes(event.kind);
    const knownBy = event.witnesses ?? event.actors;
    if (!publicEvent && !knownBy.length) continue;
    const id = `event:${event.id}`;
    if (data.facts.some(f => f.id === id)) continue;
    data.facts.push({ id, type: 'event', subject: event.actors.map(id => world.actors.find(a => a.id === id)?.name).filter(Boolean).join('、').slice(0, 100),
      text: `${event.title}：${event.detail}`.slice(0, 240), visibility: publicEvent ? 'public' : 'private', owner: publicEvent ? undefined : knownBy[0], knownBy,
      origin: 'witness', status: 'enabled', tick: event.tick, eventId: event.id, revision: 0 });
  }
  // Keep authored facts; only the oldest derived observations roll off the active context.
  data.facts = boundFacts(data.facts);
  if (events.some(e => e.kind !== 'plan')) data.contextRevision++;
  return copy;
}
export interface FactInput { type: WorldFact['type']; subject: string; text: string; visibility: WorldFact['visibility']; owner?: string; eventId?: string; source?: WorldFact['source']; expiresAt?: number }
export function saveFact(world: WorldState, input: FactInput, existingId?: string): WorldState {
  const copy = withIntelligence(world), data = copy.intelligence!;
  const content = input.text.trim(), subject = input.subject.trim();
  if (!content || content.length > 240 || subject.length > 100) throw new Error('请用 1～240 字记录一句短事实');
  if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt < 0)) throw new Error('有效期必须是非负的世界步数');
  if (input.visibility === 'private' && !world.actors.some(a => a.id === input.owner)) throw new Error('请选择这条记忆的知情人');
  const existing = data.facts.find(f => f.id === existingId);
  if (existingId && !existing) throw new Error('记忆已变化，请重新打开');
  if (existing?.origin === 'witness') throw new Error('已结算事件不可改写，可另存你的理解');
  if (!existing && data.facts.filter(f => f.origin !== 'witness').length >= 160) throw new Error('人工与候选记忆已达 160 条，请整理后再保存');
  const fact: WorldFact = { id: existing?.id ?? crypto.randomUUID(), type: input.type, subject, text: content, visibility: input.visibility,
    ...(input.visibility === 'private' ? { owner: input.owner, knownBy: [input.owner!] } : { knownBy: [] }),
    status: existing?.status ?? 'enabled', origin: existing?.origin ?? (input.source ? 'import' : 'manual'), tick: existing?.tick ?? world.tick,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    revision: (existing?.revision ?? -1) + 1, ...(input.eventId ? { eventId: input.eventId } : {}), ...(input.source ? { source: input.source } : {}) };
  data.facts = existing ? data.facts.map(f => f.id === fact.id ? fact : f) : [...data.facts, fact];
  data.facts = boundFacts(data.facts); data.contextRevision++; return copy;
}
export function setFactStatus(world: WorldState, id: string, status: WorldFact['status'] | 'restore'): WorldState {
  const copy = withIntelligence(world), data = copy.intelligence!, fact = data.facts.find(f => f.id === id);
  if (!fact || fact.origin === 'witness') throw new Error('事件事实只读');
  if (status === 'restore') fact.status = fact.previousStatus ?? 'disabled';
  else { if (status === 'deleted') fact.previousStatus = fact.status === 'deleted' ? fact.previousStatus : fact.status; fact.status = status; }
  fact.revision++; data.contextRevision++; return copy;
}
export function addFactProposals(world: WorldState, actorId: string, texts: string[], tick: number): WorldState {
  const copy = withIntelligence(world), data = copy.intelligence!;
  for (const text of texts.slice(0, 3)) {
    const content = text.trim().slice(0, 240); if (!content) continue;
    const id = 'proposal:' + sha256(actorId + ':' + content).slice(0, 28);
    if (data.facts.some(f => f.id === id) || data.facts.filter(f => f.origin !== 'witness').length >= 160) continue;
    data.facts.push({ id, type: 'event', subject: world.actors.find(a => a.id === actorId)!.name, text: content,
      visibility: 'private', owner: actorId, knownBy: [actorId], status: 'pending', origin: 'model', tick, revision: 0 });
  }
  data.facts = boundFacts(data.facts);
  return copy;
}
