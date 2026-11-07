import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld, routeBetween } from '@/play/world/simulation';

describe('独立规则世界', () => {
  it('同种子与干预有相同结算，不修改输入', () => {
    const initial = createWorld(73), before = JSON.stringify(initial);
    const a = stepWorld(initial, { type: 'rain', duration: 4 });
    expect(a).toEqual(stepWorld(initial, { type: 'rain', duration: 4 }));
    expect(JSON.stringify(initial)).toBe(before);
    expect(a.state.tick).toBe(1);
  });
  it('降雨阻断渡口并改变真实最短路径', () => {
    const world = createWorld(73);
    const dry = routeBetween(world, 'camp', 'market');
    const wet = stepWorld(world, { type: 'rain', duration: 4 }).state;
    expect(dry).toContain('ferry');
    expect(routeBetween(wet, 'camp', 'market')).not.toContain('ferry');
    expect(wet.actors[0].job?.to).not.toBe('ferry');
  });
  it('争夺最后一份药材只结算一次，资源守恒且可解释', () => {
    const world = createWorld(91);
    world.regions.forest.stock.herb = 1;
    world.actors.forEach((actor, i) => {
      actor.region = 'forest';
      actor.job = i < 2 ? { type: 'gather', resource: 'herb', remaining: 1, duration: 2, reason: '备药' }
        : { type: 'rest', remaining: 2, duration: 2, reason: '休息' };
    });
    const total = world.actors.reduce((sum, actor) => sum + actor.bag.herb, 0);
    const result = stepWorld(world);
    expect(result.state.regions.forest.stock.herb).toBe(0);
    expect(result.state.actors.reduce((sum, actor) => sum + actor.bag.herb, 0)).toBe(total + 1);
    expect(result.events.some(event => event.kind === 'competition')).toBe(true);
  });
  it('移动花费时间、非法命令不产生半轮状态', () => {
    const world = createWorld(73);
    expect(() => stepWorld(world, { type: 'supply', region: '../bad', resource: 'herb', amount: 3 })).toThrow();
    const first = stepWorld(world).state;
    expect(first.actors[0].region).toBe(world.actors[0].region);
    expect(first.actors[0].job?.type).toBe('move');
  });
  it('长期运行库存不为负、动作含交往与成长', () => {
    let world = createWorld(73);
    const kinds = new Set<string>();
    for (let i = 0; i < 160; i++) {
      const result = stepWorld(world); world = result.state;
      result.events.forEach(event => kinds.add(event.kind));
      for (const actor of world.actors) {
        expect(actor.energy).toBeGreaterThanOrEqual(0);
        Object.values(actor.bag).forEach(n => expect(n).toBeGreaterThanOrEqual(0));
      }
    }
    expect(kinds.has('train')).toBe(true);
    expect(kinds.has('talk')).toBe(true);
    expect(kinds.has('trade')).toBe(true);
  });
  it('两人购买最后一份物资仅一人成交，另一人没有扣款', () => {
    const world = createWorld(73);
    world.regions.market.stock.herb = 1;
    world.actors.forEach((a, i) => {
      a.region = 'market'; a.specialty = 'ore'; a.bag.ore = 3; a.bag.herb = 0;
      a.job = i < 2 ? { type: 'trade', resource: 'herb', remaining: 1, duration: 1, reason: '换药' }
        : { type: 'rest', remaining: 2, duration: 2, reason: '歇息' };
    });
    const result = stepWorld(world), pair = result.state.actors.slice(0, 2);
    expect(pair.reduce((n, a) => n + a.bag.ore, 0)).toBe(5);
    expect(pair.reduce((n, a) => n + a.bag.herb, 0)).toBe(1);
    expect(result.state.regions.market.stock.ore).toBe(world.regions.market.stock.ore + 1);
    expect(result.events.some(e => e.kind === 'competition')).toBe(true);
  });
  it('援助只转移已有物资，双方留下关系变化', () => {
    const world = createWorld(73), giver = world.actors[0], receiver = world.actors[1];
    receiver.region = giver.region; receiver.bag.food = 0;
    giver.job = { type: 'help', peer: receiver.id, remaining: 1, duration: 1, reason: '同伴缺粮' };
    receiver.job = { type: 'rest', remaining: 2, duration: 2, reason: '等候' };
    const result = stepWorld(world);
    expect(result.state.actors[0].bag.food).toBe(giver.bag.food - 1);
    expect(result.state.actors[1].bag.food).toBe(1);
    expect(result.state.actors[1].relations[giver.id]).toBe(2);
  });
  it('正在渡河时降雨退回原点，雨停后恢复路线', () => {
    let world = stepWorld(createWorld(73)).state;
    const result = stepWorld(world, { type: 'rain', duration: 1 });
    world = result.state;
    expect(world.actors[0].region).toBe('camp');
    expect(result.events.some(e => e.kind === 'reroute' && e.actors.includes('a0'))).toBe(true);
    world = stepWorld(world).state;
    expect(routeBetween(world, 'camp', 'market')).toContain('ferry');
  });
});
