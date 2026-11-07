import { availableActions } from '@/play/world/simulation';
import { useEffect, useRef, useState } from 'react';
import { RESOURCE_NAMES, RESOURCES, type Intervention, type WorldState } from '@/play/world/schema';
export function AdventurePanel({ world, busy, act, release, theater }: { world: WorldState; busy: boolean; act: (command: Intervention) => void; release: () => void; theater?: () => void }) {
  const adventure = world.adventure, control = adventure?.control;
  const previous = useRef<{ actor: string; xp: number; hp: number; food: number; herb: number; ore: number }>(), [delta, setDelta] = useState<string[]>([]);
  useEffect(() => {
    if (!control) return; const actor = world.actors.find(a => a.id === control.actorId)!;
    const next = { actor: actor.id, xp: actor.xp, hp: adventure!.health[actor.id] ?? 100, ...actor.bag }, old = previous.current;
    previous.current = next;
    if (!old || old.actor !== next.actor) { setDelta([]); return; }
    const rows = (['xp','hp','food','herb','ore'] as const).filter(k => next[k] !== old[k]).map(k => `${{ xp:'修为', hp:'气血', food:'干粮', herb:'青叶', ore:'灵石' }[k]} ${next[k]-old[k]>0?'+':''}${next[k]-old[k]}`);
    if (rows.length) setDelta(rows); const timer = setTimeout(() => setDelta([]), 2200); return () => clearTimeout(timer);
  }, [world, adventure, control]);
  if (!control) return null;
  const actor = world.actors.find(a => a.id === control.actorId)!, encounter = adventure!.encounter;
  const hp = adventure!.health[actor.id] ?? 100;
  return <div className="world-adventure" aria-label="玩家冒险">
    {!!delta.length && <div className="world-deltas" role="status" key={world.tick}>{delta.map(text => <span key={text}>{text}</span>)}</div>}
    <div className="world-adventure-heading"><span className="world-eyebrow">你的旅程 · {world.regions[actor.region].name}</span><h2>{actor.name}</h2><p>已探访 {adventure!.discovered[actor.id]?.length ?? 1} / 8 地 · 历经 {adventure!.resolved} 次遭遇</p></div>
    <div className="world-vitals"><label>气血 <strong>{hp} / 100</strong><div className="world-progress health"><span style={{ width: `${hp}%` }} /></div></label><label>体力 <strong>{actor.energy} / 100</strong><div className="world-progress"><span style={{ width: `${actor.energy}%` }} /></div></label></div>
    <span className="world-level">{actor.xp >= 100 ? '渐入佳境' : actor.xp >= 30 ? '初窥门径' : '初涉山海'} · 修为 {actor.xp}</span>
    <div className="world-bag">{RESOURCES.map(r => <div key={r}><span>{RESOURCE_NAMES[r]}</span><strong>{actor.bag[r]}</strong></div>)}</div>
    {encounter ? <section className="world-encounter"><small>遭遇 · 世界等待你的选择</small><h3>{encounter.title}</h3><p>{encounter.description}</p><p className="world-muted">{encounter.kind === 'beast' ? `气血风险 ${encounter.danger}～${encounter.danger * 2}；修为提高胜算` : '气血消耗 5'}；最多取得 {encounter.reward} 份当地物资。</p>{theater && <button onClick={theater} disabled={busy}>进入事件剧场</button>}<div className="world-action-deck">{(['face', 'avoid'] as const).map(choice => <button className={choice === 'face' ? 'world-primary' : ''} key={choice} disabled={busy} onClick={() => act({ type: 'encounter', ...control, encounterId: encounter.id, choice })}>{choice === 'face' ? '上前应对' : '谨慎退避'}</button>)}</div></section>
    : actor.job ? <div className="world-effect"><h3>正在{actor.job.reason.replace('玩家选择：', '')}</h3><p>剩余 {actor.job.remaining} 步。推进世界，让这段行程继续。</p></div>
    : <><h3>此刻，你想做什么？</h3>{hp < 20 && <p className="world-muted">伤势较重，先歇息恢复气血。不会永久困在失败状态。</p>}<div className="world-action-deck">{availableActions(world, actor.id).map(action => <button key={action.id} disabled={busy} onClick={() => act({ type: 'action', ...control, actionId: action.id })}><strong>{action.label}</strong><small>{action.cost}</small></button>)}</div></>}
    <button className="world-release" disabled={busy} onClick={release}>回到观赏{encounter ? ' · 放下当前遭遇' : ''}</button>
  </div>;
}
