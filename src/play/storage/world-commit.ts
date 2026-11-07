import { sha256 } from 'js-sha256';
import { assertWorld } from '../world/simulation';
import type { Intervention, WorldEvent, WorldState } from '../world/schema';

export interface WorldCommit {
  schema: 1; id: string; worldId: string; title: string; revision: number; parent: string | null; hash: string;
  updatedAt: number; kind: 'create' | 'step' | 'checkpoint' | 'archive' | 'restore'; deleted: boolean;
  origin?: { worldId: string; revision: number; hash: string }; command?: Intervention;
  state: WorldState; events: WorldEvent[];
}
export const validWorldId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
export const commitId = (worldId: string, revision: number) => `${worldId}:${String(revision).padStart(6, '0')}`;
export function sealCommit(value: Omit<WorldCommit, 'hash'>): WorldCommit { return { ...value, hash: sha256(JSON.stringify(value)) }; }
export function validCommit(value: unknown): value is WorldCommit {
  try {
    const c = value as WorldCommit;
    if (!c || c.schema !== 1 || typeof c.worldId !== 'string' || !validWorldId(c.worldId)
      || !Number.isSafeInteger(c.revision) || c.revision < 0 || c.revision > 2000 || c.id !== commitId(c.worldId, c.revision)
      || typeof c.title !== 'string' || c.title.length > 100 || typeof c.deleted !== 'boolean' || !Number.isFinite(c.updatedAt)
      || !['create', 'step', 'checkpoint', 'archive', 'restore'].includes(c.kind)
      || !(c.parent === null || typeof c.parent === 'string' && /^[a-f0-9]{64}$/.test(c.parent)) || !Array.isArray(c.events) || c.events.length > 100) return false;
    assertWorld(c.state);
    if (!c.events.every(e => typeof e.id === 'string' && e.tick === c.state.tick && typeof e.title === 'string' && typeof e.detail === 'string'
      && typeof e.cause === 'string' && typeof e.kind === 'string' && c.state.regions[e.region] && Array.isArray(e.actors) && e.actors.every(id => c.state.actors.some(a => a.id === id)))) return false;
    const { hash, ...body } = c;
    return hash === sha256(JSON.stringify(body));
  } catch { return false; }
}
export function checkChain(commits: WorldCommit[]): void {
  if (!commits.length) throw new Error('存档中没有完整提交');
  commits.forEach((c, i) => {
    if (!validCommit(c) || c.worldId !== commits[0].worldId || c.revision !== i || c.parent !== (i ? commits[i - 1].hash : null)) throw new Error(`第 ${i} 版存档校验失败`);
    if (i && c.state.tick !== commits[i - 1].state.tick + (c.kind === 'step' ? 1 : 0)) throw new Error('世界时间链不连续');
  });
}
