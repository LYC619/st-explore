import type { WorldState } from '../world/schema';
export interface Encounter { id: string; region: string; title: string; description: string; danger: number; reward: number; roll: number; kind: 'beast' | 'cache' | 'traveler' }
export interface AdventureState {
  control?: { actorId: string; leaseId: string; since: number };
  health: Record<string, number>; discovered: Record<string, string[]>; resolved: number;
  encounter?: Encounter;
}
export function takeControl(world: WorldState, actorId: string): WorldState {
  if (!world.actors.some(a => a.id === actorId)) throw new Error('这位人物已经离开');
  if (world.adventure?.control) throw new Error('请先结束当前人物的冒险，再接管另一位人物');
  const next = structuredClone(world);
  next.adventure ??= { health: {}, discovered: {}, resolved: 0 };
  next.adventure.control = { actorId, leaseId: crypto.randomUUID(), since: world.tick };
  next.adventure.health[actorId] ??= 100;
  next.adventure.discovered[actorId] ??= [world.actors.find(a => a.id === actorId)!.region];
  return next;
}
export function releaseControl(world: WorldState): WorldState {
  const next = structuredClone(world);
  if (next.adventure) { delete next.adventure.control; delete next.adventure.encounter; }
  if (next.gal?.kind === 'encounter') delete next.gal;
  return next;
}
export function validateAdventure(world: WorldState) {
  const data = world.adventure; if (!data) return;
  const actor = (id: string) => world.actors.some(a => a.id === id);
  if (!data.health || !data.discovered || !Number.isSafeInteger(data.resolved) || data.resolved < 0
    || data.control && (!actor(data.control.actorId) || typeof data.control.leaseId !== 'string' || data.control.leaseId.length > 100 || !Number.isSafeInteger(data.control.since))
    || Object.entries(data.health).some(([id, hp]) => !actor(id) || !Number.isFinite(hp) || hp < 0 || hp > 100)
    || Object.entries(data.discovered).some(([id, places]) => !actor(id) || !Array.isArray(places) || places.length > 8 || places.some(r => !world.regions[r]))) throw new Error('冒险进度无效');
  const encounter = data.encounter;
  if (encounter && (!data.control || !world.regions[encounter.region] || typeof encounter.id !== 'string' || encounter.id.length > 100
    || !['beast', 'cache', 'traveler'].includes(encounter.kind) || typeof encounter.title !== 'string' || encounter.title.length > 100 || typeof encounter.description !== 'string' || encounter.description.length > 500
    || !Number.isSafeInteger(encounter.danger) || encounter.danger < 1 || encounter.danger > 50 || !Number.isSafeInteger(encounter.reward) || encounter.reward < 1 || encounter.reward > 5
    || !Number.isFinite(encounter.roll) || encounter.roll < 0 || encounter.roll > 1)) throw new Error('遭遇数据无效');
}
