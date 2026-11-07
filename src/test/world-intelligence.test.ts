import { describe, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { WorldRepo } from '@/play/storage/world-repo';
import { createWorld, stepWorld } from '@/play/world/simulation';
import { WorldSession } from '@/play/world/session';
import { intelligence, withIntelligence } from '@/play/agents/state';
import { beginBudget, reserveBudget, settleBudget } from '@/play/agents/budget';
import { actorObservation, publicNarrationContext } from '@/play/agents/context-projector';
import { WorldModelGateway } from '@/play/agents/model-gateway';
import { addFactProposals, captureKnowledge, saveFact, setFactStatus, visibleFacts } from '@/play/memory/console';

const config = () => ({ apiUrl: 'https://test.invalid/v1', apiKey: 'TEST_KEY_NEVER_PERSIST', model: 'gpt-4o-mini' });
const reply = (value: unknown, usage = true) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }], ...(usage ? { usage: { prompt_tokens: 300, completion_tokens: 30 } } : {}) }));
function world() {
  const state = withIntelligence(createWorld(73));
  state.intelligence!.settings = { ...state.intelligence!.settings, mode: 'ai', narration: false };
  state.intelligence = beginBudget(state.intelligence!);
  state.intelligence.personas.a0.privateNotes = 'A_PRIVATE_CANARY';
  state.intelligence.personas.a1.privateNotes = 'B_PRIVATE_CANARY';
  return saveFact(state, { type: 'secret', subject: '沈砚', text: 'B_FACT_CANARY', visibility: 'private', owner: 'a1' });
}
describe('人物智能的实际请求与提交边界', () => {
  it('为推理模型预留可配置输出额度，截断正文只记账一次并停止', async () => {
    let data = intelligence(world()); data.settings.outputTokens = 1024; let sends = 0;
    const gateway = new WorldModelGateway(() => data, async next => { data = next; }, { config, send: async prepared => {
      sends++; expect(prepared.body.max_tokens).toBe(1024);
      expect(data.receipts.at(-1)!.reserved).toBeGreaterThan(1024);
      return new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 100, completion_tokens: 1024 } }));
    } });
    await expect(gateway.request({ purpose: 'plan', actorId: 'a0', tick: 0, system: '选择合法行动', context: {} }, new AbortController().signal)).rejects.toThrow('输出额度');
    expect(sends).toBe(1); expect(data.receipts[0].charged).toBe(1124); expect(data.receipts[0].status).toBe('failed');
  });
  it('文学旁白失败不撤回已结算的地图与事件', async () => {
    const repo = new WorldRepo(createMemFs()), state = world(); state.intelligence!.settings.narration = true;
    const first = await repo.create('旁白中断', state);
    const session = new WorldSession(repo, first, async (s, c, _signal, options) => stepWorld(s, c, options), { config, send: async prepared => {
      const messages = prepared.body.messages as { content: string }[], context = JSON.parse(messages[1].content);
      if (!context.self) return new Response('unavailable', { status: 503 });
      return reply({ actionId: 'rest' });
    } });
    await expect(session.step({ type: 'rain', duration: 4 })).rejects.toThrow('503');
    const commits = (await repo.load(first.worldId)).commits;
    expect(commits.at(-1)!.state.tick).toBe(1); expect(commits.at(-1)!.state.weather.rainUntil).toBe(4);
    expect(commits.flatMap(c => c.events).some(e => e.kind === 'weather')).toBe(true);
  });
  it('分离 A/B 的最终出站正文，并在发送前落盘预算，旁白不见私密人设或事实', async () => {
    const repo = new WorldRepo(createMemFs()); let current = await repo.create('私密请求', world());
    const bodies: string[] = [];
    const gateway = new WorldModelGateway(() => intelligence(current.state), async data => {
      const state = withIntelligence(current.state); state.intelligence = data;
      current = await repo.append(current, { state, events: [] }, 'request');
    }, { config, send: async prepared => {
      expect((await repo.load(current.worldId)).commits.at(-1)!.state.intelligence!.receipts.at(-1)!.status).toBe('reserved');
      bodies.push(JSON.stringify(prepared.body)); return reply({ actionId: 'rest' });
    } });
    for (const actorId of ['a0', 'a1']) await gateway.request({ purpose: 'plan', actorId, tick: 1, system: '只选合法行动', context: actorObservation(current.state, actorId) }, new AbortController().signal);
    expect(bodies[0]).toContain('A_PRIVATE_CANARY'); expect(bodies[0]).not.toMatch(/B_PRIVATE_CANARY|B_FACT_CANARY/);
    expect(bodies[1]).toContain('B_PRIVATE_CANARY'); expect(bodies[1]).toContain('B_FACT_CANARY'); expect(bodies[1]).not.toContain('A_PRIVATE_CANARY');
    expect(JSON.stringify(publicNarrationContext(current.state, []))).not.toMatch(/PRIVATE_CANARY|FACT_CANARY/);
    expect(JSON.stringify(current)).not.toContain('TEST_KEY_NEVER_PERSIST');
    expect(current.state.intelligence!.budget!.charged).toBe(660);
  });
  it('不合法的模型选择暂停整步但保留费用，重开和分支都不会丢失凭据', async () => {
    const repo = new WorldRepo(createMemFs()), first = await repo.create('非法决策', world());
    const session = new WorldSession(repo, first, async (s, c, _signal, options) => stepWorld(s, c, options), { config, send: async () => reply({ actionId: 'teleport', bag: { ore: 9999 } }) });
    await expect(session.step()).rejects.toThrow('不在合法行动');
    const loaded = (await repo.load(first.worldId)).commits.at(-1)!;
    expect(loaded.state.tick).toBe(0); expect(loaded.state.actors).toEqual(first.state.actors);
    expect(loaded.state.intelligence!.receipts[0]).toMatchObject({ status: 'completed', outcome: 'rejected', charged: 330 });
    expect((await repo.fork(loaded, '保留费用')).state.intelligence!.budget!.charged).toBe(330);
  });
  it('停止在途模型请求后不推进世界，缺失 usage 仍按预留收费', async () => {
    const repo = new WorldRepo(createMemFs()), first = await repo.create('取消', world());
    let sent!: () => void; const waiting = new Promise<void>(resolve => { sent = resolve; });
    const session = new WorldSession(repo, first, async (s, c, _signal, options) => stepWorld(s, c, options), { config, send: async (_prepared, signal) => {
      sent(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const running = session.step(); await waiting; session.stop(); await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    const latest = (await repo.load(first.worldId)).commits.at(-1)!;
    expect(latest.state.tick).toBe(0); const receipt = latest.state.intelligence!.receipts[0];
    expect(receipt.status).toBe('cancelled'); expect(receipt.charged).toBe(receipt.reserved); expect(receipt.estimated).toBe(true);
  });
  it('每步最多四个独立人物请求，持续行动不重规划，轮转最终覆盖十二人', async () => {
    const repo = new WorldRepo(createMemFs()), first = await repo.create('轮转', world()); let count = 0;
    const seen = new Set<string>();
    const session = new WorldSession(repo, first, async (s, c, _signal, options) => stepWorld(s, c, options), { config, send: async prepared => {
      const messages = prepared.body.messages as { content: string }[], context = JSON.parse(messages[1].content);
      count++; seen.add(context.self.id); return reply({ actionId: context.legalActions.find((a: {id: string}) => a.id === 'rest').id });
    } });
    for (let n = 0; n < 6; n++) { const before = count; await session.step(); expect(count - before).toBeLessThanOrEqual(4); }
    expect(seen.size).toBe(12);
  });
});
it('预算在出站之前拒绝超额，未知用量和重复结算不回赠额度', () => {
  let data = intelligence(world()); data = { ...data, budget: { ...data.budget!, maxCalls: 1, maxTokens: 1000 } };
  data = reserveBudget(data, { id: 'r', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'test', reserved: 800 });
  data = settleBudget(data, 'r', 'failed'); expect(data.budget!.charged).toBe(800);
  expect(settleBudget(data, 'r', 'completed', { input: 1, output: 1 })).toEqual(data);
  expect(() => reserveBudget(data, { id: 'r2', purpose: 'plan', tick: 1, contextRevision: 0, factIds: [], model: 'test', reserved: 100 })).toThrow('额度');
});
it('待确认事实、停用、删除与恢复即时改变可注入上下文，编辑不会改变原分支', () => {
  const initial = world(); let state = addFactProposals(initial, 'a0', ['答应归还一份干粮'], 1);
  const id = state.intelligence!.facts.at(-1)!.id;
  expect(visibleFacts(state, { kind: 'actor', actorId: 'a0' }, true)).toHaveLength(0);
  state = setFactStatus(state, id, 'enabled'); expect(actorObservation(state, 'a0').memories).toHaveLength(1);
  state = setFactStatus(state, id, 'disabled'); expect(actorObservation(state, 'a0').memories).toHaveLength(0);
  state = saveFact(state, { ...state.intelligence!.facts.find(f => f.id === id)!, text: '答应归还两份干粮' }, id);
  expect(actorObservation(state, 'a0').memories).toHaveLength(0);
  state = setFactStatus(state, id, 'deleted'); state = setFactStatus(state, id, 'restore');
  expect(state.intelligence!.facts.find(f => f.id === id)!.status).toBe('disabled');
  expect(initial.intelligence!.facts).toHaveLength(1);
});
it('结算事件只向知情人生成记忆，事件记录不可改写', () => {
  const state = captureKnowledge(world(), [{ id: 'private-event', tick: 1, kind: 'talk', title: '相遇', detail: '交换消息', cause: '同处', actors: ['a0'], region: 'camp', witnesses: ['a0', 'a11'] }]);
  expect(actorObservation(state, 'a1').memories.some(f => f.id === 'event:private-event')).toBe(false);
  expect(actorObservation(state, 'a11').memories.some(f => f.id === 'event:private-event')).toBe(true);
  expect(() => setFactStatus(state, 'event:private-event', 'deleted')).toThrow('只读');
});
it('多步行路中的人物不再旁听出发地的新事件', () => {
  const state = createWorld(73), traveler = state.actors[5], miner = state.actors[6];
  traveler.region = 'valley'; traveler.job = { type: 'move', duration: 3, remaining: 2, to: 'coast', reason: '远行' };
  miner.region = 'valley'; miner.job = { type: 'gather', duration: 2, remaining: 1, resource: 'ore', reason: '采矿' };
  const result = stepWorld(state), event = result.events.find(e => e.kind === 'gather' && e.actors.includes(miner.id))!;
  expect(result.state.actors[5].job!.remaining).toBe(1);
  expect(event.witnesses).not.toContain(traveler.id);
  expect(actorObservation(captureKnowledge(result.state, result.events), traveler.id).memories.some(m => m.id === `event:${event.id}`)).toBe(false);
});
