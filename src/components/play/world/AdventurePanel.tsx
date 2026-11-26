import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { availableActions } from '@/play/world/simulation';
import { useEffect, useRef, useState } from 'react';
import { RESOURCE_NAMES, RESOURCES, type Intervention, type WorldState } from '@/play/world/schema';
export function AdventurePanel({ world, busy, act, release, theater }: { world: WorldState; busy: boolean; act: (command: Intervention) => void; release: () => void; theater?: () => void }) {
  useI18n();
  const adventure = world.adventure, control = adventure?.control;
  const previous = useRef<{ actor: string; xp: number; hp: number; food: number; herb: number; ore: number }>(), [delta, setDelta] = useState<string[]>([]);
  useEffect(() => {
    if (!control) return; const actor = world.actors.find(a => a.id === control.actorId)!;
    const next = { actor: actor.id, xp: actor.xp, hp: adventure!.health[actor.id] ?? 100, ...actor.bag }, old = previous.current;
    previous.current = next;
    if (!old || old.actor !== next.actor) { setDelta([]); return; }
    const rows = (['xp','hp','food','herb','ore'] as const).filter(k => next[k] !== old[k]).map(k => `${{ xp:tr("修为"), hp:tr("气血"), food:tr("干粮"), herb:tr("青叶"), ore:tr("灵石") }[k]} ${next[k]-old[k]>0?'+':''}${next[k]-old[k]}`);
    if (rows.length) setDelta(rows); const timer = setTimeout(() => setDelta([]), 2200); return () => clearTimeout(timer);
  }, [world, adventure, control]);
  if (!control) return null;
  const actor = world.actors.find(a => a.id === control.actorId)!, encounter = adventure!.encounter;
  const hp = adventure!.health[actor.id] ?? 100;
  return <div className="world-adventure" aria-label={tr("玩家冒险")}>
    {!!delta.length && <div className="world-deltas" role="status" key={world.tick}>{delta.map(text => <span key={text}>{text}</span>)}</div>}
    <div className="world-adventure-heading"><span className="world-eyebrow">{tr("你的旅程 · {{v0}}", { v0: world.regions[actor.region].name })}</span><h2>{actor.name}</h2><p>{tr("已探访 {{v0}} / 8 地 · 历经 {{v1}} 次遭遇", { v0: adventure!.discovered[actor.id]?.length ?? 1, v1: adventure!.resolved })}</p></div>
    <div className="world-vitals"><label>{tr("气血 ")}<strong>{hp} / 100</strong><div className="world-progress health"><span style={{ width: `${hp}%` }} /></div></label><label>{tr("体力 ")}<strong>{actor.energy} / 100</strong><div className="world-progress"><span style={{ width: `${actor.energy}%` }} /></div></label></div>
    <span className="world-level">{tr("{{v0}} · 修为 {{v1}}", { v0: actor.xp >= 100 ? tr("渐入佳境") : actor.xp >= 30 ? tr("初窥门径") : tr("初涉山海"), v1: actor.xp })}</span>
    <div className="world-bag">{RESOURCES.map(r => <div key={r}><span>{RESOURCE_NAMES[r]}</span><strong>{actor.bag[r]}</strong></div>)}</div>
    {encounter ? <section className="world-encounter"><small>{tr("遭遇 · 世界等待你的选择")}</small><h3>{encounter.title}</h3><p>{encounter.description}</p><p className="world-muted">{encounter.kind === 'beast' ? tr("气血风险 {{v0}}～{{v1}}；修为提高胜算；最多取得 {{v2}} 份当地物资。", { v0: encounter.danger, v1: encounter.danger * 2, v2: encounter.reward }) : tr("气血消耗 5；最多取得 {{v0}} 份当地物资。", { v0: encounter.reward })}</p>{theater && <button onClick={theater} disabled={busy}>{tr("进入事件剧场")}</button>}<div className="world-action-deck">{(['face', 'avoid'] as const).map(choice => <button className={choice === 'face' ? 'world-primary' : ''} key={choice} disabled={busy} onClick={() => act({ type: 'encounter', ...control, encounterId: encounter.id, choice })}>{choice === 'face' ? tr("上前应对") : tr("谨慎退避")}</button>)}</div></section>
    : actor.job ? <div className="world-effect"><h3>{tr("正在{{v0}}", { v0: actor.job.reason.replace(/^玩家选择：|^Player choice:\s*/i, '') })}</h3><p>{tr("剩余 {{v0}} 步。推进世界，让这段行程继续。", { v0: actor.job.remaining })}</p></div>
    : <><h3>{tr("此刻，你想做什么？")}</h3>{hp < 20 && <p className="world-muted">{tr("伤势较重，先歇息恢复气血。不会永久困在失败状态。")}</p>}<div className="world-action-deck">{availableActions(world, actor.id).map(action => <button key={action.id} disabled={busy} onClick={() => act({ type: 'action', ...control, actionId: action.id })}><strong>{action.label}</strong><small>{action.cost}</small></button>)}</div></>}
    <button className="world-release" disabled={busy} onClick={release}>{encounter ? tr("回到观赏 · 放下当前遭遇") : tr("回到观赏")}</button>
  </div>;
}
