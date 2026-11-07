import { expect, it } from 'vitest';
import { createWorld, stepWorld, assertWorld } from '@/play/world/simulation';
import { takeControl, releaseControl } from '@/play/adventure/control';
import { createSanctuary, personaFromCard, summon } from '@/play/sanctuary/summon';
import { intelligence } from '@/play/agents/state';
import { actorObservation } from '@/play/agents/context-projector';
import type { ArchiveCharacter } from '@/types/archive';

it('唯一控制权阻止自动规划与过期操作，放回后继续自主生活', () => {
  let world = takeControl(createWorld(73), 'a0'); const control = world.adventure!.control!;
  expect(() => takeControl(world, 'a1')).toThrow('先结束');
  world = stepWorld(world).state; expect(world.actors[0].job).toBeUndefined();
  expect(() => stepWorld(world, { type: 'action', ...control, leaseId: 'old', actionId: 'rest' })).toThrow('控制权');
  world = stepWorld(world, { type: 'action', ...control, actionId: 'move:ferry' }).state;
  expect(world.actors[0].region).toBe('ferry');
  expect(stepWorld(releaseControl(world)).state.actors[0].job).toBeDefined();
});
it('探索产生持久遭遇，重复选择被拒绝，物资从地区转移且受伤可恢复', () => {
  let world = takeControl(createWorld(73), 'a0'); const control = world.adventure!.control!;
  world = stepWorld(world, { type: 'action', ...control, actionId: 'explore' }).state;
  world = stepWorld(world).state; const encounter = world.adventure!.encounter!;
  expect(encounter).toBeDefined(); expect(() => stepWorld(world)).toThrow('等你选择');
  const before = world.actors[0].bag.food + world.regions.camp.stock.food;
  const command = { type: 'encounter' as const, ...control, encounterId: encounter.id, choice: 'face' as const };
  const result = stepWorld(world, command); expect(result).toEqual(stepWorld(world, command)); world = result.state;
  expect(world.actors[0].bag.food + world.regions.camp.stock.food).toBe(before);
  expect(world.adventure!.health.a0).toBeLessThan(100); expect(world.adventure!.encounter).toBeUndefined();
  expect(() => stepWorld(world, command)).toThrow('已失效');
  world = stepWorld(world, { type: 'action', ...control, actionId: 'rest' }).state; world = stepWorld(world).state;
  expect(world.adventure!.health.a0).toBe(100); assertWorld(world);
});
const card = (id: string): ArchiveCharacter => ({ id, name: id, card: { name: id, description: `${id}的人设`, personality: '温柔', scenario: `${id}_PRIVATE` }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1 });
it('休息室召集优先于日程，保留十二步后恢复日常', () => {
  const original = createSanctuary(73), ordinary = stepWorld(original).state;
  let invited = stepWorld(original, { type: 'gathering', region: 'coast' }).state;
  expect(invited.actors.every(a => a.goal === 'coast')).toBe(true);
  expect(invited.actors).not.toEqual(ordinary.actors);
  for (let n = 0; n < 12; n++) invited = stepWorld(invited).state;
  expect(invited.gathering).toBeUndefined();
  expect(invited.actors.some(a => a.goal !== 'coast')).toBe(true);
});
it('跨作品召唤仅修改世界实例，分别携带私密记忆，日程产生走动与关系', () => {
  const a = card('A'), b = card('B'), original = JSON.stringify([a, b]);
  let world = summon(createSanctuary(73), 'a0', a, personaFromCard(a), ['A_FACT']);
  world = summon(world, 'a1', b, personaFromCard(b), ['B_FACT']);
  expect(JSON.stringify(actorObservation(world, 'a0'))).toContain('A_FACT');
  expect(JSON.stringify(actorObservation(world, 'a0'))).not.toMatch(/B_PRIVATE|B_FACT/);
  for (let n = 0; n < 50; n++) world = stepWorld(world).state;
  expect(world.actors[0].journeys).toBeGreaterThan(0); expect(world.actors.some(a => Object.keys(a.relations).length > 0)).toBe(true);
  expect(JSON.stringify([a, b])).toBe(original); assertWorld(world);
  const replacement = card('C'); world = summon(world, 'a0', replacement, personaFromCard(replacement), []);
  expect(JSON.stringify(actorObservation(world, 'a0'))).not.toContain('A_FACT');
  expect(intelligence(world).personas.a1.source!.characterId).toBe('B');
});
