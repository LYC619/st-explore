import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { matchPath, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { PortraitCloudTasks } from '@/components/character/PortraitCloudTasks';
import {
  closeDetachedTavernWindow,
  getRoleplaySessionSnapshot,
  setRoleplayOpenChat,
  useRoleplaySessionState,
} from '@/lib/roleplay/detached-window';

const loadRoleplayModule = () => import('@/pages/Roleplay');
export const preloadRoleplayPage = loadRoleplayModule;
const Roleplay = lazy(loadRoleplayModule);

/** One live chat per vault, rendered inline on `/play/:id` or portaled into a same-origin detached split-screen window. */
export function RoleplayWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch);
  const session = useRoleplaySessionState();
  const match = matchPath('/play/:id', location.pathname);
  const inlineActive = !!match;
  const worldRequested = location.pathname === '/worlds' || location.pathname.startsWith('/worlds/') || location.pathname.startsWith('/gal/');
  const [taskDock, setTaskDock] = useState<HTMLDivElement | null>(null);
  const saved = session.openChat;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => () => {
    closeDetachedTavernWindow();
    setRoleplayOpenChat(null);
  }, []);

  useEffect(() => {
    if (!match?.params.id) return;
    const query = new URLSearchParams(location.search);
    if (getRoleplaySessionSnapshot().detached && !closeDetachedTavernWindow()) return;
    setRoleplayOpenChat(
      {
        id: match.params.id,
        branchId: query.has('branch') ? query.get('branch') || null : undefined,
        fromChats: query.get('from') === 'chats',
        epoch: getVaultEpoch(),
      },
      { detached: false, container: null },
    );
  }, [match?.params.id, location.search]);

  useEffect(() => {
    if (saved && saved.epoch !== epoch) {
      closeDetachedTavernWindow();
      setRoleplayOpenChat(null);
      if (inlineActive) navigate('/play', { replace: true });
    }
  }, [epoch, saved, inlineActive, navigate]);

  const release = useCallback(() => {
    if (
      savedRef.current?.id !== saved?.id
      || savedRef.current?.branchId !== saved?.branchId
      || savedRef.current?.epoch !== saved?.epoch
    ) {
      return;
    }
    if (!closeDetachedTavernWindow()) return;
    setRoleplayOpenChat(null);
    if (matchPath('/play/:id', locationRef.current.pathname)) {
      navigate('/play', { replace: true });
    }
  }, [saved?.id, saved?.branchId, saved?.epoch, navigate]);

  const isDetachedMounted = Boolean(session.detached && session.container);
  const roleplayActive = inlineActive || isDetachedMounted;

  return (
    <>
      {saved?.epoch === epoch && (
        <Suspense fallback={inlineActive ? <div>正在打开酒馆…</div> : null}>
          <Roleplay
            id={saved.id}
            branchId={saved.branchId}
            fromChats={saved.fromChats}
            active={roleplayActive}
            detached={isDetachedMounted}
            detachedContainer={session.container}
            onRelease={release}
            taskDock={isDetachedMounted ? null : taskDock}
            worldRequested={worldRequested}
          />
        </Suspense>
      )}
      {!inlineActive && (
        worldRequested && saved?.epoch === epoch ? (
          <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
            <h1 className="text-xl">正在收好当前故事</h1>
            <p className="max-w-md text-muted-foreground">等待当前回复结束并保存后，将自动进入山海世界。若保存失败，可返回聊天重试。</p>
            <button
              type="button"
              className="min-h-11 rounded-lg border px-5"
              onClick={() => navigate('/play/' + encodeURIComponent(saved.id))}
            >
              返回当前聊天
            </button>
          </div>
        ) : (
          <Suspense fallback={<div className="p-6">{worldRequested ? '正在打开世界…' : '正在加载…'}</div>}>
            <Outlet />
          </Suspense>
        )
      )}
      <div
        ref={setTaskDock}
        className="fixed bottom-16 right-4 z-40 flex max-h-[70vh] max-w-[calc(100vw-2rem)] flex-col items-end gap-2 overflow-y-auto"
      >
        <PortraitCloudTasks />
      </div>
    </>
  );
}
