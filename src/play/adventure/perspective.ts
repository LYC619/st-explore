import type { WorldState } from '../world/schema';
/** Geography is public; live positions and activity are only visible at the player's current site. */
export function nearbyActorIds(world: WorldState, actorId?: string): string[] {
  if (!actorId) return world.actors.map(a => a.id);
  const self = world.actors.find(a => a.id === actorId);
  return world.actors.filter(a => a.id === actorId || self?.job?.type !== 'move' && a.region === self?.region && a.job?.type !== 'move').map(a => a.id);
}
