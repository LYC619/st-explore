import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '@/play/world/simulation';
import { withIntelligence, intelligence } from '@/play/agents/state';
import { beginBudget, reserveBudget, settleBudget, WorldBudgetError } from '@/play/agents/budget';
import { actorObservation, publicNarrationContext } from '@/play/agents/context-projector';
import { WorldModelGateway } from '@/play/agents/model-gateway';
import {
  addFactProposals,
  captureKnowledge,
  eventVisible,
  factVisible,
  saveFact,
  setFactStatus,
  visibleFacts,
} from '@/play/memory/console';
import { nearbyActorIds } from '@/play/adventure/perspective';
import type { WorldEvent } from '@/play/world/schema';

describe('Native World Play v3 dual-view memory and private knowledge isolation', () => {
  it('enforces director, observer, and actor visibility boundaries on facts and events', () => {
    let world = withIntelligence(createWorld(42));
    world = saveFact(world, { type: 'event', subject: '集市', text: 'PUBLIC_MARKET_FACT', visibility: 'public' });
    world = saveFact(world, { type: 'secret', subject: '林', text: 'ACTOR0_SECRET_FACT', visibility: 'private', owner: 'a0' });
    world = saveFact(world, { type: 'secret', subject: '沈', text: 'ACTOR1_SECRET_FACT', visibility: 'private', owner: 'a1' });

    const planEvent: WorldEvent = { id: 'ev-plan', tick: 1, kind: 'plan', region: 'camp', actors: ['a0'], title: '计划', detail: 'A0_PRIVATE_PLAN', cause: '内部规划' };
    const secretTrade: WorldEvent = { id: 'ev-trade', tick: 1, kind: 'trade', region: 'market', actors: ['a0'], witnesses: ['a0', 'a2'], title: '交易', detail: 'A0_A2_WITNESSED', cause: '以物易物' };
    const weatherEvent: WorldEvent = { id: 'ev-rain', tick: 1, kind: 'weather', region: 'ferry', actors: [], title: '暴雨', detail: 'PUBLIC_RAIN', cause: '天气变化' };
    world = captureKnowledge(world, [planEvent, secretTrade, weatherEvent]);

    // Director sees all facts and all events (including plan events).
    const directorFacts = visibleFacts(world, { kind: 'director' }).map(f => f.text);
    expect(directorFacts).toEqual(expect.arrayContaining([
      'PUBLIC_MARKET_FACT',
      'ACTOR0_SECRET_FACT',
      'ACTOR1_SECRET_FACT',
      '交易：A0_A2_WITNESSED',
      '暴雨：PUBLIC_RAIN',
    ]));
    expect(eventVisible(planEvent, { kind: 'director' })).toBe(true);
    expect(eventVisible(secretTrade, { kind: 'director' })).toBe(true);

    // Observer sees public facts & non-plan events, never private secrets or plan events.
    const observerFacts = visibleFacts(world, { kind: 'observer' }).map(f => f.text);
    expect(observerFacts).toContain('PUBLIC_MARKET_FACT');
    expect(observerFacts).toContain('暴雨：PUBLIC_RAIN');
    expect(observerFacts).not.toContain('ACTOR0_SECRET_FACT');
    expect(observerFacts).not.toContain('ACTOR1_SECRET_FACT');
    expect(observerFacts).not.toContain('交易：A0_A2_WITNESSED');
    expect(eventVisible(planEvent, { kind: 'observer' })).toBe(false);
    expect(eventVisible(weatherEvent, { kind: 'observer' })).toBe(true);

    // Actor a2 (witness of secretTrade) sees public + witnessed fact, but NOT a0's or a1's private secrets.
    const a2Facts = visibleFacts(world, { kind: 'actor', actorId: 'a2' }).map(f => f.text);
    expect(a2Facts).toContain('PUBLIC_MARKET_FACT');
    expect(a2Facts).toContain('交易：A0_A2_WITNESSED');
    expect(a2Facts).not.toContain('ACTOR0_SECRET_FACT');
    expect(a2Facts).not.toContain('ACTOR1_SECRET_FACT');
    expect(eventVisible(secretTrade, { kind: 'actor', actorId: 'a2' })).toBe(true);
    expect(eventVisible(secretTrade, { kind: 'actor', actorId: 'a1' })).toBe(false);

    // Verify factVisible directly on private facts.
    const a0Secret = intelligence(world).facts.find(f => f.text === 'ACTOR0_SECRET_FACT')!;
    expect(factVisible(a0Secret, { kind: 'actor', actorId: 'a0' })).toBe(true);
    expect(factVisible(a0Secret, { kind: 'actor', actorId: 'a1' })).toBe(false);
  });

  it('isolates actorObservation and publicNarrationContext from expired, disabled, pending, and foreign private memories', () => {
    let world = withIntelligence(createWorld(77));
    world.tick = 10;
    world.intelligence!.personas.a0.privateNotes = 'A0_ONLY_PERSONA';
    world.intelligence!.personas.a1.privateNotes = 'A1_ONLY_PERSONA';

    // Add 15 active facts for a0 (should be trimmed to latest 12 in actorObservation)
    for (let i = 0; i < 15; i++) {
      world = saveFact({ ...world, tick: i + 1 }, { type: 'event', subject: `事${i}`, text: `ACTIVE_FACT_${i}`, visibility: 'public' });
    }
    // Add an expired fact, a disabled fact, a deleted fact, a pending model proposal, and a foreign private fact.
    world = saveFact({ ...world, tick: 20 }, { type: 'status', subject: '过期', text: 'EXPIRED_FACT', visibility: 'public', expiresAt: 15 });
    world = saveFact({ ...world, tick: 20 }, { type: 'status', subject: '停用', text: 'DISABLED_FACT', visibility: 'public' });
    const disabledId = intelligence(world).facts.find(f => f.text === 'DISABLED_FACT')!.id;
    world = setFactStatus(world, disabledId, 'disabled');
    world = saveFact({ ...world, tick: 20 }, { type: 'status', subject: '删除', text: 'DELETED_FACT', visibility: 'public' });
    const deletedId = intelligence(world).facts.find(f => f.text === 'DELETED_FACT')!.id;
    world = setFactStatus(world, deletedId, 'deleted');
    world = addFactProposals(world, 'a0', ['PENDING_PROPOSAL_TEXT'], 20);
    world = saveFact({ ...world, tick: 20 }, { type: 'secret', subject: '他人', text: 'FOREIGN_PRIVATE_FACT', visibility: 'private', owner: 'a1' });
    world.tick = 20;

    const obs = actorObservation(world, 'a0');
    expect(obs.memories).toHaveLength(12);
    const dumpedObs = JSON.stringify(obs);
    expect(dumpedObs).toContain('A0_ONLY_PERSONA');
    expect(dumpedObs).toContain('ACTIVE_FACT_14');
    expect(dumpedObs).not.toContain('ACTIVE_FACT_0');
    expect(dumpedObs).not.toContain('EXPIRED_FACT');
    expect(dumpedObs).not.toContain('DISABLED_FACT');
    expect(dumpedObs).not.toContain('DELETED_FACT');
    expect(dumpedObs).not.toContain('PENDING_PROPOSAL_TEXT');
    expect(dumpedObs).not.toContain('FOREIGN_PRIVATE_FACT');
    expect(dumpedObs).not.toContain('A1_ONLY_PERSONA');

    // Restoring deleted fact recovers its prior enabled status.
    const restored = setFactStatus(world, deletedId, 'restore');
    expect(intelligence(restored).facts.find(f => f.id === deletedId)!.status).toBe('enabled');

    // Public narration caps events to latest 8 non-plan and public facts to latest 8 active, with zero private leakage.
    const events: WorldEvent[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e-${i}`,
      tick: i,
      kind: i === 11 ? 'plan' : 'gather',
      region: 'forest',
      actors: ['a0'],
      title: `事件${i}`,
      detail: `DETAIL_${i}`,
      cause: '规则结算',
    }));
    const narration = publicNarrationContext(world, events);
    expect(narration.events).toHaveLength(8);
    expect(narration.facts).toHaveLength(8);
    const dumpedNarration = JSON.stringify(narration);
    expect(dumpedNarration).not.toContain('DETAIL_11'); // plan event excluded
    expect(dumpedNarration).not.toContain('A0_ONLY_PERSONA');
    expect(dumpedNarration).not.toContain('A1_ONLY_PERSONA');
    expect(dumpedNarration).not.toContain('FOREIGN_PRIVATE_FACT');
    expect(dumpedNarration).not.toContain('EXPIRED_FACT');
  });

  it('bounds derived witness memories while preserving authored facts and hides moving/distant actors', () => {
    let world = withIntelligence(createWorld(19));
    world = saveFact(world, { type: 'promise', subject: '核心设定', text: 'AUTHORED_KEEP', visibility: 'public' });
    const bulkEvents: WorldEvent[] = Array.from({ length: 520 }, (_, i) => ({
      id: `bulk-${i}`,
      tick: i,
      kind: 'weather',
      region: 'camp',
      actors: [],
      title: `天气${i}`,
      detail: `细节${i}`,
      cause: '天气轮换',
    }));
    world = captureKnowledge(world, bulkEvents);
    const facts = intelligence(world).facts;
    expect(facts.length).toBeLessThanOrEqual(500);
    expect(facts.some(f => f.text === 'AUTHORED_KEEP')).toBe(true);
    expect(facts.some(f => f.id === 'event:bulk-519')).toBe(true);
    expect(facts.some(f => f.id === 'event:bulk-0')).toBe(false);

    // Witness facts cannot be mutated via saveFact or setFactStatus.
    const witnessId = facts.find(f => f.origin === 'witness')!.id;
    expect(() => setFactStatus(world, witnessId, 'disabled')).toThrow('只读');

    // nearbyActorIds hides moving actors and actors in other regions.
    world.actors[0].region = 'camp';
    world.actors[0].job = undefined;
    world.actors[1].region = 'camp';
    world.actors[1].job = undefined;
    world.actors[2].region = 'camp';
    world.actors[2].job = { type: 'move', to: 'forest', remaining: 1, duration: 1, reason: '赶路' };
    world.actors[3].region = 'market';
    world.actors[3].job = undefined;
    const nearby = nearbyActorIds(world, 'a0');
    expect(nearby).toContain('a0');
    expect(nearby).toContain('a1');
    expect(nearby).not.toContain('a2');
    expect(nearby).not.toContain('a3');
  });
});

describe('Native World Play v3 token budget enforcement and context trimming', () => {
  it('enforces session expiry, call cap, token cap, receipt bounding, and idempotent settlement', () => {
    let data = intelligence(withIntelligence(createWorld(7)));
    // Missing budget rejected
    expect(() => reserveBudget(data, { id: 'r0', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'm', reserved: 100 })).toThrow(WorldBudgetError);

    data = beginBudget({ ...data, settings: { ...data.settings, maxCalls: 2, maxTokens: 1000 } }, 1000);
    // Session expired after 5 minutes
    expect(() => reserveBudget(data, { id: 'r-exp', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'm', reserved: 100 }, 1000 + 5 * 60_000 + 1)).toThrow('5 分钟');

    // Non-positive reserved tokens rejected
    expect(() => reserveBudget(data, { id: 'r-zero', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'm', reserved: 0 }, 2000)).toThrow(WorldBudgetError);

    // Token overflow rejected before mutating budget
    expect(() => reserveBudget(data, { id: 'r-over', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'm', reserved: 1001 }, 2000)).toThrow(WorldBudgetError);

    // Reserve and reconcile actual lower usage
    data = reserveBudget(data, { id: 'r1', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'm', reserved: 600 }, 2000);
    expect(data.budget!.charged).toBe(600);
    data = settleBudget(data, 'r1', 'completed', { input: 200, output: 50 }, 120);
    expect(data.budget!.charged).toBe(250);
    expect(data.receipts[0]).toMatchObject({ status: 'completed', charged: 250, estimated: false, inputTokens: 200, outputTokens: 50, elapsedMs: 120 });

    // Duplicate settlement is a no-op
    expect(settleBudget(data, 'r1', 'completed', { input: 1, output: 1 })).toEqual(data);

    // Second call succeeds, third call hits maxCalls
    data = reserveBudget(data, { id: 'r2', purpose: 'plan', tick: 2, contextRevision: 0, factIds: [], model: 'm', reserved: 300 }, 3000);
    expect(() => reserveBudget(data, { id: 'r3', purpose: 'plan', tick: 3, contextRevision: 0, factIds: [], model: 'm', reserved: 100 }, 4000)).toThrow(WorldBudgetError);
  });

  it('rejects oversized actor input context before reserving budget or invoking model transport', async () => {
    let data = beginBudget(intelligence(withIntelligence(createWorld(11))));
    const send = vi.fn();
    const persist = vi.fn(async next => { data = next; });
    const gateway = new WorldModelGateway(() => data, persist, {
      config: () => ({ apiUrl: 'https://synthetic.invalid/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' }),
      send,
    });

    const oversized = { contextRevision: 1, hugeMemo: '长段设定内容'.repeat(1200) };
    await expect(gateway.request({
      purpose: 'plan',
      actorId: 'a0',
      tick: 1,
      system: '请选择行动',
      context: oversized,
    }, new AbortController().signal)).rejects.toThrow('超出输入上限');

    expect(send).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(data.budget!.calls).toBe(0);
    expect(data.budget!.charged).toBe(0);
  });
});
