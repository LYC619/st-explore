import { ACTION_NAMES, RESOURCE_NAMES, RESOURCES, RULESET, type Actor, type Edge, type Intervention, type Job, type Resource, type StepResult, type WorldEvent, type WorldState } from './schema';
import { legalActions } from './legal-actions';
import { validateIntelligence } from '../agents/state';
import { validateAdventure } from '../adventure/control';
import { validateGal } from '../gal/scene';

export const EDGES: Edge[] = [
  { from: 'camp', to: 'ferry', cost: 1, ferry: true }, { from: 'ferry', to: 'market', cost: 1, ferry: true },
  { from: 'camp', to: 'forest', cost: 2 }, { from: 'forest', to: 'mountain', cost: 2 },
  { from: 'mountain', to: 'market', cost: 2 }, { from: 'market', to: 'coast', cost: 2 },
  { from: 'camp', to: 'farm', cost: 2 }, { from: 'farm', to: 'forest', cost: 2 },
  { from: 'farm', to: 'valley', cost: 2 }, { from: 'valley', to: 'coast', cost: 3 },
  { from: 'valley', to: 'market', cost: 2 },
];
export function createWorld(seed: number): WorldState {
  const rows: [string, string, number, number, Resource, string][] = [
    ['mountain', '霜岭', 490, 170, 'ore', '灵石蕴藏于高山，往来需翻越山道。'],
    ['forest', '青岚林', 270, 330, 'herb', '青叶生于林下，采药人争抢有限的药圃。'],
    ['camp', '归云营地', 420, 425, 'food', '行旅从此出发，备齐药粮后归来修行。'],
    ['ferry', '灵泽渡口', 575, 345, 'herb', '通往市集的近路，暴雨时停止通行。'],
    ['market', '望川集', 740, 290, 'food', '互通有无：一份特产交换一份所需物资。'],
    ['farm', '稻香原', 260, 570, 'food', '粮仓渐空时，必须寻找新的补给地。'],
    ['valley', '听风谷', 600, 580, 'ore', '避世修行的山谷，也是南部行路的节点。'],
    ['coast', '沧海滩', 845, 510, 'herb', '远途药源，灵泽封渡时更显珍贵。'],
  ];
  const names = ['林照晚', '沈砚', '闻溪', '陆青川', '白榆', '凌舟', '谢知微', '苏遥', '顾山', '闻鹤', '叶归', '宁初'];
  const starts = ['camp', 'forest', 'market', 'farm', 'mountain', 'valley', 'coast', 'ferry', 'forest', 'mountain', 'market', 'camp'];
  const colors = ['#d5ad70', '#97b7a2', '#dfb8a5', '#93b2d0', '#c1b489', '#c6a5c4'];
  return { schema: 1, ruleset: RULESET, tick: 0, rng: (seed >>> 0) || 73, weather: { rainUntil: 0 },
    regions: Object.fromEntries(rows.map(([id, name, x, y, resource, description]) => [id, {
      id, name, x, y, resource, description, stock: id === 'market' ? { herb: 16, food: 20, ore: 12 }
        : { herb: resource === 'herb' ? 18 : 0, food: resource === 'food' ? 30 : 0, ore: resource === 'ore' ? 24 : 0 },
    }])),
    actors: names.map((name, i) => ({ id: `a${i}`, name, role: ['采药者', '行旅', '行商', '修行者'][i % 4], color: colors[i % colors.length],
      region: starts[i], home: i === 0 ? 'camp' : starts[i], goal: i === 0 ? 'market' : starts[i], energy: 55 + i * 3,
      xp: 0, bag: { herb: i % 3, food: 2 + i % 2, ore: i % 4 }, specialty: RESOURCES[i % 3], sociability: 4 + i % 5,
      relations: {}, lastSocial: -10 - i, journeys: 0,
    })),
  };
}

export function isRaining(world: WorldState) { return world.tick <= world.weather.rainUntil && world.weather.rainUntil > 0; }
export function routeBetween(world: WorldState, start: string, end: string): string[] {
  if (!world.regions[start] || !world.regions[end]) throw new Error('地点不存在');
  const distance = new Map([[start, 0]]), paths = new Map([[start, [start]]]), visited = new Set<string>();
  while (true) {
    const next = [...distance].filter(([id]) => !visited.has(id)).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0];
    if (!next) return [];
    const [id, cost] = next;
    if (id === end) return paths.get(id)!;
    visited.add(id);
    for (const edge of EDGES) {
      if (edge.ferry && isRaining(world)) continue;
      const to = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
      if (to && cost + edge.cost < (distance.get(to) ?? Infinity)) {
        distance.set(to, cost + edge.cost); paths.set(to, [...paths.get(id)!, to]);
      }
    }
  }
}
function nextRandom(world: WorldState) {
  let n = world.rng; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; world.rng = n >>> 0;
  return world.rng / 4294967296;
}
function job(type: Job['type'], duration: number, reason: string, extra: Partial<Job> = {}): Job {
  return { type, duration, remaining: duration, reason, ...extra };
}
function choosePlan(world: WorldState, actor: Actor): Job {
  const here = world.regions[actor.region];
  if (actor.energy < 24) return job('rest', 2, '体力不足，先歇息再行路');
  if (actor.goal !== actor.region) {
    const path = routeBetween(world, actor.region, actor.goal), to = path[1];
    if (to) {
      const edge = EDGES.find(e => e.from === actor.region && e.to === to || e.to === actor.region && e.from === to)!;
      return job('move', edge.cost, `前往${world.regions[actor.goal].name}${isRaining(world) ? '；暴雨封渡，避开水路' : '，选择最短通路'}`, { to });
    }
    // At the isolated ferry wait until it is safe; never teleport out of a closed route.
    return job('rest', 1, '渡口封闭，等待雨停');
  }
  const peer = world.actors.find(other => other.id !== actor.id && other.region === actor.region && other.job?.type !== 'move');
  if (peer && world.tick - actor.lastSocial > actor.sociability) {
    if (peer.bag.food === 0 && actor.bag.food > 1) return job('help', 1, `${peer.name}缺少干粮`, { peer: peer.id });
    if (actor.bag[actor.specialty] > 3 && (actor.relations[peer.id] ?? 0) > 0)
      return job('gift', 1, `把富余${RESOURCE_NAMES[actor.specialty]}赠给${peer.name}`, { peer: peer.id, resource: actor.specialty });
    return job('talk', 1, `与同处此地的${peer.name}相识`, { peer: peer.id });
  }
  const need: Resource = actor.bag.food < 2 ? 'food' : actor.bag.herb < 2 ? 'herb' : 'ore';
  if (actor.region === 'market' && actor.bag[need] < 2 && here.stock[need] > 0 && actor.bag[actor.specialty] > 1 && actor.specialty !== need)
    return job('trade', 1, `用${RESOURCE_NAMES[actor.specialty]}换取${RESOURCE_NAMES[need]}`, { resource: need });
  if (actor.bag.herb >= 2 && actor.bag.food >= 2 && actor.region === actor.home)
    return job('train', 3, '药粮齐备，在熟悉之地修行');
  if (actor.bag[here.resource] < 4 && here.stock[here.resource] > 0)
    return job('gather', 2, `储备${RESOURCE_NAMES[here.resource]}，每次采集一份`, { resource: here.resource });
  if (actor.bag.herb >= 2 && actor.bag.food >= 2) actor.goal = actor.home;
  else {
    const candidates = Object.values(world.regions).filter(r => r.stock[need] > 0 && r.id !== here.id)
      .map(r => ({ id: r.id, path: routeBetween(world, here.id, r.id) })).filter(r => r.path.length > 1)
      .sort((a, b) => a.path.length - b.path.length || a.id.localeCompare(b.id));
    actor.goal = candidates[0]?.id ?? actor.home;
  }
  if (actor.goal !== actor.region) return choosePlan(world, actor);
  return job('rest', 2, '附近资源暂缺，休整等待新的机会');
}

export function availableActions(state: WorldState, actorId: string) {
  const actor = state.actors.find(a => a.id === actorId);
  if (!actor) throw new Error('人物不存在');
  return legalActions(state, actor, EDGES.flatMap(e => {
    if (e.ferry && isRaining(state)) return [];
    const to = e.from === actor.region ? e.to : e.to === actor.region ? e.from : undefined;
    return to ? [{ to, cost: e.cost }] : [];
  }));
}
/** Complete plans only at the boundary after all existing actions settled. */
export function finalizePlans(result: StepResult, choices: Record<string, string> = {}): StepResult {
  const { state, events } = result;
  for (const actor of state.actors) if (!actor.job) {
    if (state.adventure?.control?.actorId === actor.id) continue;
    if (state.setting === 'sanctuary') {
      const schedule = ['farm', 'forest', 'market', 'camp', 'valley', actor.home];
      actor.goal = state.gathering?.region ?? schedule[state.tick % schedule.length];
    }
    const selected = choices[actor.id];
    const legal = selected ? availableActions(state, actor.id).find(a => a.id === selected) : undefined;
    if (selected && !legal) throw new Error('行动已失效，请重新选择');
    actor.job = legal ? { ...legal.job, reason: '自身判断：' + legal.label } : choosePlan(state, actor);
    events.push({ id: `t${state.tick}-${events.length}`, tick: state.tick, kind: 'plan', title: `${actor.name}准备${ACTION_NAMES[actor.job.type]}`,
      detail: `${actor.job.reason}；需要 ${actor.job.duration} 步`, cause: selected ? '角色自主选择 → 规则校验通过' : '当前目的地、物资、体力与同处人物共同决定', actors: [actor.id], region: actor.region, witnesses: [actor.id] });
  }
  return result;
}
export function stepWorld(input: WorldState, command?: Intervention, options: { deferPlans?: boolean } = {}): StepResult {
  assertWorld(input);
  if (input.adventure?.encounter && command?.type !== 'encounter') throw new Error('眼前的遭遇还在等你选择，世界已暂停');
  const state = structuredClone(input); state.tick++;
  if (state.gathering && state.tick > state.gathering.until) delete state.gathering;
  const events: WorldEvent[] = [];
  function emit(kind: string, title: string, detail: string, cause: string, actors: string[], region: string) {
    const witnesses = kind === 'plan' ? actors : ['weather', 'supply', 'gathering'].includes(kind) ? state.actors.map(a => a.id)
      : [...new Set([...actors, ...input.actors.filter(a => a.region === region && a.job?.type !== 'move').map(a => a.id), ...state.actors.filter(a => a.region === region && a.job?.type !== 'move').map(a => a.id)])];
    events.push({ id: `t${state.tick}-${events.length}`, tick: state.tick, kind, title, detail, cause, actors, region, witnesses });
  }
  if (command) {
    if (command.type === 'action' || command.type === 'encounter') {
      const control = state.adventure?.control;
      if (!control || control.actorId !== command.actorId || control.leaseId !== command.leaseId) throw new Error('角色控制权已变化，请重新打开行动栏');
      const actor = state.actors.find(a => a.id === control.actorId)!;
      if (command.type === 'action') {
        if (actor.job) throw new Error('请先完成当前行动');
        const action = availableActions(state, actor.id).find(a => a.id === command.actionId);
        if (!action) throw new Error('此行动已不可执行，请重新选择');
        actor.job = { ...action.job, reason: '玩家选择：' + action.label };
        emit('plan', `${actor.name}准备${ACTION_NAMES[action.job.type]}`, `${action.label}；${action.cost}`, '玩家接管 → 合法行动校验', [actor.id], actor.region);
      } else {
        const encounter = state.adventure!.encounter;
        if (!encounter || encounter.id !== command.encounterId || !['face', 'avoid'].includes(command.choice)) throw new Error('遭遇选择已失效');
        let detail = '谨慎退开，保全身上的物资。';
        if (command.choice === 'face') {
          const success = encounter.kind !== 'beast' || encounter.roll + Math.min(.5, actor.xp / 100) >= .35;
          const loss = encounter.kind === 'beast' ? encounter.danger * (success ? 1 : 2) : 5;
          state.adventure!.health[actor.id] = Math.max(1, (state.adventure!.health[actor.id] ?? 100) - loss);
          const resource = state.regions[actor.region].resource, amount = success ? Math.min(encounter.reward, state.regions[actor.region].stock[resource]) : 0;
          state.regions[actor.region].stock[resource] -= amount; actor.bag[resource] += amount;
          actor.xp += success ? 5 : 1;
          detail = `${success ? '顺利应对' : '受伤撤离'}，气血 -${loss}（最低 1），${RESOURCE_NAMES[resource]} +${amount}（来自此地存量），修为 +${success ? 5 : 1}。${state.adventure!.health[actor.id] < 20 ? '伤势较重，歇息后可继续冒险。' : ''}`;
        }
        emit('encounter', `${actor.name} · ${encounter.title}`, detail, `玩家${command.choice === 'face' ? '面对' : '退避'} → 已保存的种子判定 → 物资与气血结算`, [actor.id], actor.region);
        state.adventure!.resolved++; delete state.adventure!.encounter;
        if (state.gal?.kind === 'encounter') delete state.gal;
      }
    } else if (command.type === 'rain') {
      if (!Number.isInteger(command.duration) || command.duration < 1 || command.duration > 12) throw new Error('降雨持续范围为 1～12 步');
      state.weather.rainUntil = state.tick + command.duration - 1;
      emit('weather', '雨落灵泽，渡口封闭', `持续 ${command.duration} 步；山路仍可通行。在途渡船返回出发地。`, '玩家改变天气 → 水路关闭 → 重新寻路', [], 'ferry');
    } else if (command.type === 'supply') {
      if (!state.regions[command.region] || !RESOURCES.includes(command.resource) || !Number.isInteger(command.amount) || command.amount < 1 || command.amount > 20) throw new Error('补给地点或数量无效');
      state.regions[command.region].stock[command.resource] += command.amount;
      emit('supply', `${state.regions[command.region].name}获得补给`, `${RESOURCE_NAMES[command.resource]} +${command.amount}`, '玩家投放 → 公共资源增加（外部来源）', [], command.region);
    } else if (command.type === 'gathering') {
      if (state.setting === 'sanctuary') state.gathering = { region: command.region, until: state.tick + 11 };
      if (!state.regions[command.region]) throw new Error('聚会地点不存在');
      state.actors.forEach(actor => { actor.goal = command.region; if (actor.job?.type !== 'move') actor.job = undefined; });
      emit('gathering', `相约${state.regions[command.region].name}`, '行旅完成当前路段后向此地聚集，仍须自行走完路径。' + (state.setting === 'sanctuary' ? '接下来 12 步优先响应邀请，之后恢复日程。' : ''), '玩家邀请 → 人物目的地改变 → 同处时可以交往', [], command.region);
    } else throw new Error('未知干预');
  }
  if (input.weather.rainUntil > 0 && state.tick === input.weather.rainUntil + 1 && !isRaining(state))
    emit('weather', '雨霁，灵泽复航', '渡口重新开放，行旅可以选择水路。', '天气期限届满 → 重新评估路径', [], 'ferry');
  // Seeded order prevents stable actor-index priority when resources are scarce.
  const order = [...state.actors];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(state) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const harvested = new Map<string, string>();
  for (const actor of order) {
    const current = actor.job;
    if (!current) continue;
    const here = state.regions[actor.region];
    if (current.type === 'move' && isRaining(state) && EDGES.some(e => e.ferry && (e.from === actor.region && e.to === current.to || e.to === actor.region && e.from === current.to))) {
      actor.job = undefined;
      emit('reroute', `${actor.name}暂缓渡河`, '退回出发点，准备重新规划路线。', '暴雨封渡 → 原路不通', [actor.id], actor.region); continue;
    }
    current.remaining--;
    if (current.remaining > 0) continue;
    actor.job = undefined;
    const resource = current.resource ?? actor.specialty;
    const peer = state.actors.find(a => a.id === current.peer && a.region === actor.region && a.job?.type !== 'move');
    let detail = '', kind: string = current.type;
    switch (current.type) {
      case 'move': actor.region = current.to!; actor.energy = Math.max(0, actor.energy - 8); actor.journeys++; detail = `抵达${state.regions[actor.region].name}，体力 -8`; break;
      case 'rest':
        actor.energy = Math.min(100, actor.energy + 25); detail = '歇息恢复 25 点体力（上限 100）';
        if (state.adventure?.health[actor.id] !== undefined) { state.adventure.health[actor.id] = Math.min(100, state.adventure.health[actor.id] + 25); detail += '，气血恢复 25（上限 100）'; } break;
      case 'explore': {
        if (state.adventure?.control?.actorId !== actor.id) { detail = '放下探索，回到日常'; break; }
        actor.energy = Math.max(0, actor.energy - 10);
        const discovered = state.adventure.discovered[actor.id] ?? [];
        if (!discovered.includes(actor.region)) state.adventure.discovered[actor.id] = [...discovered, actor.region];
        const roll = nextRandom(state), kind = roll < .4 ? 'beast' : roll < .7 ? 'cache' : 'traveler';
        state.adventure.encounter = { id: `encounter:${state.tick}:${actor.id}`, region: actor.region, kind, roll,
          title: kind === 'beast' ? '林下异响' : kind === 'cache' ? '遗落的补给' : '路旁的陌生人',
          description: kind === 'beast' ? '阴影里传来低吼。向前一步，可能收获稀有物资，也可能负伤归来。' : kind === 'cache' ? '你发现一处尚未采集的资源。可以仔细搜寻，也可以留给后来的人。' : '旅人朝你招手，愿意带你寻找附近的补给。',
          danger: 10 + Math.floor(roll * 15), reward: 1 + Math.floor(roll * 3) };
        detail = `体力 -10，发现「${state.adventure.encounter.title}」，等待你的抉择。`; break;
      }
      case 'gather':
        if (here.stock[resource] > 0) {
          here.stock[resource]--; actor.bag[resource]++; actor.energy = Math.max(0, actor.energy - 6);
          harvested.set(here.id + resource, actor.id); detail = `${RESOURCE_NAMES[resource]} +1，产地剩余 ${here.stock[resource]}，体力 -6`;
        } else {
          kind = 'competition'; const winner = harvested.get(here.id + resource);
          if (winner) actor.relations[winner] = (actor.relations[winner] ?? 0) - 1;
          detail = `没有采到${RESOURCE_NAMES[resource]}${winner ? `，最后一份由${state.actors.find(a => a.id === winner)!.name}先取走，关系 -1` : '，此地产出已耗尽'}`;
        } break;
      case 'train':
        if (actor.bag.herb > 0 && actor.bag.food > 0) { actor.bag.herb--; actor.bag.food--; actor.xp += 10; actor.energy = Math.max(0, actor.energy - 12); detail = '消耗青叶、干粮各 1；修为 +10，体力 -12'; }
        else { kind = 'shortage'; detail = '药粮不足，修行取消'; } break;
      case 'trade':
        if (here.stock[resource] > 0 && actor.bag[actor.specialty] > 0 && resource !== actor.specialty) {
          here.stock[resource]--; here.stock[actor.specialty]++; actor.bag[resource]++; actor.bag[actor.specialty]--;
          detail = `${RESOURCE_NAMES[actor.specialty]} -1，${RESOURCE_NAMES[resource]} +1（与市集交换）`;
        } else { kind = 'competition'; detail = '市集存货或随身特产不足，本次交易取消，无资源扣除'; } break;
      case 'talk': case 'help': case 'gift':
        actor.lastSocial = state.tick;
        if (!peer) { kind = 'missed'; detail = '对方已经离开，未发生交往'; break; }
        if (current.type !== 'talk') {
          const gift = current.type === 'help' ? 'food' : resource;
          if (actor.bag[gift] < 1) { kind = 'shortage'; detail = '没有可转交的物资'; break; }
          actor.bag[gift]--; peer.bag[gift]++; detail = `交给${peer.name}一份${RESOURCE_NAMES[gift]}，`;
        }
        actor.relations[peer.id] = (actor.relations[peer.id] ?? 0) + (current.type === 'talk' ? 1 : 2);
        peer.relations[actor.id] = (peer.relations[actor.id] ?? 0) + (current.type === 'talk' ? 1 : 2);
        detail += `与${peer.name}关系 +${current.type === 'talk' ? 1 : 2}`; break;
    }
    emit(kind, `${actor.name} · ${ACTION_NAMES[current.type]}`, detail, current.reason, peer ? [actor.id, peer.id] : [actor.id], actor.region);
  }
  return options.deferPlans ? { state, events } : finalizePlans({ state, events });
}

/** Boundary validation for saves/worker requests; rules are versioned, never silently upgraded. */
export function assertWorld(value: unknown): asserts value is WorldState {
  const w = value as WorldState;
  if (!w || w.schema !== 1 || w.ruleset !== RULESET || !Number.isSafeInteger(w.tick) || w.tick < 0 || !Number.isInteger(w.rng) || w.rng < 0 || w.rng > 4294967295
    || !w.weather || !Number.isSafeInteger(w.weather.rainUntil) || w.weather.rainUntil < 0 || !Array.isArray(w.actors) || w.actors.length < 1 || w.actors.length > 50 || !w.regions || Object.keys(w.regions).length !== 8) throw new Error('世界存档结构或规则版本不受支持');
  const bagValid = (bag: Actor['bag']) => bag && RESOURCES.every(key => Number.isSafeInteger(bag[key]) && bag[key] >= 0);
  const textValid = (text: unknown, max = 100) => typeof text === 'string' && text.length <= max;
  for (const [id, r] of Object.entries(w.regions)) if (id !== r.id || !EDGES.some(e => e.from === id || e.to === id) || !textValid(r.name) || !textValid(r.description, 400) || !RESOURCES.includes(r.resource) || !Number.isFinite(r.x) || !Number.isFinite(r.y) || !bagValid(r.stock)) throw new Error('世界地区数据损坏');
  if (new Set(w.actors.map(a => a.id)).size !== w.actors.length) throw new Error('人物标识重复');
  for (const a of w.actors) {
    if (!/^a(?:[0-9]|[1-4][0-9])$/.test(a.id) || !textValid(a.name) || !textValid(a.role) || !/^#[a-f0-9]{6}$/i.test(a.color) || !w.regions[a.region] || !w.regions[a.goal] || !w.regions[a.home]
      || !bagValid(a.bag) || !RESOURCES.includes(a.specialty) || !Number.isFinite(a.energy) || a.energy < 0 || a.energy > 100 || !Number.isSafeInteger(a.xp) || a.xp < 0
      || !a.relations || !Object.entries(a.relations).every(([id, n]) => Number.isFinite(n) && w.actors.some(p => p.id === id)) || !Number.isSafeInteger(a.journeys) || a.journeys < 0 || !Number.isFinite(a.lastSocial) || !Number.isFinite(a.sociability)) throw new Error('世界人物数据损坏');
    if (a.job && (!Object.hasOwn(ACTION_NAMES, a.job.type) || !Number.isInteger(a.job.remaining) || a.job.remaining < 1 || a.job.remaining > a.job.duration
      || !Number.isInteger(a.job.duration) || a.job.duration > 12 || typeof a.job.reason !== 'string'
      || a.job.type === 'move' && !EDGES.some(e => e.from === a.region && e.to === a.job!.to || e.to === a.region && e.from === a.job!.to)
      || ['talk', 'help', 'gift'].includes(a.job.type) && !w.actors.some(p => p.id === a.job!.peer && p.id !== a.id)
      || ['gather', 'trade'].includes(a.job.type) && !RESOURCES.includes(a.job.resource!)
      || a.job.resource !== undefined && !RESOURCES.includes(a.job.resource))) throw new Error('世界行动数据损坏');
  }
  if (w.gathering && (w.setting !== 'sanctuary' || !Object.hasOwn(w.regions, w.gathering.region) || !Number.isSafeInteger(w.gathering.until) || w.gathering.until < w.tick)) throw new Error('召集安排无效');
  validateIntelligence(w);
  if (w.setting !== undefined && w.setting !== 'sanctuary') throw new Error('场景类型不受支持');
  validateAdventure(w);
  validateGal(w);
}
