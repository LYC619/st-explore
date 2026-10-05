import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CircleHelp, Code, FileUp, GitBranch, Loader2, Menu, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { registerTavernHost, type TavernFrameWindow } from '@/lib/roleplay/frame';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { isTauri } from '@/lib/runtime';
import { useReaderBack } from '@/lib/immersive-mode';
import { useAndroidBackButton } from '@/hooks/use-android-back';

type ExitDestination = { kind: 'route'; path: string; state?: unknown } | { kind: 'close' };
const errorMessage = (reason: unknown) => reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason);

/** STE owns navigation and recovery; the actual chat DOM belongs entirely to ST. */
export default function Roleplay() {
  const { id } = useParams<{ id: string }>();
  const [query] = useSearchParams();
  const branchId = query.has('branch') ? query.get('branch') || null : undefined;
  const fromChats = query.get('from') === 'chats';
  const [launch, setLaunch] = useState({ storyId: id, branchId });
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const returnTarget = useRef({ storyId: id, branchId });
  const internalLocation = useRef<string>();
  const [src, setSrc] = useState<string>();
  const [status, setStatus] = useState('正在打开酒馆…');
  const [ready, setReady] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
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
  const blocker = useBlocker(({ nextLocation }) => !!src && !allowExit.current
    && nextLocation.pathname + nextLocation.search !== internalLocation.current);
  const latestBlocker = useRef(blocker);
  latestBlocker.current = blocker;
  const blockedNavigation = useRef<string>();
  const backDestination = useCallback((): ExitDestination => fromChats
    ? { kind: 'route', path: '/play' }
    : { kind: 'route', path: '/story/' + encodeURIComponent(returnTarget.current.storyId ?? ''), state: { branchId: returnTarget.current.branchId } }, [fromChats]);
  const reportSaveError = useCallback((reason: unknown, kind: 'chat' | 'flush' = 'flush') => {
    saveFailureKind.current = kind;
    setSaveFailed(true);
    setError('尚未保存全部内容，当前聊天仍保留在窗口中：' + errorMessage(reason));
  }, []);

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

  useEffect(() => {
    if (blocker.state !== 'blocked') { blockedNavigation.current = undefined; return; }
    const key = blocker.location.key;
    if (blockedNavigation.current === key) return;
    blockedNavigation.current = key;
    pendingExit.current = { kind: 'route', path: blocker.location.pathname + blocker.location.search + blocker.location.hash, state: blocker.location.state };
    // Saving updates React state. Settle a blocked destination only once, using the live blocker.
    const settle = (saved: boolean) => {
      const current = latestBlocker.current;
      if (allowExit.current || current.state !== 'blocked' || current.location.key !== key) return;
      if (saved) current.proceed(); else current.reset();
    };
    void saveBeforeExit().then(() => settle(true), () => settle(false));
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
    setReady(false);
    setSrc(undefined);
    const open = async () => {
      allowExit.current = false;
      if (!launch.storyId) throw new Error('缺少故事 ID');
      const response = await fetch('/ste/tavern-defaults.json');
      if (!response.ok) throw new Error('酒馆资源尚未准备完成，请重新构建应用');
      const host = await createTavernHost({
        storyId: launch.storyId, branchId: launch.branchId, defaults: await response.json(),
        onCommit: () => {
          if (disposed) return;
          setStatus('正文已保存');
          if (saveFailureKind.current === 'chat' && !exitTask.current) {
            saveFailureKind.current = undefined; setSaveFailed(false); setError(undefined);
          }
        },
        onSaveError: message => { if (!disposed) reportSaveError(message, 'chat'); },
        onReady: () => {
          if (disposed) return;
          setReady(true); setStatus(runtimeStatus.current ?? '无 Agent · 自动保存');
          try { if (!localStorage.getItem('ste-play-guide-seen')) setGuideOpen(true); } catch { /* Help remains available without local preferences. */ }
        },
        onGeneration: active => { if (!disposed) setStatus(active ? '正在生成…' : runtimeStatus.current ?? '无 Agent · 自动保存'); },
        onAgentStatus: state => { runtimeStatus.current = state.message; if (!disposed) setStatus(state.message); },
        onManageProfiles: () => { saveSettingsSection('ai'); navigate('/settings'); },
        onManagePage: path => navigate(path),
        onOpenStory: storyId => navigate('/story/' + encodeURIComponent(storyId)),
        onSelect: locator => {
          if (disposed) return;
          const previous = returnTarget.current;
          returnTarget.current = { storyId: locator.storyId, branchId: locator.branchId };
          // A save can publish the selected chat while a blocked Back navigation is waiting.
          // Replacing the URL here would cancel that pending navigation after its data was saved.
          if (exitTask.current || latestBlocker.current.state !== 'unblocked') return;
          if (previous.storyId === locator.storyId && previous.branchId === locator.branchId) return;
          const params = new URLSearchParams();
          params.set('branch', locator.branchId ?? '');
          if (fromChats) params.set('from', 'chats');
          const path = '/play/' + encodeURIComponent(locator.storyId) + (params.size ? '?' + params : '');
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
      setSrc('/tavern.html?host=' + registration.id);
    };
    void open().catch(reason => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; remove?.(); flushRef.current = async () => {}; };
  }, [launch, navigate, fromChats, reportSaveError]);

  const goToDestination = useCallback(async (destination: ExitDestination) => {
    allowExit.current = true;
    if (destination.kind === 'close') {
      try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close(); }
      catch (reason) { allowExit.current = false; reportSaveError(reason); }
    } else navigate(destination.path, { state: destination.state });
  }, [navigate, reportSaveError]);
  const leave = useCallback(async () => {
    if (leaving) return;
    const destination = backDestination();
    pendingExit.current = destination;
    try { await saveBeforeExit(); await goToDestination(destination); }
    catch { /* Keep the live frame mounted so retry and independent export remain possible. */ }
  }, [leaving, backDestination, saveBeforeExit, goToDestination]);
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
  useAndroidBackButton();
  useReaderBack(true, () => { void leave(); });

  return <div className="flex h-dvh min-h-0 flex-col bg-background">
    {isTauri() && <ClientTitleBar titleBarContent="聊天" />}
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
      <Button variant="ghost" size="sm" disabled={leaving} onClick={() => { void leave(); }}>
        {leaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowLeft className="mr-1 h-4 w-4" />}{fromChats ? '返回聊天' : '返回故事'}
      </Button>
      <span role="status" title={status} className="order-last min-w-0 basis-full truncate text-xs text-muted-foreground sm:order-none sm:flex-1 sm:basis-auto">{status}</span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('branches')}><GitBranch className="mr-1 h-4 w-4" />分支</Button>
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('scripts')}><Code className="mr-1 h-4 w-4" />脚本</Button>
        <Button variant="ghost" size="sm" disabled={!ready || leaving} onClick={() => openSettings('chat')}><Menu className="mr-1 h-4 w-4" />聊天工具</Button>
        <Button variant="ghost" size="sm" disabled={!ready} onClick={() => openSettings('runtime')}><SlidersHorizontal className="mr-1 h-4 w-4" />玩法设置</Button>
        <Button variant="ghost" size="sm" onClick={() => changeGuide(true)}><CircleHelp className="mr-1 h-4 w-4" />使用帮助</Button>
      </div>
    </header>
    {(error || saveFailed) && <div role="alert" className="shrink-0 border-b bg-destructive/10 px-4 py-3 text-sm">
      <p className="break-words text-destructive">{error ?? '正在重试保存…'}</p>
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
    {src ? <iframe ref={frame} title="SillyTavern 角色扮演" src={src} className="min-h-0 w-full flex-1 border-0" />
      : !error && <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}
    <RoleplayGuide open={guideOpen} onOpenChange={changeGuide} runtimeReady={ready} onModels={() => {
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
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void goToDestination(pendingExit.current ?? backDestination()); }}>确认离开</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
