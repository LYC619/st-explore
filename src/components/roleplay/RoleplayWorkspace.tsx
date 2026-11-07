import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { PortraitCloudTasks } from '@/components/character/PortraitCloudTasks';

const Roleplay = lazy(() => import('@/pages/Roleplay'));
interface OpenChat { id: string; branchId?: string | null; fromChats: boolean; epoch: number }

/** One live chat per vault, retained across module navigation and loaded only on demand. */
export function RoleplayWorkspace() {
  const location = useLocation(), navigate = useNavigate();
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch);
  const match = matchPath('/play/:id', location.pathname);
  const active = !!match;
  const worldRequested = location.pathname === '/worlds' || location.pathname.startsWith('/worlds/');
  const [saved, setSaved] = useState<OpenChat | null>(null);
  const [taskDock, setTaskDock] = useState<HTMLDivElement | null>(null);
  const savedRef = useRef(saved); savedRef.current = saved;
  const locationRef = useRef(location); locationRef.current = location;
  useEffect(() => {
    if (!match?.params.id) return;
    const query = new URLSearchParams(location.search);
    setSaved({ id: match.params.id, branchId: query.has('branch') ? query.get('branch') || null : undefined,
      fromChats: query.get('from') === 'chats', epoch: getVaultEpoch() });
  }, [match?.params.id, location.search]);
  useEffect(() => {
    if (saved && saved.epoch !== epoch) {
      setSaved(null);
      if (active) navigate('/play', { replace: true });
    }
  }, [epoch, saved, active, navigate]);
  const release = useCallback(() => {
    // Saving is asynchronous: release only the session that initiated it and
    // decide navigation from the route the user is on when saving finishes.
    if (savedRef.current?.id !== saved?.id || savedRef.current?.branchId !== saved?.branchId || savedRef.current?.epoch !== saved?.epoch) return;
    setSaved(null);
    if (matchPath('/play/:id', locationRef.current.pathname)) navigate('/play', { replace: true });
  }, [saved?.id, saved?.branchId, saved?.epoch, navigate]);
  return <>
    {saved?.epoch === epoch && <Suspense fallback={active ? <div>正在打开酒馆…</div> : null}>
      <Roleplay id={saved.id} branchId={saved.branchId} fromChats={saved.fromChats} active={active} onRelease={release} taskDock={taskDock} worldRequested={worldRequested} />
    </Suspense>}
    {!active && (worldRequested && saved?.epoch === epoch
      ? <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h1 className="text-xl">正在收好当前故事</h1>
        <p className="max-w-md text-muted-foreground">等待当前回复结束并保存后，将自动进入山海世界。若保存失败，可返回聊天重试。</p>
        <button className="min-h-11 rounded-lg border px-5" onClick={() => navigate('/play/' + encodeURIComponent(saved.id))}>返回当前聊天</button>
      </div> : <Suspense fallback={<div className="p-6">{worldRequested ? '正在打开世界…' : '正在加载…'}</div>}><Outlet /></Suspense>)}
    <div ref={setTaskDock} className="fixed bottom-16 right-4 z-40 flex max-h-[70vh] max-w-[calc(100vw-2rem)] flex-col items-end gap-2 overflow-y-auto">
      <PortraitCloudTasks />
    </div>
  </>;
}
