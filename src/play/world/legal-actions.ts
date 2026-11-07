import { ACTION_NAMES, RESOURCE_NAMES, RESOURCES, type Actor, type Job, type WorldState } from './schema';

export interface LegalAction { id: string; label: string; cost: string; job: Job }
/** Caller supplies traversable adjacent roads, avoiding an engine import cycle. */
export function legalActions(world: WorldState, actor: Actor, roads: { to: string; cost: number }[]): LegalAction[] {
  const result: LegalAction[] = [], here = world.regions[actor.region];
  const add = (type: Job['type'], duration: number, label: string, cost: string, detail: Partial<Job> = {}) => {
    const id = [type, detail.to, detail.resource, detail.peer].filter(Boolean).join(':');
    result.push({ id, label, cost, job: { type, duration, remaining: duration, reason: label, ...detail } });
  };
  add('rest', 2, '休息恢复体力', '2 步，恢复 25 体力');
  const controlled = world.adventure?.control?.actorId === actor.id;
  if (controlled && (world.adventure!.health[actor.id] ?? 100) < 20) return result;
  if (controlled && actor.energy >= 10) add('explore', 2, '探索此地', '2 步，体力 -10；发现遭遇后可选择面对或退避');
  if (actor.energy >= 8) for (const road of roads) add('move', road.cost, `前往${world.regions[road.to].name}`, `${road.cost} 步，体力 -8`, { to: road.to });
  if (actor.energy >= 6 && here.stock[here.resource] > 0) add('gather', 2, `采集${RESOURCE_NAMES[here.resource]}`, '2 步，体力 -6，物资 +1；存量有限可能落空', { resource: here.resource });
  if (actor.energy >= 12 && actor.bag.herb > 0 && actor.bag.food > 0) add('train', 3, '静心修行', '3 步，青叶/干粮各 -1，体力 -12，修为 +10');
  if (actor.region === 'market') for (const r of RESOURCES) if (r !== actor.specialty && here.stock[r] > 0 && actor.bag[actor.specialty] > 0)
    add('trade', 1, `用${RESOURCE_NAMES[actor.specialty]}换${RESOURCE_NAMES[r]}`, '1 步，交换各 1 份；库存可能被他人先取走', { resource: r });
  for (const peer of world.actors) if (peer.id !== actor.id && peer.region === actor.region && peer.job?.type !== 'move') {
    add('talk', 1, `与${peer.name}交谈`, '1 步，双方关系 +1', { peer: peer.id });
    if (actor.bag.food > 0 && peer.bag.food === 0) add('help', 1, `给${peer.name}干粮救急`, '1 步，干粮 -1，关系 +2', { peer: peer.id });
    for (const r of RESOURCES) if (actor.bag[r] > 0) add('gift', 1, `赠${peer.name}一份${RESOURCE_NAMES[r]}`, '1 步，物资 -1，关系 +2', { resource: r, peer: peer.id });
  }
  return result;
}
export function actionName(job: Job) { return ACTION_NAMES[job.type]; }
