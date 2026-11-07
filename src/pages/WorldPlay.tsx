import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, CloudRain, Download, Flag, History, MoreHorizontal, Pause, Play, Plus, SkipForward, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CreateVisualStory } from '@/components/play/gal/CreateVisualStory';
import { encounterTheater } from '@/play/gal/scene';
import { AdventurePanel } from '@/components/play/world/AdventurePanel';
import { SummonPanel } from '@/components/play/world/SummonPanel';
import { takeControl, releaseControl } from '@/play/adventure/control';
import { createSanctuary } from '@/play/sanctuary/summon';
import { WorldMemoryConsole } from '@/components/play/world/WorldMemoryConsole';
import { WorldIntelligencePanel } from '@/components/play/world/WorldIntelligencePanel';
import type { WorldState, WorldEvent } from '@/play/world/schema';
import { WorldCanvas } from '@/components/play/world/WorldCanvas';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { isTauri } from '@/lib/runtime';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import '@/components/play/world/world.css';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { currentWorldRepo, toWorldIndex, type WorldIndexEntry, type WorldSummary } from '@/play/storage/world-repo';
import type { WorldCommit } from '@/play/storage/world-commit';
import { ACTION_NAMES, RESOURCE_NAMES, RESOURCES, type Intervention, type Resource } from '@/play/world/schema';
import { createWorld } from '@/play/world/simulation';
import { WorldSession } from '@/play/world/session';
import { usePlayLifecycle } from '@/play/use-play-lifecycle';
import { nearbyActorIds } from '@/play/adventure/perspective';
import { eventVisible } from '@/play/memory/console';

const reasonText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const dateLabel = (tick: number) => `第 ${Math.floor(tick / 6) + 1} 日 · ${['晨', '午', '未', '暮', '夜', '子'][tick % 6]}时`;
type Sheet = 'create' | 'intervene' | 'actor' | 'region' | 'history' | 'menu' | 'delete' | 'memory' | 'intelligence' | 'summon' | 'visual' | null;

export default function WorldPlay() {
  const { id } = useParams(), epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch);
  return <WorldView key={`${id ?? 'lobby'}:${epoch}`} id={id} />;
}

function WorldView({ id }: { id?: string }) {
  const navigate = useNavigate(), repo = useMemo(() => currentWorldRepo(), []);
  const [list, setList] = useState<WorldSummary[]>([]), [history, setHistory] = useState<WorldIndexEntry[]>([]);
  const [current, setCurrent] = useState<WorldCommit>(), [replayCommit, setReplayCommit] = useState<WorldCommit>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [warning, setWarning] = useState('');
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [autoLeft, setAutoLeft] = useState(0);
  const [sheet, setSheet] = useState<Sheet>(null), [selected, setSelected] = useState('a0'), [region, setRegion] = useState('camp');
  const [focusRegion, setFocusRegion] = useState<string>(), [expanded, setExpanded] = useState(false), [tab, setTab] = useState<'events' | 'actors' | 'adventure'>('events');
  const [showPlans, setShowPlans] = useState(false), [onlySelected, setOnlySelected] = useState(false), [archived, setArchived] = useState(false);
  const [replay, setReplay] = useState<number | null>(null), [historyValue, setHistoryValue] = useState(0);
  const [worldKind, setWorldKind] = useState<'world' | 'sanctuary'>('world');
  const [capture, setCapture] = useState<WorldEvent>();
  const [title, setTitle] = useState('山海之间'), [seed, setSeed] = useState('73');
  const [intervention, setIntervention] = useState<'rain' | 'supply' | 'gathering'>('rain'), [resource, setResource] = useState<Resource>('herb');
  const session = useRef<WorldSession>(), alive = useRef(true), locked = useRef(false), auto = useRef(0), input = useRef<HTMLInputElement>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const viewed = replay === null ? current : replayCommit, state = viewed?.state;
  const playerId = current?.state.adventure?.control?.actorId;
  const actor = state?.actors.find(a => a.id === (playerId ?? selected)) ?? state?.actors[0];
  const visiblePeople = state ? nearbyActorIds(state, playerId) : [];
  const readOnly = replay !== null || !!warning || !!current?.deleted;
  const stop = useCallback(() => { auto.current = 0; setAutoLeft(0); session.current?.stop(); }, []);
  usePlayLifecycle(stop);
  const blocker = useBlocker(busy);
  useEffect(() => {
    if (blocker.state === 'blocked') { stop(); if (!busy) blocker.proceed(); }
  }, [blocker, busy, stop]);
  useEffect(() => {
    alive.current = true;
    async function load() {
      try {
        if (id) {
          const result = await repo.open(id);
          if (!alive.current) return;
          setHistory(result.index); setCurrent(result.latest); setWarning(result.warnings.join('；'));
          const latest = result.latest;
          if (latest?.state.gal?.kind === 'story' && !latest.deleted && !result.warnings.length) { navigate('/gal/' + id, { replace: true }); return; }
          if (!latest) throw new Error('没有找到完整世界存档。可返回世界列表或导入备份。');
          if (latest.state.adventure?.control) {
            setSelected(latest.state.adventure.control.actorId); setTab('adventure'); setExpanded(true);
          }
          session.current = new WorldSession(repo, latest, undefined, {}, accept);
        } else {
          const rows = await repo.listSummaries(); if (alive.current) setList(rows);
        }
      } catch (reason) { if (alive.current) setError(reasonText(reason)); }
      finally { if (alive.current) setLoading(false); }
    }
    void load();
    const hide = () => { if (document.hidden) stop(); };
    const unload = (event: BeforeUnloadEvent) => { if (locked.current) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', hide); window.addEventListener('beforeunload', unload);
    return () => { alive.current = false; auto.current = 0; session.current?.stop(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', unload); };
  }, [id, repo, stop, navigate]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false, allowClose = false, unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const remove = await window.onCloseRequested(event => {
        if (allowClose) return;
        event.preventDefault(); stop();
        void pending.current.then(() => { allowClose = true; return window.close(); });
      });
      if (disposed) remove(); else unlisten = remove;
    });
    return () => { disposed = true; unlisten?.(); };
  }, [stop]);
  async function operation(action: () => Promise<void>) {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError('');
    let settled!: () => void;
    pending.current = new Promise(resolve => { settled = resolve; });
    try { await action(); return true; }
    catch (reason) { if (alive.current && !(reason instanceof DOMException && reason.name === 'AbortError')) { setError(reasonText(reason)); stop(); } return false; }
    finally { locked.current = false; settled(); if (alive.current) setBusy(false); }
  }
  function accept(commit: WorldCommit) {
    if (!alive.current) return;
    setCurrent(commit);
    setHistory(rows => {
      if (rows.at(-1)?.id === commit.id) return rows;
      const next = [...rows, toWorldIndex(commit)]; let count = 0;
      for (let i = next.length-1; i >= 0; i--) { count += next[i].events.length; if (count > 10000) next[i] = { ...next[i], events: [] }; }
      return next;
    });
    if (session.current) session.current.current = commit;
  }
  async function openReplay(index: number) {
    const row = history[index]; if (!id || !row) return;
    await operation(async () => { const commit = await repo.readVersion(id, row.revision, row.hash); if (alive.current) { setReplayCommit(commit); setReplay(index); setSheet(null); } });
  }
  async function configure(next: WorldState) {
    if (!session.current || readOnly) return false;
    return operation(async () => { accept(await repo.append(session.current!.current, { state: next, events: [] }, 'configure')); });
  }
  async function advance(command?: Intervention) {
    if (!session.current || readOnly) return;
    await operation(async () => {
      const saved = await session.current!.step(command); accept(saved);
      if (saved.state.adventure?.encounter) stop();
      if (alive.current && auto.current > 0) { auto.current--; setAutoLeft(auto.current); }
    });
  }
  const advanceRef = useRef(advance); advanceRef.current = advance;
  useEffect(() => {
    if (!autoLeft || busy || readOnly) return;
    const timer = setTimeout(() => { if (auto.current && !document.hidden) void advanceRef.current(); }, 1000);
    return () => clearTimeout(timer);
  }, [autoLeft, busy, readOnly]);
  function selectActor(actorId: string) { if (playerId && actorId !== playerId) { setNotice('冒险中跟随你接管的人物；切回世界观赏可追踪其他人。'); return; } setSelected(actorId); setFocusRegion(undefined); setExpanded(false); }
  function openSheet(next: Sheet) { stop(); setSheet(next); if (next === 'history') setHistoryValue(replay ?? history.length - 1); }
  const allEvents = history.slice(0, (replay ?? history.length - 1) + 1).flatMap(c => c.events);
  const events = allEvents.filter(e => !playerId || eventVisible(e, { kind: 'actor', actorId: playerId }))
    .filter(e => (showPlans || e.kind !== 'plan') && (!onlySelected || e.actors.includes(actor?.id ?? selected))).slice(-100).reverse();
  async function fork() {
    if (!viewed) return;
    await operation(async () => { const copy = await repo.fork(viewed, `${viewed.title.slice(0, 60)} · 第${viewed.state.tick}步支线`); if (alive.current) navigate('/worlds/' + copy.worldId); });
  }
  async function exportWorld(scope: 'full' | 'public' = 'full') {
    if (!id) return;
    await operation(async () => {
      const text = await repo.exportPackage(id, scope); if (!alive.current) return;
      const result = await saveTextFile({ fileName: `山海世界-${scope}-${id.slice(0, 8)}.ste-world`, text, label: scope === 'full' ? '完整世界备份' : '公开世界快照', extension: 'ste-world' });
      if (!alive.current) return;
      setNotice(result === 'cancelled' ? '已取消导出。' : '世界备份已导出，可在世界列表中导入。'); setSheet(null);
    });
  }
  async function importWorld(file?: File) {
    if (!file) return;
    await operation(async () => {
      if (file.size > 32 * 1024 * 1024) throw new Error('世界备份不能超过 32 MB');
      const restored = await repo.importPackage(await file.text()); if (alive.current) navigate((restored.state.gal ? '/gal/' : '/worlds/') + restored.worldId);
    });
  }
  const inventory = actor && <div className="world-inventory">{RESOURCES.map(key => <span key={key}>{RESOURCE_NAMES[key]} <strong>{actor.bag[key]}</strong></span>)}</div>;
  return <>{isTauri() && <ClientTitleBar titleBarContent="山海之间" />}<div className="world-app" style={isTauri() ? { height: 'calc(100dvh - 44px)' } : undefined}>
    <header className="world-header">
      <button className="world-quiet" aria-label={id ? '返回世界列表' : '返回聊天'} onClick={() => { stop(); navigate(id ? '/worlds' : '/play'); }}><ArrowLeft size={20} /></button>
      <div className="world-brand"><h1>{current?.title ?? '山海之间'}</h1><span className="world-eyebrow">一方天地，十二段人生</span></div>
      {state && <><div className="world-mode-pill" aria-label="游玩方式"><button aria-label="世界观赏" aria-pressed={!state.adventure?.control} disabled={busy || readOnly} onClick={() => { stop(); void configure(releaseControl(state)).then(ok => { if (ok) setTab('events'); }); }}>◎</button><button aria-label="接管追踪人物冒险" aria-pressed={!!state.adventure?.control} disabled={busy || readOnly} onClick={() => { stop(); if (state.adventure?.control) { setSelected(state.adventure.control.actorId); setTab('adventure'); setExpanded(true); } else void configure(takeControl(state, actor!.id)).then(ok => { if (ok) { setTab('adventure'); setExpanded(true); } }); }}>⚔</button></div><div className="world-time"><strong>{dateLabel(state.tick)}</strong><small data-testid="world-tick">第 {state.tick} 步<span className="world-engine-label"> · {state.intelligence?.settings.mode === 'ai' ? '人物智能' : '规则演进'}</span></small></div><span className="world-status" role="status">{busy ? '推演中…' : '已保存'}</span><button aria-label="世界存档与回放" disabled={busy} onClick={() => openSheet('menu')}><MoreHorizontal size={22} /></button></>}
    </header>
    {error && <div className="world-error" role="alert"><span>{error}</span><button onClick={() => { stop(); navigate(id ? '/worlds' : '/play'); }}>返回列表</button>{id && <button onClick={() => { stop(); navigate('/worlds/' + id, { replace: true }); window.location.reload(); }}>重新读取</button>}</div>}
    {warning && <div className="world-error" role="alert">{warning}<button disabled={busy} onClick={() => void fork()}>从完整版本另存分支</button></div>}
    {notice && <div className="world-notice" role="status">{notice}</div>}
    {replay !== null && <div className="world-replay"><span>回看第 {state?.tick} 步 · 世界已暂停</span><button disabled={busy} onClick={() => void fork()}>从这里分支</button><button onClick={() => setReplay(null)}>返回现在</button></div>}
    {loading ? <div className="world-loading" role="status">正在展开山海图卷…</div> : !id ? <main className="world-lobby"><div className="world-lobby-inner">
      <section className="world-lobby-hero"><span className="world-eyebrow">一方世界 · 一座休息室</span><h2>让世界，自己生长。</h2><p>十二位行旅从八片地域出发。采药、修行、互通有无，也会争抢最后一份物资。跟随一个人，或落下一场雨，看看命运会在哪里转弯。</p><div className="world-lobby-actions"><button className="world-primary" disabled={busy} onClick={() => { setWorldKind('world'); openSheet('create'); }}><Plus size={18} />开辟新世界</button><button disabled={busy} onClick={() => { setWorldKind('sanctuary'); setTitle('星门休息室'); openSheet('create'); }}>✧ 主神空间</button><button disabled={busy} onClick={() => openSheet('visual')}>▷ 视觉故事</button><button disabled={busy} onClick={() => input.current?.click()}><Upload size={17} />导入世界备份</button><input ref={input} type="file" accept=".json,.ste-world" aria-label="导入世界备份文件" onChange={e => { void importWorld(e.target.files?.[0]); e.target.value = ''; }} /></div></section>
      <div className="world-list-head"><h2>{archived ? '已收起的世界' : '我的世界'}</h2><button aria-pressed={archived} onClick={() => setArchived(v => !v)}>{archived ? '查看进行中' : '回收站'}</button></div>
      <div className="world-save-grid">{list.filter(row => row.deleted === archived).map(row => <article className="world-save-card" key={row.worldId}><span className="world-eyebrow">{row.visualStory ? '视觉故事 · 剧场' : row.setting === 'sanctuary' ? '主神空间 · 跨世界会客' : row.origin ? '故事支线' : '山海原界'}</span><h3>{row.title}</h3><p>{dateLabel(row.tick)} · 第 {row.tick} 步<br />{new Date(row.updatedAt).toLocaleString('zh-CN')}</p><button disabled={busy} onClick={() => {
        if (!row.deleted) navigate((row.theater ? '/gal/' : '/worlds/') + row.worldId);
        else void operation(async () => { const stored = (await repo.open(row.worldId)).latest; if (stored) await repo.archive(stored, false); if (alive.current) setList(await repo.listSummaries()); });
      }}>{row.deleted ? '恢复世界' : '进入世界'}</button></article>)}</div>
      {!list.some(row => row.deleted === archived) && <div className="world-empty">{archived ? '没有已收起的世界。' : '山海尚未启程。开辟一个世界，从林照晚的行路开始观察。'}</div>}
    </div></main> : state && actor ? <main className="world-layout">
      <section className="world-stage" aria-label="世界地图与运行控制">
        <WorldCanvas state={state} selected={actor.id} visiblePeople={visiblePeople} playerId={playerId} focusRegion={focusRegion} onSelect={selectActor} onRegion={regionId => { if (playerId && (regionId !== actor.region || actor.job?.type === 'move')) { setNotice('远方只显示地形；抵达当地后才可查看实时人物与物资。'); return; } setRegion(regionId); setFocusRegion(regionId); openSheet('region'); }} />
        <article className="world-actor-card" aria-label="追踪人物摘要"><div className="world-eyebrow">正在追踪 · {actor.role}</div><div className="world-actor-meta"><div><h3>{actor.name}</h3><p>{state.regions[actor.region].name} · {actor.job ? `${ACTION_NAMES[actor.job.type]}，剩余 ${actor.job.remaining} 步` : '准备启程'}</p></div><button className="world-mobile-toggle" onClick={() => openSheet('actor')}>详情</button></div>
          <div className="world-extra"><p>{actor.job?.reason ?? `将前往${state.regions[actor.goal].name}，准备药粮与修行。`}</p><div className="world-progress" aria-label={`体力 ${actor.energy}`}><span style={{ width: `${actor.energy}%` }} /></div>{inventory}<button onClick={() => openSheet('actor')}>查看经历与关系</button></div>
        </article>
        <span className="world-map-hint">拖动地图 · 点击人物 · 事件可定位</span>
        <nav className="world-controls" aria-label="世界运行控制">
          <button className="world-primary" disabled={busy || readOnly || autoLeft > 0 || !!state.adventure?.encounter} onClick={() => void advance()}><SkipForward size={17} />推进一步</button>
          <button disabled={readOnly || !!state.adventure?.encounter} onClick={() => { if (autoLeft || busy) stop(); else { auto.current = 5; setAutoLeft(5); } }}>{autoLeft || busy ? <Pause size={17} /> : <Play size={17} />}{busy ? '停止' : autoLeft ? `暂停 · ${autoLeft}` : '推演 5 步'}</button>
          <button disabled={busy || readOnly} onClick={() => openSheet('intervene')}><Sparkles size={17} />干预</button>
        </nav>
      </section>
      <aside className={'world-sidebar' + (expanded ? ' expanded' : '')} aria-label="世界事件与人物"><div className="world-side-head"><h2>世间回响</h2><button aria-label="打开记忆中枢" disabled={busy} onClick={() => { setCapture(undefined); openSheet('memory'); }}>记忆</button><button className="world-mobile-toggle" aria-label={expanded ? '收起事件' : '展开事件'} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}{expanded ? '收起' : '事件'}</button></div>
        <div className="world-side-tabs">{state.adventure?.control && <button aria-pressed={tab === 'adventure'} onClick={() => setTab('adventure')}>冒险</button>}<button aria-pressed={tab === 'events'} onClick={() => setTab('events')}>事件</button><button aria-pressed={tab === 'actors'} onClick={() => setTab('actors')}>行旅 · {visiblePeople.length}</button></div>
        {tab === 'adventure' && state.adventure?.control ? <div className="world-feed"><AdventurePanel world={state} busy={busy || readOnly} act={command => void advance(command)} theater={() => { stop(); void configure(encounterTheater(state)).then(ok => { if (ok) navigate('/gal/' + id); }); }} release={() => { stop(); void configure(releaseControl(state)).then(ok => { if (ok) setTab('events'); }); }} /></div> : tab === 'events' ? <><div className="world-side-tabs"><button aria-pressed={onlySelected} onClick={() => setOnlySelected(v => !v)}>{onlySelected ? actor.name : '所有人物'}</button><button aria-pressed={showPlans} onClick={() => setShowPlans(v => !v)}>{showPlans ? '含行动计划' : '仅看结果'}</button></div><div className="world-feed">
          {!playerId && state.intelligence?.narratives.slice(-1).map(n => <article className="world-narrative" key={n.tick}><small>第 {n.tick} 步 · 世间旁白</small><p>{n.text}</p></article>)}
          {events.length ? events.map(event => <article className="world-event" data-kind={event.kind} key={event.id}><time>第 {event.tick} 步 · {state.regions[event.region].name}</time><h3>{event.title}</h3><p>{event.detail}</p><p className="world-cause">{event.cause}</p><button onClick={() => { if (event.actors[0]) selectActor(event.actors[0]); else { setFocusRegion(event.region); setExpanded(false); } }}>在地图上定位 ↗</button><button disabled={busy || readOnly} onClick={() => { setCapture(event); openSheet('memory'); }}>记住一件事</button></article>) : <div className="world-muted">{state.tick === 0 ? '世界尚在晨光中。推进一步，行旅将按各自需要选择行动；再次推进后，行动会逐步完成。' : '当前筛选下还没有结果。可开启“行动计划”，查看正在发生的事。'}</div>}
        </div></> : <div className="world-feed world-people">{state.actors.filter(person => visiblePeople.includes(person.id)).map(person => <button key={person.id} onClick={() => selectActor(person.id)}><span className="world-avatar" style={{ background: person.color }}>{person.name[0]}</span><span>{person.name}<small>{state.regions[person.region].name} · {person.job ? ACTION_NAMES[person.job.type] : '准备启程'}</small></span></button>)}</div>}
        <div className="world-side-footer">每步一时辰 · 自动推演至多 5 步<br />{state.intelligence?.settings.mode === 'ai' ? '每步至多四人思考，其余依规则生活；结果自动保存。' : '行动由规则结算，世界每步自动保存。'}</div>
      </aside>
    </main> : null}
    <Dialog open={sheet !== null} onOpenChange={open => { if (!open && !busy) setSheet(null); }}><DialogContent className="world-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      {error && <p role="alert" className="world-error">{error}</p>}<DialogHeader><DialogTitle>{{ create: '开辟一方天地', intervene: '一念之间', actor: actor?.name ?? '人物', region: state?.regions[region]?.name ?? '地区', history: '回看走过的路', menu: '世界行囊', delete: '收起这个世界', memory: '记忆中枢', intelligence: '让人物有自己的心事', summon: '邀请异世界的朋友', visual: '一张卡，一场新故事' }[sheet ?? 'menu']}</DialogTitle>
        <DialogDescription>{sheet === 'create' ? worldKind === 'sanctuary' ? '为来自不同世界的朋友留一盏灯。创建后可从世界行囊中召唤角色。' : '八片地域、十二位行旅。世界创建后暂停，等你落下第一步。' : sheet === 'intervene' ? '选择一个会改变规则的事件，确认后立即推进一步。' : sheet === 'history' ? '回看只读取已保存结果。从某一步另存分支，可以比较另一种走向。' : sheet === 'delete' ? '世界将移入回收站，可随时恢复；完整历史仍会保留。' : sheet === 'actor' ? `${actor?.role} · 目标：${state?.regions[actor?.goal ?? '']?.name ?? ''}` : sheet === 'region' ? state?.regions[region]?.description : '世界已逐步保存。可以留下路标、回看历史或带走备份。'}</DialogDescription></DialogHeader>
      {sheet === 'create' && <form onSubmit={event => { event.preventDefault(); void operation(async () => {
        const number = Number(seed); if (!Number.isInteger(number) || number < 1 || number > 4294967295) throw new Error('世界种子需为 1～4294967295 的整数');
        const created = await repo.create(title, worldKind === 'sanctuary' ? createSanctuary(number) : createWorld(number)); if (alive.current) navigate('/worlds/' + created.worldId);
      }); }}><label>世界名<input autoFocus maxLength={80} value={title} onChange={e => setTitle(e.target.value)} /></label><details className="mt-4"><summary>世界种子</summary><label>相同种子与干预会得到相同结果<input type="number" min="1" max="4294967295" value={seed} onChange={e => setSeed(e.target.value)} /></label></details><div className="world-effect">试试看：先记录晴天的行路，再从第一步之前分支，降下一场雨，比较林照晚怎样去往望川集。</div><div className="world-actions"><button type="submit" className="world-primary" disabled={busy}>{busy ? '正在开辟…' : '启程'}</button></div></form>}
      {sheet === 'intervene' && state && <><label>改变什么<select value={intervention} onChange={e => setIntervention(e.target.value as typeof intervention)}><option value="rain">灵泽降雨</option><option value="supply">投放补给</option><option value="gathering">召集行旅</option></select></label>
        {intervention !== 'rain' && <label>发生地点<select value={region} onChange={e => setRegion(e.target.value)}>{Object.values(state.regions).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        {intervention === 'supply' && <label>补给物资<select value={resource} onChange={e => setResource(e.target.value as Resource)}>{RESOURCES.map(r => <option key={r} value={r}>{RESOURCE_NAMES[r]} × 6</option>)}</select></label>}
        <div className="world-effect">{intervention === 'rain' ? '暴雨持续 4 步 → 渡口关闭 → 在途渡船退回，行旅改走山路或原地等候。' : intervention === 'supply' ? `向${state.regions[region].name}补充 6 份${RESOURCE_NAMES[resource]}。缺少物资的人会重新寻找补给点。` : `邀请十二位行旅前往${state.regions[region].name}。他们仍需走完路程，在同处一地后交谈、赠予或互助。`}</div>
        <div className="world-actions"><button disabled={busy} onClick={() => setSheet(null)}>再想想</button><button className="world-primary" disabled={busy || readOnly} onClick={() => {
          const command: Intervention = intervention === 'rain' ? { type: 'rain', duration: 4 } : intervention === 'supply' ? { type: 'supply', region, resource, amount: 6 } : { type: 'gathering', region };
          setSheet(null); void advance(command);
        }}><CloudRain size={17} />确认并推进</button></div></>}
      {sheet === 'actor' && actor && state && <><div className="world-effect">{actor.job?.reason ?? '正在准备下一段行程'}<br />{actor.job ? `${ACTION_NAMES[actor.job.type]} · 剩余 ${actor.job.remaining} / ${actor.job.duration} 步` : '尚未行动'}</div><p>体力 {actor.energy} / 100 · 修为 {actor.xp} · 行路 {actor.journeys} 段</p>{inventory}<h3>在意的人</h3><ul className="world-relations">{Object.entries(actor.relations).length ? Object.entries(actor.relations).sort((a, b) => b[1] - a[1]).map(([peer, value]) => <li key={peer}><span>{state.actors.find(a => a.id === peer)?.name}</span><span>{value > 0 ? '相知' : value < 0 ? '芥蒂' : '初识'} {value}</span></li>) : <li>尚未建立关系，同行与争夺会留下痕迹。</li>}</ul><div className="world-actions"><button onClick={() => { setOnlySelected(true); setTab('events'); setExpanded(true); setSheet(null); }}>查看此人的事件</button></div></>}
      {sheet === 'region' && state && <><div className="world-effect">{RESOURCES.map(r => <div key={r}>{RESOURCE_NAMES[r]} · 公共存量 {state.regions[region].stock[r]}</div>)}</div><p>此地行旅：{state.actors.filter(a => a.region === region).map(a => a.name).join('、') || '暂无'}</p><div className="world-actions"><button disabled={readOnly} onClick={() => { setIntervention('supply'); setSheet('intervene'); }}>在此投放补给</button><button disabled={readOnly} onClick={() => { setIntervention('gathering'); setSheet('intervene'); }}><Users size={16} />召集行旅</button></div></>}
      {sheet === 'history' && history[historyValue] && <><label>第 {history[historyValue].tick} 步 · {history[historyValue].kind === 'checkpoint' ? '路标' : '自动存档'}<input aria-label="选择回放版本" type="range" min="0" max={history.length - 1} value={historyValue} onChange={e => setHistoryValue(Number(e.target.value))} /></label><div className="world-effect">{dateLabel(history[historyValue].tick)}<br />{history[historyValue].events.filter(e => e.kind !== 'plan' && (!playerId || eventVisible(e, { kind: 'actor', actorId: playerId }))).slice(0, 3).map(e => <div key={e.id}>{e.title} · {e.detail}</div>)}</div><div className="world-actions"><button onClick={() => setHistoryValue(v => Math.max(0, v - 1))} disabled={historyValue === 0}>前一版</button><button onClick={() => setHistoryValue(v => Math.min(history.length - 1, v + 1))} disabled={historyValue === history.length - 1}>后一版</button><button className="world-primary" disabled={busy} onClick={() => void openReplay(historyValue)}>查看此刻地图</button></div></>}
      {sheet === 'memory' && state && actor && <WorldMemoryConsole world={state} events={allEvents} selected={actor.id} initialActorId={playerId} busy={busy || readOnly} save={configure} capture={capture} jump={event => { const index = history.findIndex(c => c.events.some(e => e.id === event.id)); if (index >= 0) { setFocusRegion(event.region); void openReplay(index); } }} sourceJump={source => { stop(); navigate('/story/' + source.storyId, { state: { view: 'read', branchId: source.branchId ?? null, sourceFloor: source.floor } }); }} />}
      {sheet === 'visual' && <CreateVisualStory busy={busy} create={async (name, world) => { await operation(async () => { const c = await repo.create(name, world); if (alive.current) navigate('/gal/' + c.worldId); }); }} />}
      {sheet === 'summon' && state && <SummonPanel world={state} busy={busy || readOnly} save={configure} />}
      {sheet === 'intelligence' && state && <WorldIntelligencePanel world={state} busy={busy || readOnly} save={configure} traces={session.current?.traces ?? []} />}
      {sheet === 'menu' && current && <div className="world-menu">{state?.setting === 'sanctuary' && <button disabled={busy || readOnly} onClick={() => openSheet('summon')}><Users size={18} />召唤与来客档案</button>}<button disabled={busy || readOnly} onClick={() => openSheet('intelligence')}><Sparkles size={18} />{playerId ? '导演管理：人物智能与额度' : '人物智能与额度'}</button><button onClick={() => { setCapture(undefined); openSheet('memory'); }}>记忆中枢</button><button disabled={busy || readOnly} onClick={() => void operation(async () => { const saved = await repo.checkpoint(current); accept(saved); setNotice(`已留下第 ${saved.state.tick} 步路标，可在回放中找到。`); setSheet(null); })}><Flag size={18} />在这里留下路标</button><button onClick={() => openSheet('history')}><History size={18} />回看世界</button><button disabled={busy} onClick={() => void fork()}><Plus size={18} />从此刻另存分支</button><button disabled={busy} onClick={() => void exportWorld()}><Download size={18} />导出世界备份</button><p className="world-muted">完整包包含私密记忆、人物设定与剧场素材，请妥善保管。</p><button disabled={busy} onClick={() => void exportWorld('public')}>分享公开沙盘快照</button><p className="world-muted">公开快照仅保留当前规则世界与公开事实，不含私密记忆、历史、剧场及调用记录。</p><button className="world-danger" disabled={busy} onClick={() => setSheet('delete')}><Trash2 size={18} />移入回收站</button></div>}
      {sheet === 'delete' && current && <div className="world-actions"><button onClick={() => setSheet(null)}>保留</button><button className="world-danger" disabled={busy} onClick={() => void operation(async () => { await repo.archive(current, true); if (alive.current) navigate('/worlds'); })}>移入回收站</button></div>}
    </DialogContent></Dialog>
  </div></>;
}
