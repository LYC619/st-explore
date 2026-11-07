import { factActive, intelligence } from './state';
import { visibleFacts } from '../memory/console';
import type { WorldEvent, WorldState } from '../world/schema';
import { availableActions } from '../world/simulation';

export function actorObservation(world: WorldState, actorId: string) {
  const actor = world.actors.find(a => a.id === actorId); if (!actor) throw new Error('人物不存在');
  const data = intelligence(world), here = world.regions[actor.region];
  const facts = visibleFacts(world, { kind: 'actor', actorId }, true).sort((a, b) => b.tick - a.tick).slice(0, 12);
  return { tick: world.tick, contextRevision: data.contextRevision, persona: data.personas[actorId],
    self: { id: actor.id, name: actor.name, energy: actor.energy, xp: actor.xp, bag: actor.bag, goal: world.regions[actor.goal].name },
    location: { id: here.id, name: here.name, stock: here.stock },
    weather: world.weather.rainUntil >= world.tick && world.weather.rainUntil > 0 ? '暴雨，渡口关闭' : '晴',
    nearby: world.actors.filter(a => a.id !== actorId && a.region === actor.region && a.job?.type !== 'move').map(a => ({ id: a.id, name: a.name, role: a.role, relationship: actor.relations[a.id] ?? 0 })),
    memories: facts.map(f => ({ id: f.id, text: f.text, source: f.origin })),
    legalActions: availableActions(world, actorId).map(a => ({ id: a.id, label: a.label, effect: a.cost })),
  };
}
/** Public narration never receives private personas, facts, reasoning, or traces. */
export function publicNarrationContext(world: WorldState, events: WorldEvent[]) {
  return { tick: world.tick, events: events.filter(e => e.kind !== 'plan').slice(-8).map(e => ({ id: e.id, title: e.title, result: e.detail, location: world.regions[e.region].name })),
    facts: intelligence(world).facts.filter(f => f.visibility === 'public' && factActive(f, world.tick)).slice(-8).map(f => ({ id: f.id, text: f.text })) };
}
