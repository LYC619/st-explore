import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { registerTavernHost, type TavernFrameWindow } from '@/lib/roleplay/frame';
import { isTauri } from '@/lib/runtime';
import { useReaderBack } from '@/lib/immersive-mode';
import { useAndroidBackButton } from '@/hooks/use-android-back';

/** STE owns the repository and lifecycle; the actual chat DOM belongs entirely to ST. */
export default function Roleplay() {
  const { id } = useParams<{ id: string }>();
  const [query] = useSearchParams();
  const branchId = query.get('branch');
  const [launch, setLaunch] = useState({ storyId: id, branchId });
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const returnTarget = useRef({ storyId: id, branchId });
  const internalLocation = useRef<string>();
  const [src, setSrc] = useState<string>();
  const [status, setStatus] = useState('正在打开酒馆…');
  const [error, setError] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const allowExit = useRef(false);
  const exitTask = useRef<Promise<void>>();
  const runtimeStatus = useRef<string>();
  const blocker = useBlocker(({ nextLocation }) => !!src && !allowExit.current
    && nextLocation.pathname + nextLocation.search !== internalLocation.current);

  useEffect(() => {
    internalLocation.current = undefined;
    if (id !== returnTarget.current.storyId || branchId !== returnTarget.current.branchId) {
      returnTarget.current = { storyId: id, branchId };
      setLaunch({ storyId: id, branchId });
    }
  }, [id, branchId]);

  const saveBeforeExit = useCallback(() => {
    if (exitTask.current) return exitTask.current;
    setLeaving(true);
    setError(undefined);
    const task = flushRef.current().catch(reason => {
      setError(`尚未保存，已留在当前聊天：${reason instanceof Error ? reason.message : String(reason)}`);
      throw reason;
    }).finally(() => { exitTask.current = undefined; setLeaving(false); });
    exitTask.current = task;
    return task;
  }, []);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void saveBeforeExit().then(() => blocker.proceed(), () => blocker.reset());
  }, [blocker, saveBeforeExit]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      if (allowExit.current || !child?.__STE_TAVERN_DIRTY__?.()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    if (isTauri()) void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow();
      const stop = await current.onCloseRequested(event => {
        if (allowExit.current) return;
        event.preventDefault();
        void saveBeforeExit().then(() => { allowExit.current = true; return current.close(); }).catch(() => {});
      });
      if (disposed) stop(); else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [saveBeforeExit]);

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    const open = async () => {
      allowExit.current = false;
      if (!launch.storyId) throw new Error('缺少故事 ID');
      const response = await fetch('/ste/tavern-defaults.json');
      if (!response.ok) throw new Error('酒馆资源尚未准备完成，请重新构建应用');
      const host = await createTavernHost({
        storyId: launch.storyId, branchId: launch.branchId, defaults: await response.json(),
        onCommit: () => { if (!disposed) setStatus('正文已保存'); },
        onReady: () => { if (!disposed) setStatus(runtimeStatus.current ?? '无 Agent · 自动保存'); },
        onGeneration: active => { if (!disposed) setStatus(active ? '正在生成…' : runtimeStatus.current ?? '无 Agent · 自动保存'); },
        onAgentStatus: state => { runtimeStatus.current = state.message; if (!disposed) setStatus(state.message); },
        onManageProfiles: () => navigate('/settings'),
        onManagePage: path => navigate(path),
        onOpenStory: storyId => navigate('/story/' + encodeURIComponent(storyId)),
        onSelect: locator => {
          if (disposed) return;
          const previous = returnTarget.current;
          returnTarget.current = { storyId: locator.storyId, branchId: locator.branchId };
          if (previous.storyId === locator.storyId && previous.branchId === locator.branchId) return;
          const path = `/play/${encodeURIComponent(locator.storyId)}${locator.branchId ? `?branch=${encodeURIComponent(locator.branchId)}` : ''}`;
          internalLocation.current = path;
          navigate(path, { replace: true });
        },
      });
      if (disposed) { host.close(); return; }
      const registration = registerTavernHost(host);
      remove = registration.remove;
      flushRef.current = async () => {
        const child = frame.current?.contentWindow as TavernFrameWindow | null;
        if (child?.__STE_TAVERN_FLUSH__) await child.__STE_TAVERN_FLUSH__();
        await host.flush();
      };
      setSrc(`/tavern.html?host=${registration.id}`);
    };
    void open().catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      disposed = true;
      remove?.();
    };
  }, [launch, navigate]);

  const leave = useCallback(async () => {
    if (leaving) return;
    try {
      await saveBeforeExit();
      allowExit.current = true;
      navigate(`/story/${encodeURIComponent(returnTarget.current.storyId ?? '')}`, { state: { branchId: returnTarget.current.branchId } });
    } catch { /* Save error is shown above; the frame stays mounted for retry. */ }
  }, [leaving, navigate, saveBeforeExit]);
  useAndroidBackButton();
  useReaderBack(true, () => { void leave(); });

  return <div className="flex h-dvh min-h-0 flex-col bg-background">
    {isTauri() && <ClientTitleBar titleBarContent="角色扮演" />}
    <header className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5">
      <Button variant="ghost" size="sm" disabled={leaving} onClick={() => { void leave(); }}>
        {leaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowLeft className="mr-1 h-4 w-4" />}返回故事
      </Button>
      <span role="status" className="text-xs text-muted-foreground">{status}</span>
    </header>
    {error && <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
    {src ? <iframe ref={frame} title="SillyTavern 角色扮演" src={src} className="min-h-0 w-full flex-1 border-0" />
      : !error && <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
  </div>;
}
