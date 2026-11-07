import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, MoreHorizontal, Pause, Settings2, ImagePlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { WorldIntelligencePanel } from '@/components/play/world/WorldIntelligencePanel';
import { GalStage } from '@/components/play/gal/GalStage';
import { StageMedia } from '@/components/play/gal/StageMedia';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { isTauri } from '@/lib/runtime';
import { currentWorldRepo } from '@/play/storage/world-repo';
import type { WorldCommit } from '@/play/storage/world-commit';
import { currentMediaRepo } from '@/play/media/media-repo';
import { StageMediaPool } from '@/play/media/pool';
import { importStageImage } from '@/play/media/asset';
import { currentScene, advanceBeat, stageChoice, acceptScene } from '@/play/gal/scene';
import type { WorldTrace } from '@/play/agents/model-gateway';
import { intelligence, withIntelligence } from '@/play/agents/state';
import { WorldSession } from '@/play/world/session';
import { usePlayLifecycle } from '@/play/use-play-lifecycle';
import type { WorldState } from '@/play/world/schema';
import '@/components/play/world/world.css';
import '@/components/play/gal/gal.css';

export default function GalPlay() {
  const { id } = useParams(), epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch);
  return <StageSession key={`${id}:${epoch}`} id={id!} />;
}
function StageSession({ id }: { id: string }) {
  const navigate = useNavigate(), repo = useMemo(currentWorldRepo, []), media = useMemo(currentMediaRepo, []), pool = useMemo(() => new StageMediaPool(), []);
  const [current, setCurrent] = useState<WorldCommit>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [traces, setTraces] = useState<WorldTrace[]>([]);
  const [sheet, setSheet] = useState<'history' | 'settings' | 'menu' | 'media' | null>(null), [assetKind, setAssetKind] = useState<'backgroundAsset' | 'portraitAsset'>('backgroundAsset');
  const [viewport, setViewport] = useState<{ height: number; top: number }>(), file = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null), [folderFiles, setFolderFiles] = useState<File[]>([]);
  const latest = useRef<WorldCommit>(), lock = useRef(false), alive = useRef(true), controller = useRef<AbortController>(), worldSession = useRef<WorldSession>(), pending = useRef<Promise<void>>(Promise.resolve());
  const stop = useCallback(() => { controller.current?.abort(); worldSession.current?.stop(); }, []);
  usePlayLifecycle(stop);
  const blocker = useBlocker(busy);
  useEffect(() => { if (blocker.state === 'blocked') { stop(); if (!busy) blocker.proceed(); } }, [blocker, busy, stop]);
  function accept(c: WorldCommit) { latest.current = c; if (alive.current) setCurrent(c); }
  useEffect(() => {
    alive.current = true;
    void repo.open(id).then(h => { if (!alive.current) return; const c = h.latest; if (h.warnings.length || !c?.state.gal || c.deleted) { navigate('/worlds/' + id, { replace: true }); return; } accept(c); }).catch(e => { if (alive.current) setError(String(e)); });
    const hide = () => { if (document.hidden) stop(); }, unload = (e: BeforeUnloadEvent) => { if (lock.current) { e.preventDefault(); e.returnValue = ''; } };
    const resize = () => { const v = window.visualViewport; setViewport(v ? { height: v.height, top: v.offsetTop } : undefined); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('beforeunload', unload); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize); resize();
    return () => { alive.current = false; stop(); pool.dispose(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', unload); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, [id, repo, pool, navigate, stop]);
  useEffect(() => {
    if (!isTauri()) return; let disposed = false, allowed = false, remove: (() => void) | undefined;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => { const w = getCurrentWindow(); const unlisten = await w.onCloseRequested(e => { if (allowed) return; e.preventDefault(); stop(); void pending.current.then(() => { allowed = true; return w.close(); }); }); if (disposed) unlisten(); else remove = unlisten; });
    return () => { disposed = true; remove?.(); };
  }, [stop]);
  async function operation(action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return false; lock.current = true; setBusy(true); setError(''); controller.current = new AbortController();
    let finish!: () => void; pending.current = new Promise(resolve => { finish = resolve; });
    try { await action(controller.current.signal); return true; } catch (e) { if (alive.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { lock.current = false; controller.current = undefined; worldSession.current = undefined; finish(); if (alive.current) setBusy(false); }
  }
  async function persist(state: WorldState) { const c = latest.current; if (!c) throw new Error('场景尚未读取'); const saved = await repo.append(c, { state, events: [] }, 'configure'); accept(saved); }
  const save = (state: WorldState) => operation(() => persist(state));
  async function resume(signal: AbortSignal) {
    const c = latest.current!, g = c.state.gal!; if (!g.pending) throw new Error('没有等待处理的选择');
    if (g.kind === 'encounter') {
      const choice = currentScene(g).choices.find(choice => choice.id === g.pending!.choiceId), control = c.state.adventure?.control;
      if (!choice?.command || !control || !g.encounterId) throw new Error('遭遇已经变化');
      const session = new WorldSession(repo, c, undefined, {}, accept); worldSession.current = session;
      signal.throwIfAborted();
      try { accept(await session.step({ type: 'encounter', ...control, encounterId: g.encounterId, choice: choice.command })); }
      finally { if (!session.current.state.gal && alive.current) navigate('/worlds/' + id); }
      return;
    }
    const [{ WorldModelGateway }, { generateScene }] = await Promise.all([import('@/play/agents/model-gateway'), import('@/play/gal/generate-scene')]);
    signal.throwIfAborted();
    const gateway = new WorldModelGateway(() => intelligence(latest.current!.state), async data => { const state = withIntelligence(latest.current!.state); state.intelligence = data; const saved = await repo.append(latest.current!, { state, events: [] }, 'request'); accept(saved); });
    try { const scene = await generateScene(c.state, gateway, signal); signal.throwIfAborted(); await persist(acceptScene(latest.current!.state, g.pending.id, scene)); }
    finally { if (alive.current) setTraces(rows => [...rows, ...gateway.traces].slice(-20)); }
  }
  function choose(choiceId: string, input?: string) { void operation(async signal => { const c = latest.current!; await persist(stageChoice(c.state, c.state.gal!.revision, choiceId, input)); await resume(signal); }); }
  function chooseImage(selected: File) { void operation(async () => { const asset = await importStageImage(selected); await media.put(asset); const next = structuredClone(latest.current!.state); next.gal![assetKind] = asset.id; await persist(next); }); }
  const gal = current?.state.gal, scene = gal && currentScene(gal), name = current?.state.actors.find(a => a.id === gal?.actorId)?.name ?? '旅人';
  return <>{isTauri() && <ClientTitleBar titleBarContent="山海剧场" />}<main className={'gal-app' + (viewport && viewport.height < 560 ? ' gal-keyboard' : '')} style={viewport ? { height: viewport.height - (isTauri() ? 44 : 0), top: viewport.top + (isTauri() ? 44 : 0) } : undefined}>
    {gal && scene && <StageMedia background={scene.background} backgroundAsset={gal.backgroundAsset} portraitAsset={gal.portraitAsset} name={name} repo={media} pool={pool} />}
    <header className="gal-header"><button aria-label="离开剧场" onClick={() => { stop(); navigate(gal?.kind === 'encounter' ? '/worlds/' + id : '/worlds'); }}><ArrowLeft size={20} /></button><span className="gal-title">{current?.title ?? '山海剧场'}<small>{gal?.kind === 'encounter' ? '世界遭遇 · 时间已暂停' : '视觉小说 · 独立故事'}</small></span>{busy && <button aria-label="停止剧情生成" onClick={stop}><Pause size={20} /></button>}<button aria-label="剧情回顾" disabled={busy} onClick={() => setSheet('history')}><BookOpen size={19} /></button><button aria-label="剧场行囊" disabled={busy} onClick={() => setSheet('menu')}><MoreHorizontal size={21} /></button></header>
    {gal ? <GalStage gal={gal} busy={busy} error={error} next={() => void operation(async () => { const c = latest.current!; await persist(advanceBeat(c.state, c.state.gal!.revision)); })} choose={choose} retry={() => void operation(resume)} /> : <div className="gal-loading" role="status">{error || '灯光渐起，舞台正在展开…'}</div>}
    <Dialog open={sheet !== null} onOpenChange={open => { if (!open && !busy) setSheet(null); }}><DialogContent className="world-dialog gal-sheet" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}><DialogHeader><DialogTitle>{{ history: '走过的剧情', settings: '续写与额度', menu: '剧场行囊', media: '布置你的舞台' }[sheet ?? 'menu']}</DialogTitle><DialogDescription>对白与选择会自动保存，重开后从此刻继续。</DialogDescription></DialogHeader>{error && <p role="alert">{error}</p>}
      {sheet === 'history' && gal && <div className="gal-history">{gal.scenes.map(s => <section key={s.id}><h3>{s.title}</h3>{s.beats.map(b => <p key={b.id}><strong>{b.speaker || '旁白'}</strong>{b.text}</p>)}{gal.choices.filter(c => c.sceneId === s.id).map(c => <small key={c.choiceId}>你的选择：{c.text}</small>)}</section>)}<p>显示最近 {gal.scenes.length} 场；完整断点随世界备份保存。</p></div>}
      {sheet === 'settings' && current && <WorldIntelligencePanel world={current.state} busy={busy} save={save} traces={traces} />}
      {sheet === 'menu' && current && <div className="world-menu"><button onClick={() => setSheet('settings')}><Settings2 size={18} />续写连接与额度</button><button onClick={() => setSheet('media')}><ImagePlus size={18} />背景与立绘</button><button disabled={busy} onClick={() => void operation(async () => { const fork = await repo.fork(latest.current!, current.title.slice(0,60) + ' · 支线'); if (alive.current) navigate('/gal/' + fork.worldId); })}>从此刻另存支线</button><button disabled={busy} onClick={() => void operation(async () => { const text = await repo.exportPackage(id); await saveTextFile({ fileName: `视觉故事-${id.slice(0,8)}.ste-world`, text, label: '完整视觉故事包', extension: 'ste-world' }); })}>导出完整故事与素材</button><p>完整包包含剧情、人设与私密记忆。</p><button disabled={busy} onClick={() => void operation(async () => { await repo.archive(latest.current!, true); if (alive.current) navigate('/worlds'); })}>收起故事到回收站</button><button onClick={() => { setSheet(null); navigate('/worlds'); }}>返回世界与故事列表</button></div>}
      {sheet === 'media' && gal && <div className="world-panel-stack"><p>按需加载当前背景和立绘。自选图片会保存为独立素材，自动缩放并剥离附带元数据。</p><label>要更换什么<select value={assetKind} onChange={e => setAssetKind(e.target.value as typeof assetKind)}><option value="backgroundAsset">场景背景</option><option value="portraitAsset">角色立绘</option></select></label><button disabled={busy} onClick={() => file.current?.click()}>选择本地图片</button><button disabled={busy} onClick={() => { folder.current?.setAttribute('webkitdirectory', ''); folder.current?.click(); }}>从外部素材目录挑选</button><input hidden ref={folder} type="file" multiple onChange={e => { setFolderFiles(Array.from(e.target.files ?? []).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name)).slice(0,200)); e.target.value = ''; }} />{folderFiles.length > 0 && <div className="world-guest-list">{folderFiles.map((f,i) => <button disabled={busy} key={i} onClick={() => chooseImage(f)}>{f.name}</button>)}</div>}<input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) chooseImage(selected); }} /><button disabled={busy} onClick={() => void operation(async () => { const next = structuredClone(latest.current!.state); delete next.gal![assetKind]; await persist(next); })}>恢复默认舞台</button><p>单张原图 ≤4 MB、≤800 万像素；舞台解码缓存上限 32 MB。</p></div>}
    </DialogContent></Dialog>
  </main></>;
}
