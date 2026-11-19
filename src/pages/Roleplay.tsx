import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, CircleHelp, Code, FileUp, GitBranch, Loader2, Menu, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { ChatProcessPanel } from '@/components/roleplay/ChatProcessPanel';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { registerTavernHost, type TavernFrameWindow, type TavernHost } from '@/lib/roleplay/frame';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { isTauri } from '@/lib/runtime';
import { useReaderBack } from '@/lib/immersive-mode';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { getVaultEpoch } from '@/lib/vault/active';

type ExitDestination = { kind: 'route'; path: string; state?: unknown } | { kind: 'close' } | { kind: 'release' };
const errorMessage = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason);

/** STE owns navigation and recovery; the actual chat DOM belongs entirely to ST. */
export default function Roleplay({ id, branchId, fromChats, active, onRelease, taskDock, worldRequested = false }: {
  id: string; branchId?: string | null; fromChats: boolean; active: boolean; onRelease: () => void; taskDock: HTMLDivElement | null; worldRequested?: boolean;
}) {
  const activeRef = useRef(active); activeRef.current = active;
  const fromChatsRef = useRef(fromChats); fromChatsRef.current = fromChats;
  const [launch, setLaunch] = useState({ storyId: id, branchId });
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const returnTarget = useRef({ storyId: id, branchId });
  const [src, setSrc] = useState<string>();
  const [status, setStatus] = useState('正在打开酒馆…');
  const [ready, setReady] = useState(false);
  const [startupSlow, setStartupSlow] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [processHost, setProcessHost] = useState<TavernHost>();
  useEffect(() => { processHost?.setForeground?.(active); }, [active, processHost]);
  const [error, setError] = useState<string>();
  const [saveFailed, setSaveFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string>();
  const [confirmExit, setConfirmExit] = useState(false);
  const pendingExit = useRef<ExitDestination>();
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const allowExit = useRef(false);
  const exitTask = useRef<Promise<void>>();
  const runtimeStatus = useRef<string>();
  const saveFailureKind = useRef<'chat' | 'flush'>();
  const generating = useRef(false);
  const switching = useRef(false);
  const backDestination = useCallback((): ExitDestination => fromChats
    ? { kind: 'route', path: '/play' }
    : { kind: 'route', path: '/chat?storyId=' + encodeURIComponent(returnTarget.current.storyId ?? '')
      + '&branch=' + encodeURIComponent(returnTarget.current.branchId ?? '') }, [fromChats]);
  const reportSaveError = useCallback((reason: unknown, kind: 'chat' | 'flush' = 'flush') => {
    saveFailureKind.current = kind;
    setSaveFailed(true);
    setError('尚未保存全部内容，当前聊天仍保留在窗口中：' + errorMessage(reason));
  }, []);

  const saveBeforeExit = useCallback(() => {
    if (exitTask.current) return exitTask.current;
    setLeaving(true);
    setError(undefined);
    const task = Promise.resolve().then(() => flushRef.current()).then(() => {
      saveFailureKind.current = undefined;
      setSaveFailed(false); setError(undefined); setStatus('已保存');
    }).catch(reason => {
      reportSaveError(reason);
      throw reason;
    }).finally(() => { exitTask.current = undefined; setLeaving(false); });
    exitTask.current = task;
    return task;
  }, [reportSaveError]);

  const worldExitAttempted = useRef(false);
  const worldRequestedRef = useRef(worldRequested); worldRequestedRef.current = worldRequested;
  useEffect(() => {
    if (!worldRequested) { worldExitAttempted.current = false; return; }
    if (!ready || generating.current || worldExitAttempted.current || saveFailed) return;
    worldExitAttempted.current = true;
    void saveBeforeExit().then(() => { if (worldRequestedRef.current) onRelease(); }).catch(() => { /* Retain iframe and existing save recovery controls. */ });
  }, [worldRequested, ready, status, saveFailed, saveBeforeExit, onRelease]);

  const navigateToModule = useCallback(async (path: string) => {
    if (!generating.current) {
      try { await saveBeforeExit(); } catch { return; }
    }
    navigate(path);
  }, [navigate, saveBeforeExit]);

  const wasActive = useRef(active);
  const libraryRefreshPending = useRef(false);
  useEffect(() => {
    const parked = wasActive.current && !active;
    wasActive.current = active;
    if (parked) libraryRefreshPending.current = true;
    // Browser Back can park the page without using our toolbar. Commit idle edits
    // while retaining the document; an in-progress generation must keep running.
    // World entry has its own readiness barrier; flushing before ST finishes
    // loading can reject saveSettings and strand the pending transition.
    if (parked && !generating.current && !worldRequested) void saveBeforeExit().catch(() => {});
  }, [active, worldRequested, saveBeforeExit]);

  useEffect(() => {
    if (!active || !ready || generating.current || !libraryRefreshPending.current) return;
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    if (!child?.__STE_TAVERN_REFRESH_LIBRARY__) return;
    libraryRefreshPending.current = false;
    void child.__STE_TAVERN_REFRESH_LIBRARY__().catch(reason => {
      libraryRefreshPending.current = true;
      setError('资料库列表刷新未完成：' + errorMessage(reason));
    });
  }, [active, ready, status]);

  useEffect(() => {
    // A list entry omits branch to resume the already selected line. Guard the actual
    // replacement here, so other pages may own their own navigation confirmation.
    if (id === returnTarget.current.storyId && (branchId === undefined || branchId === returnTarget.current.branchId)) return;
    let cancelled = false;
    switching.current = true;
    void saveBeforeExit().then(() => {
      if (cancelled) return;
      returnTarget.current = { storyId: id, branchId };
      setLaunch({ storyId: id, branchId });
    }, () => {
      if (cancelled) return;
      navigate('/play/' + encodeURIComponent(returnTarget.current.storyId ?? id)
        + '?branch=' + encodeURIComponent(returnTarget.current.branchId ?? ''), { replace: true });
    }).finally(() => { if (!cancelled) switching.current = false; });
    return () => { cancelled = true; switching.current = false; };
  }, [id, branchId, navigate, saveBeforeExit]);

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
        pendingExit.current = { kind: 'close' };
        void saveBeforeExit().then(() => { allowExit.current = true; return current.close(); }).catch(() => {});
      });
      if (disposed) stop(); else unlisten = stop;
    });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [saveBeforeExit]);

  useEffect(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    const epoch = getVaultEpoch();
    setReady(false);
    setError(undefined);
    setStatus('正在打开酒馆…');
    setProcessHost(undefined);
    setSrc(undefined);
    const open = async () => {
      allowExit.current = false;
      if (!launch.storyId) throw new Error('缺少故事 ID');
      const response = await fetch('/ste/tavern-defaults.json');
      if (disposed || epoch !== getVaultEpoch()) return;
      if (!response.ok) throw new Error('酒馆资源尚未准备完成，请重新构建应用');
      const defaults = await response.json();
      if (disposed || epoch !== getVaultEpoch()) return;
      const host = await createTavernHost({
        storyId: launch.storyId, branchId: launch.branchId, defaults,
        onCommit: () => {
          if (disposed) return;
          setStatus('正文已保存');
          if (saveFailureKind.current === 'chat' && !exitTask.current) {
            saveFailureKind.current = undefined; setSaveFailed(false); setError(undefined);
          }
        },
        onSaveError: message => { if (!disposed) reportSaveError(message, 'chat'); },
        onStartup: (message, failed) => {
          if (disposed) return;
          setStatus(failed ? '酒馆加载失败' : message);
          if (failed) setError(message);
        },
        onReady: () => {
          if (disposed) return;
          setReady(true); setStatus(runtimeStatus.current ?? '无 Agent · 自动保存');
          if (!saveFailureKind.current) setError(undefined);
          try { if (!localStorage.getItem('ste-play-guide-seen')) setGuideOpen(true); } catch { /* Help remains available without local preferences. */ }
        },
        onGeneration: active => { if (!disposed) { generating.current = active; setStatus(active ? '正在生成…' : runtimeStatus.current ?? '无 Agent · 自动保存'); } },
        onAgentStatus: state => { runtimeStatus.current = state.message; if (!disposed) setStatus(state.message); },
        onManageProfiles: () => { saveSettingsSection('ai'); void navigateToModule('/settings'); },
        onManagePage: path => { void navigateToModule(path); },
        onOpenStory: storyId => { void navigateToModule('/chat?storyId=' + encodeURIComponent(storyId)); },
        onSelect: locator => {
          if (disposed) return;
          const previous = returnTarget.current;
          returnTarget.current = { storyId: locator.storyId, branchId: locator.branchId };
          // A save can publish the selected chat while a blocked Back navigation is waiting.
          // Replacing the URL here would cancel that pending navigation after its data was saved.
          if (!activeRef.current || exitTask.current || switching.current) return;
          if (previous.storyId === locator.storyId && previous.branchId === locator.branchId) return;
          const params = new URLSearchParams();
          params.set('branch', locator.branchId ?? '');
          if (fromChatsRef.current) params.set('from', 'chats');
          const path = '/play/' + encodeURIComponent(locator.storyId) + (params.size ? '?' + params : '');
          navigate(path, { replace: true });
        },
      });
      if (disposed) { host.close(); return; }
      host.setForeground(activeRef.current);
      setProcessHost(host);
      const registration = registerTavernHost(host);
      remove = registration.remove;
      flushRef.current = async () => {
        const child = frame.current?.contentWindow as TavernFrameWindow | null;
        if (child?.__STE_TAVERN_FLUSH__) await child.__STE_TAVERN_FLUSH__();
        await host.flush();
      };
      setSrc('/tavern.html?host=' + registration.id);
    };
    void open().catch(reason => { if (!disposed) { setError(errorMessage(reason)); setStatus('酒馆加载失败'); } });
    return () => { disposed = true; remove?.(); flushRef.current = async () => {}; };
  }, [launch, navigate, navigateToModule, reportSaveError]);

  const goToDestination = useCallback(async (destination: ExitDestination) => {
    if (destination.kind === 'close') {
      allowExit.current = true;
      try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close(); }
      catch (reason) { allowExit.current = false; reportSaveError(reason); }
    } else if (destination.kind === 'release') onRelease();
    else navigate(destination.path, { state: destination.state });
  }, [navigate, onRelease, reportSaveError]);
  const leave = useCallback(async () => {
    if (leaving) return;
    const destination = backDestination();
    if (!generating.current) {
      try { await saveBeforeExit(); } catch { return; }
    }
    if (destination.kind === 'route') navigate(destination.path, { state: destination.state });
  }, [leaving, backDestination, navigate, saveBeforeExit]);
  const closeChat = async () => {
    pendingExit.current = { kind: 'release' };
    try { await saveBeforeExit(); await goToDestination({ kind: 'release' }); } catch { /* Keep recovery available. */ }
  };
  const exportRecovery = async () => {
    setExporting(true); setExportNotice(undefined);
    try {
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      if (!child?.__STE_TAVERN_SNAPSHOT__) throw new Error('聊天界面尚未准备好');
      const output = await child.__STE_TAVERN_SNAPSHOT__();
      const result = await saveTextFile({ ...output, label: '聊天恢复文件', extension: 'jsonl' });
      setExportNotice(result === 'cancelled' ? '已取消导出，当前聊天仍未保存。'
        : '已导出当时的聊天、编辑内容和未发送输入。之后的修改需要再次导出。');
    } catch (reason) { setExportNotice('导出未完成：' + errorMessage(reason)); }
    finally { setExporting(false); }
  };
  const openSettings = (section: 'runtime' | 'models' | 'scripts' | 'branches' | 'chat') => {
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    void child?.__STE_TAVERN_OPEN_SETTINGS__?.(section).catch(reason => setError(errorMessage(reason)));
  };
  const changeGuide = (open: boolean) => {
    setGuideOpen(open);
    if (!open) try { localStorage.setItem('ste-play-guide-seen', '1'); } catch { /* Optional preference. */ }
  };
  useEffect(() => {
    setStartupSlow(false);
    if (ready || error) return;
    const timer = setTimeout(() => setStartupSlow(true), 20000);
    return () => clearTimeout(timer);
  }, [ready, error, launch]);
  const retryStartup = async () => {
    if (ready || leaving) return;
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    try {
      if (child?.__STE_TAVERN_DIRTY__?.()) await saveBeforeExit();
      else await processHost?.flush();
      setLaunch({ ...returnTarget.current });
    } catch (reason) { reportSaveError(reason); }
  };
  useAndroidBackButton(active);
  useReaderBack(active, () => { void leave(); });

  return <>
    {!active && taskDock && createPortal(<div className="flex max-w-full shrink-0 items-center gap-2 rounded-lg border bg-background p-2 shadow-lg">
      <Button variant={saveFailed ? 'destructive' : 'outline'} size="sm" onClick={() => navigate('/play/' + encodeURIComponent(returnTarget.current.storyId ?? id)
        + '?branch=' + encodeURIComponent(returnTarget.current.branchId ?? '') + (fromChats ? '&from=chats' : ''))}>
        返回聊天 · {saveFailed ? '保存未完成' : status}
      </Button>
      <Button variant="ghost" size="icon" aria-label="关闭后台聊天" disabled={leaving} onClick={() => { void closeChat(); }}><X className="h-4 w-4" /></Button>
    </div>, taskDock)}
    {/* Keep layout dimensions while parked: ST's virtual list skips updates at zero size. */}
    <div aria-hidden={!active} style={active ? undefined : { position: 'fixed', inset: 0, visibility: 'hidden', pointerEvents: 'none' }}><div className="flex h-dvh min-h-0 flex-col bg-background">
    {isTauri() && <ClientTitleBar titleBarContent="聊天" />}
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
      <Button variant="ghost" size="sm" disabled={leaving} onClick={() => { void leave(); }}>
        {leaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowLeft className="mr-1 h-4 w-4" />}{fromChats ? '返回聊天列表' : '返回聊天处理'}
      </Button>
      <span role="status" title={status} className="order-last min-w-0 basis-full truncate text-xs text-muted-foreground sm:order-none sm:flex-1 sm:basis-auto">{status}</span>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => setProcessOpen(true)}><Activity className="mr-1 h-4 w-4" />过程</Button>
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('branches')}><GitBranch className="mr-1 h-4 w-4" />分支</Button>
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('scripts')}><Code className="mr-1 h-4 w-4" />脚本</Button>
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('chat')}><Menu className="mr-1 h-4 w-4" />聊天工具</Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => openSettings('runtime')}><SlidersHorizontal className="mr-1 h-4 w-4" />玩法设置</Button>
        <Button variant="ghost" size="sm" onClick={() => changeGuide(true)}><CircleHelp className="mr-1 h-4 w-4" />使用帮助</Button>
        <Button variant="ghost" size="sm" disabled={leaving} onClick={() => { void closeChat(); }}><X className="mr-1 h-4 w-4" />关闭聊天</Button>
      </div>
    </header>
    {(error || saveFailed) && <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-3 text-sm">
      <p className="break-words text-destructive">{error ?? '正在重试保存…'}</p>
      {!ready && !saveFailed && <Button variant="outline" size="sm" className="mt-2 min-h-11" disabled={leaving} onClick={() => { void retryStartup(); }}><RotateCcw className="mr-1 h-4 w-4" />重新加载酒馆</Button>}
      {saveFailed && <>
        <p className="mt-1 text-muted-foreground">可以修复原因后重试，或先导出恢复文件再离开。导出会保留当前编辑和未发送输入。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={leaving} onClick={() => { void saveBeforeExit().catch(() => {}); }}>
            {leaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}重试保存
          </Button>
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => { void exportRecovery(); }}><FileUp className="mr-1 h-4 w-4" />{exporting ? '正在导出…' : '导出当前内容'}</Button>
          <Button variant="ghost" size="sm" disabled={leaving || exporting} onClick={() => setConfirmExit(true)}>退出聊天</Button>
        </div>
        {exportNotice && <p className="mt-2 text-muted-foreground" role="status">{exportNotice}</p>}
      </>}
    </div>}
    {!ready && !error && startupSlow && <div role="status" className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm">
      <span>加载时间较长，可等待当前步骤完成，或重新加载。</span>
      <Button variant="outline" size="sm" className="min-h-11" disabled={leaving} onClick={() => { void retryStartup(); }}><RotateCcw className="mr-1 h-4 w-4" />重新加载酒馆</Button>
    </div>}
    {src ? <iframe ref={frame} title="SillyTavern 角色扮演" src={src} className="min-h-0 w-full flex-1 border-0" />
      : !error && <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
    <ChatProcessPanel host={processHost} storyId={returnTarget.current.storyId} branchId={returnTarget.current.branchId} open={processOpen && active} onOpenChange={setProcessOpen} />
    <RoleplayGuide open={guideOpen && active} onOpenChange={changeGuide} runtimeReady={ready} onModels={() => {
      if (ready) openSettings('models'); else { saveSettingsSection('ai'); navigate('/settings'); }
    }} onRuntime={() => { if (ready) openSettings('runtime'); }} />
    <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>离开未保存的聊天？</AlertDialogTitle>
          <AlertDialogDescription>本次保存没有完成。离开后，尚未保存的回复、编辑和输入可能丢失。建议先取消并“导出当前内容”；确认离开会直接{pendingExit.current?.kind === 'close' ? '关闭窗口' : '离开聊天'}。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>留在聊天</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void goToDestination(pendingExit.current ?? { kind: 'release' }); }}>确认离开</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div></div></>;
}
