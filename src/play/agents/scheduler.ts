import type { WorldCommit } from '../storage/world-commit';
import type { WorldRepo } from '../storage/world-repo';
import type { ComputeStep } from '../world/session';
import type { Intervention } from '../world/schema';
import { availableActions, finalizePlans } from '../world/simulation';
import { intelligence, withIntelligence } from './state';
import { actorObservation, publicNarrationContext } from './context-projector';
import { addFactProposals, captureKnowledge } from '../memory/console';
import { WorldModelGateway, type WorldModelDependencies, type WorldTrace } from './model-gateway';

export async function intelligentStep(args: {
  repo: WorldRepo; current: () => WorldCommit; accept: (c: WorldCommit) => void; compute: ComputeStep;
  command?: Intervention; signal: AbortSignal; dependencies?: WorldModelDependencies; onTraces?: (traces: WorldTrace[]) => void;
}): Promise<WorldCommit> {
  const { signal } = args, initial = args.current();
  const result = await args.compute(initial.state, args.command, signal, { deferPlans: true });
  result.state = captureKnowledge(result.state, result.events);
  const choices: Record<string, string> = {}, proposals: { actorId: string; texts: string[] }[] = [];
  const baseData = intelligence(result.state);
  const gateway = new WorldModelGateway(() => intelligence(args.current().state), async data => {
    const current = args.current(), state = withIntelligence(current.state); state.intelligence = data;
    const saved = await args.repo.append(current, { state, events: [] }, 'request'); args.accept(saved);
  }, args.dependencies);
  try {
    const ready = result.state.actors.filter(a => !a.job && a.id !== result.state.adventure?.control?.actorId);
    const ordered = [...ready].sort((a, b) => {
      const last = (id: string) => baseData.receipts.filter(r => r.actorId === id && r.purpose === 'plan' && r.outcome === 'accepted').at(-1)?.tick ?? -1;
      const oldest = last(a.id) - last(b.id); if (oldest) return oldest;
      const all = result.state.actors, cursor = baseData.cursor % all.length;
      return (all.indexOf(a) - cursor + all.length) % all.length - (all.indexOf(b) - cursor + all.length) % all.length;
    }).slice(0, 4);
    for (const actor of ordered) {
      signal.throwIfAborted();
      const observation = actorObservation(result.state, actor.id);
      // Bounded view with exact fact IDs. Never combine private actors to save calls.
      const context = { ...observation, persona: observation.persona && { identity: observation.persona.identity.slice(0, 900), temperament: observation.persona.temperament.slice(0, 400),
        privateNotes: observation.persona.privateNotes.slice(0, 1000), ambition: observation.persona.ambition.slice(0, 300) },
        memories: observation.memories.slice(0, 8), legalActions: observation.legalActions.slice(0, 32) };
      const reflect = baseData.settings.reflectionEvery > 0 && result.state.tick % baseData.settings.reflectionEvery === 0;
      const isValid = (value: unknown): value is { actionId: string; facts?: unknown } => {
        const output = value as { actionId?: unknown } | null;
        return !!output && typeof output.actionId === 'string' && context.legalActions.some(a => a.id === output.actionId)
          && availableActions(result.state, actor.id).some(a => a.id === output.actionId);
      };
      const { value } = await gateway.request({ purpose: 'plan', actorId: actor.id, tick: result.state.tick,
        system: '你是世界中的一个人物。只能使用提供的自身人设、所见与已知记忆，不知道远处人物的秘密。从 legalActions 中选择一个 id。当前规则数值优先于可能过时的文字记忆。不得发明行动、数值或改变规则。只返回 JSON：{"actionId":"合法id"' + (reflect ? ',"facts":["从已知事件提炼的短事实，最多3条，每条80字以内，作为待确认候选"]' : '') + '}。',
        context, factIds: context.memories.map(m => m.id), outcome: value => isValid(value) ? 'accepted' : 'rejected' }, signal);
      if (!isValid(value)) throw new Error(`${actor.name}的选择不在合法行动中，本轮已暂停；可重试或切换规则模式`);
      const output = value;
      choices[actor.id] = output.actionId as string;
      if (reflect && Array.isArray(output.facts)) proposals.push({ actorId: actor.id, texts: output.facts.filter((f): f is string => typeof f === 'string' && f.length <= 240) });
    }
    // Deferred actors visibly follow ordinary rule plans; scheduled actors follow
    // the model. No hidden network calls for ongoing multi-step actions.
    finalizePlans(result, choices);
    const budgetData = intelligence(args.current().state);
    result.state.intelligence = { ...intelligence(result.state), receipts: budgetData.receipts, budget: budgetData.budget,
      cursor: (baseData.cursor + 4) % result.state.actors.length };
    for (const proposal of proposals) result.state = addFactProposals(result.state, proposal.actorId, proposal.texts, result.state.tick);
    signal.throwIfAborted();
    // Rule facts are durable before optional literary narration. A failed narrator
    // cannot undo a completed journey, transfer, or encounter.
    const settled = await args.repo.append(args.current(), result, 'step', args.command);
    args.accept(settled);
    if (baseData.settings.narration && result.events.some(e => e.kind !== 'plan')) {
      const context = publicNarrationContext(result.state, result.events);
      const { value } = await gateway.request({ purpose: 'narrative', tick: result.state.tick,
        system: '把已结算的公开事件写成一段有画面感的中文旁白。不得新增行动、物品、秘密、角色心理或改变结果。只返回 JSON：{"text":"80至220字旁白"}。', context,
        factIds: context.facts.map(f => f.id) }, signal);
      const text = (value as { text?: unknown })?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > 1600) throw new Error('文学旁白格式无效，本轮已暂停');
      const next = withIntelligence(args.current().state);
      next.intelligence!.narratives = [...next.intelligence!.narratives.slice(-39), { tick: result.state.tick, text: text.trim(), eventIds: context.events.map(e => e.id) }];
      return await args.repo.append(args.current(), { state: next, events: [] }, 'configure');
    }
    return settled;
  } finally { args.onTraces?.(gateway.traces); }
}
