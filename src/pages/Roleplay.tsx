import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientTitleBar } from '@/components/ClientTitleBar';
import { useApiProfileState } from '@/components/ai-tools/useApiProfileState';
import { isApiProfileConfigured } from '@/components/ai-tools/api-profiles';
import { RoleplayGuide } from '@/components/roleplay/RoleplayGuide';
import { ChatProcessPanel } from '@/components/roleplay/ChatProcessPanel';
import {
  RoleplayHeaderBar,
  RoleplayRecoveryBanners,
  type TavernSettingsSection,
} from '@/components/roleplay/RoleplayChrome';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { registerTavernHost, type TavernFrameWindow, type TavernHost } from '@/lib/roleplay/frame';
import {
  closeDetachedTavernWindow,
  focusDetachedTavernWindow,
  launchRoleplayTarget,
  preopenDetachedTavernWindow,
  registerDetachedCloseFlushHandler,
  setRoleplayGeneratingState,
  setRoleplayOpenChat,
} from '@/lib/roleplay/detached-window';
import { saveTextFile } from '@/lib/roleplay/export-package-file';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { isTauri } from '@/lib/runtime';
import { useReaderBack } from '@/lib/immersive-mode';
import { useAndroidBackButton } from '@/hooks/use-android-back';
import { useViewport } from '@/hooks/use-viewport';
import { getVaultEpoch } from '@/lib/vault/active';
import { buildStoryReadPath } from '@/lib/editor-story-context';

type ExitDestination = { kind: 'route'; path: string; state?: unknown } | { kind: 'close' } | { kind: 'release' };
const errorMessage = (reason: unknown) => (reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason));

/** STE owns navigation and recovery; the actual chat DOM belongs entirely to ST. */
export default function Roleplay({
  id,
  branchId,
  fromChats,
  active,
  detached = false,
  detachedContainer = null,
  onRelease,
  taskDock,
  worldRequested = false,
}: {
  id: string;
  branchId?: string | null;
  fromChats: boolean;
  active: boolean;
  detached?: boolean;
  detachedContainer?: HTMLElement | null;
  onRelease: () => void;
  taskDock: HTMLDivElement | null;
  worldRequested?: boolean;
}) {
  const activeRef = useRef(active);
  activeRef.current = active;
  const detachedRef = useRef(detached);
  detachedRef.current = detached;
  const detachedContainerRef = useRef(detachedContainer);
  detachedContainerRef.current = detachedContainer;
  const fromChatsRef = useRef(fromChats);
  fromChatsRef.current = fromChats;

  const { isMobile } = useViewport();
  const { profiles, activeId } = useApiProfileState();
  const activeProfile = profiles.find((p) => p.id === activeId);

  const [launch, setLaunch] = useState({ storyId: id, branchId });
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const returnTarget = useRef({ storyId: id, branchId });
  const [src, setSrc] = useState<string>();
  const [status, setStatus] = useState('正在打开酒馆…');
  const [ready, setReady] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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

  const backDestination = useCallback((): ExitDestination => (
    fromChats
      ? { kind: 'route', path: '/play' }
      : {
        kind: 'route',
        path: '/chat?storyId=' + encodeURIComponent(returnTarget.current.storyId ?? '')
          + '&branch=' + encodeURIComponent(returnTarget.current.branchId ?? ''),
      }
  ), [fromChats]);

  const reportSaveError = useCallback((reason: unknown, kind: 'chat' | 'flush' = 'flush') => {
    saveFailureKind.current = kind;
    setSaveFailed(true);
    setError('尚未保存全部内容，当前聊天仍保留在窗口中：' + errorMessage(reason));
  }, []);

  const saveBeforeExit = useCallback(() => {
    if (exitTask.current) return exitTask.current;
    setLeaving(true);
    setError(undefined);
    const task = Promise.resolve()
      .then(() => flushRef.current())
      .then(() => {
        saveFailureKind.current = undefined;
        setSaveFailed(false);
        setError(undefined);
        setStatus('已保存');
      })
      .catch((reason) => {
        reportSaveError(reason);
        throw reason;
      })
      .finally(() => {
        exitTask.current = undefined;
        setLeaving(false);
      });
    exitTask.current = task;
    return task;
  }, [reportSaveError]);

  useEffect(() => {
    if (!detached) return undefined;
    return registerDetachedCloseFlushHandler(saveBeforeExit);
  }, [detached, saveBeforeExit]);

  // Sync global active API profile / model switches to live Tavern session
  const activeProfileRef = useRef(activeProfile);
  activeProfileRef.current = activeProfile;
  const initialProfileSigRef = useRef('');
  const lastSyncedProfileSig = useRef('');
  useEffect(() => {
    if (!ready || !processHost || isGenerating || generating.current) return;
    if (!activeProfile || !isApiProfileConfigured(activeProfile)) return;
    const sig = `${activeProfile.id}::${activeProfile.model}::${activeProfile.apiUrl}`;
    if (!lastSyncedProfileSig.current && sig === initialProfileSigRef.current) {
      lastSyncedProfileSig.current = sig;
      return;
    }
    if (lastSyncedProfileSig.current === sig) return;
    lastSyncedProfileSig.current = sig;
    void processHost
      .request('/ste/configuration', { mainProfileId: activeProfile.id })
      .then((res) => {
        if (!res.ok) {
          lastSyncedProfileSig.current = '';
          return;
        }
        const child = frame.current?.contentWindow as TavernFrameWindow | null;
        return child?.__STE_REFRESH_CONNECTIONS__?.();
      })
      .catch((err) => {
        lastSyncedProfileSig.current = '';
        console.warn('[Roleplay] 同步全局活跃连接至酒馆未完成:', err);
      });
  }, [activeProfile, isGenerating, processHost, ready]);

  const worldExitAttempted = useRef(false);
  const worldRequestedRef = useRef(worldRequested);
  worldRequestedRef.current = worldRequested;
  useEffect(() => {
    if (!worldRequested) {
      worldExitAttempted.current = false;
      return;
    }
    if (!ready || generating.current || worldExitAttempted.current || saveFailed) return;
    worldExitAttempted.current = true;
    void saveBeforeExit()
      .then(() => {
        if (worldRequestedRef.current) onRelease();
      })
      .catch(() => { /* Retain iframe; reportSaveError already surfaced recovery UI. */ });
  }, [worldRequested, ready, status, saveFailed, saveBeforeExit, onRelease]);

  const flushedForPark = useRef(false);
  const navigateToModule = useCallback(async (path: string) => {
    if (detachedRef.current) {
      navigate(path);
      try { window.focus(); } catch { /* ignore */ }
      return;
    }
    if (!generating.current) {
      try {
        await saveBeforeExit();
        flushedForPark.current = true;
      } catch {
        return;
      }
    }
    navigate(path);
  }, [navigate, saveBeforeExit]);

  const wasActive = useRef(active);
  const libraryRefreshPending = useRef(false);
  useEffect(() => {
    const parked = wasActive.current && !active;
    wasActive.current = active;
    if (parked) libraryRefreshPending.current = true;
    if (active) {
      flushedForPark.current = false;
      return;
    }
    const alreadyFlushed = flushedForPark.current;
    flushedForPark.current = false;
    if (parked && !alreadyFlushed && !generating.current && !worldRequested) {
      void saveBeforeExit().catch(() => { /* reportSaveError already surfaced recovery UI */ });
    }
  }, [active, worldRequested, saveBeforeExit]);

  useEffect(() => {
    if (!active || !ready || generating.current || !libraryRefreshPending.current) return;
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    if (!child?.__STE_TAVERN_REFRESH_LIBRARY__) return;
    libraryRefreshPending.current = false;
    void child.__STE_TAVERN_REFRESH_LIBRARY__().catch((reason) => {
      libraryRefreshPending.current = true;
      setError('资料库列表刷新未完成：' + errorMessage(reason));
    });
  }, [active, ready, status]);

  // Refresh Tavern catalogs on detached window focus & protect dirty detached window beforeunload
  useEffect(() => {
    const win = detachedContainer?.ownerDocument?.defaultView;
    if (!detached || !win) return undefined;
    const onFocus = () => {
      if (!ready || generating.current) return;
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      void child?.__STE_TAVERN_REFRESH_LIBRARY__?.().catch((err) => {
        console.warn('[Roleplay] 聚焦独立窗口时刷新资料库未完成:', err);
      });
    };
    const onChildBeforeUnload = (event: BeforeUnloadEvent) => {
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      if (allowExit.current || (!generating.current && !child?.__STE_TAVERN_DIRTY__?.())) return;
      event.preventDefault();
      event.returnValue = '';
    };
    win.addEventListener('focus', onFocus);
    win.addEventListener('beforeunload', onChildBeforeUnload);
    return () => {
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('beforeunload', onChildBeforeUnload);
    };
  }, [detached, detachedContainer, ready]);

  useEffect(() => {
    if (id === returnTarget.current.storyId && (branchId === undefined || branchId === returnTarget.current.branchId)) return;
    let cancelled = false;
    switching.current = true;
    void saveBeforeExit()
      .then(() => {
        if (cancelled) return;
        returnTarget.current = { storyId: id, branchId };
        setLaunch({ storyId: id, branchId });
      }, () => {
        if (cancelled) return;
        if (detachedRef.current) {
          setRoleplayOpenChat(
            { id: returnTarget.current.storyId ?? id, branchId: returnTarget.current.branchId, fromChats: fromChatsRef.current, epoch: getVaultEpoch() },
            { detached: true, container: detachedContainerRef.current },
          );
        } else {
          navigate('/play/' + encodeURIComponent(returnTarget.current.storyId ?? id)
            + '?branch=' + encodeURIComponent(returnTarget.current.branchId ?? ''), { replace: true });
        }
      })
      .finally(() => { if (!cancelled) switching.current = false; });
    return () => { cancelled = true; switching.current = false; };
  }, [id, branchId, navigate, saveBeforeExit]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      if (allowExit.current || (!generating.current && !child?.__STE_TAVERN_DIRTY__?.())) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const current = getCurrentWindow();
        const stop = await current.onCloseRequested((event) => {
          if (allowExit.current) return;
          event.preventDefault();
          pendingExit.current = { kind: 'close' };
          void saveBeforeExit()
            .then(() => {
              allowExit.current = true;
              closeDetachedTavernWindow();
              return current.close();
            })
            .catch(() => {
              /* reportSaveError already surfaced recovery UI */
              if (detachedRef.current) focusDetachedTavernWindow();
            });
        });
        if (disposed) stop();
        else unlisten = stop;
      });
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('beforeunload', beforeUnload);
    };
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
    const curProf = activeProfileRef.current;
    initialProfileSigRef.current = curProf && isApiProfileConfigured(curProf)
      ? `${curProf.id}::${curProf.model}::${curProf.apiUrl}`
      : '';
    lastSyncedProfileSig.current = '';
    const open = async () => {
      allowExit.current = false;
      if (!launch.storyId) throw new Error('缺少故事 ID');
      const response = await fetch('/ste/tavern-defaults.json');
      if (disposed || epoch !== getVaultEpoch()) return;
      if (!response.ok) throw new Error('酒馆资源尚未准备完成，请重新构建应用');
      const defaults = await response.json();
      if (disposed || epoch !== getVaultEpoch()) return;
      const host = await createTavernHost({
        storyId: launch.storyId,
        branchId: launch.branchId,
        defaults,
        onCommit: () => {
          if (disposed) return;
          setStatus('正文已保存');
          if (saveFailureKind.current === 'chat' && !exitTask.current) {
            saveFailureKind.current = undefined;
            setSaveFailed(false);
            setError(undefined);
          }
        },
        onSaveError: (message) => { if (!disposed) reportSaveError(message, 'chat'); },
        onStartup: (message, failed) => {
          if (disposed) return;
          setStatus(failed ? '酒馆加载失败' : message);
          if (failed) setError(message);
        },
        onReady: () => {
          if (disposed) return;
          setReady(true);
          setStatus(runtimeStatus.current ?? '无 Agent · 自动保存');
          if (!saveFailureKind.current) setError(undefined);
          try { if (!localStorage.getItem('ste-play-guide-seen')) setGuideOpen(true); } catch { /* Optional preference */ }
        },
        onGeneration: (genActive) => {
          if (disposed) return;
          generating.current = genActive;
          setIsGenerating(genActive);
          setRoleplayGeneratingState(genActive);
          setStatus(genActive ? '正在生成…' : runtimeStatus.current ?? '无 Agent · 自动保存');
        },
        onAgentStatus: (state) => {
          runtimeStatus.current = state.message;
          if (!disposed) setStatus(state.message);
        },
        onManageProfiles: () => { saveSettingsSection('ai'); void navigateToModule('/settings'); },
        onManagePage: (path) => { void navigateToModule(path); },
        onOpenStory: (storyId) => { void navigateToModule('/chat?storyId=' + encodeURIComponent(storyId)); },
        onSelect: (locator) => {
          if (disposed) return;
          const previous = returnTarget.current;
          returnTarget.current = { storyId: locator.storyId, branchId: locator.branchId };
          if (detachedRef.current) {
            setRoleplayOpenChat(
              { id: locator.storyId, branchId: locator.branchId, fromChats: fromChatsRef.current, epoch: getVaultEpoch() },
              { detached: true, container: detachedContainerRef.current },
            );
            return;
          }
          if (!activeRef.current || exitTask.current || switching.current) return;
          if (previous.storyId === locator.storyId && previous.branchId === locator.branchId) return;
          const params = new URLSearchParams();
          params.set('branch', locator.branchId ?? '');
          if (fromChatsRef.current) params.set('from', 'chats');
          const path = '/play/' + encodeURIComponent(locator.storyId) + (params.size ? '?' + params : '');
          navigate(path, { replace: true });
        },
      });
      if (disposed) {
        host.close();
        return;
      }
      host.setForeground(activeRef.current);
      setProcessHost(host);
      const registration = registerTavernHost(host);
      remove = registration.remove;
      flushRef.current = async () => {
        const child = frame.current?.contentWindow as (TavernFrameWindow & { closed?: boolean }) | null;
        if (child && !child.closed && child.__STE_TAVERN_FLUSH__) {
          try {
            await child.__STE_TAVERN_FLUSH__();
          } catch (err) {
            if (!child.closed) throw err;
            console.warn('[Roleplay] 独立子窗口已关闭，跳过前端快照冲刷并继续落盘宿主状态:', err);
          }
        }
        await host.flush();
      };
      const baseOrigin = detachedRef.current ? window.location.origin : '';
      setSrc(`${baseOrigin}/tavern.html?host=${registration.id}`);
    };
    void open().catch((reason) => {
      if (!disposed) {
        setError(errorMessage(reason));
        setStatus('酒馆加载失败');
      }
    });
    return () => {
      disposed = true;
      setIsGenerating(false);
      setRoleplayGeneratingState(false);
      remove?.();
      flushRef.current = async () => {};
    };
  }, [launch, navigate, navigateToModule, reportSaveError]);

  const goToDestination = useCallback(async (destination: ExitDestination) => {
    if (destination.kind === 'close') {
      allowExit.current = true;
      closeDetachedTavernWindow();
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      } catch (reason) {
        allowExit.current = false;
        reportSaveError(reason);
      }
    } else if (destination.kind === 'release') {
      onRelease();
    } else {
      navigate(destination.path, { state: destination.state });
    }
  }, [navigate, onRelease, reportSaveError]);

  const leave = useCallback(async () => {
    if (leaving) return;
    const destination = backDestination();
    if (!generating.current) {
      try {
        await saveBeforeExit();
        flushedForPark.current = true;
      } catch {
        return;
      }
    }
    if (destination.kind === 'route') navigate(destination.path, { state: destination.state });
  }, [leaving, backDestination, navigate, saveBeforeExit]);

  const popOutToDetached = async () => {
    if (leaving || detached || generating.current) return;
    const reservation = preopenDetachedTavernWindow(true);
    if (!reservation) {
      setError('当前环境拦截了独立窗口，请允许弹窗权限后再试（也可继续在页内游玩）。');
      return;
    }
    const targetStoryId = returnTarget.current.storyId ?? id;
    const targetBranchId = returnTarget.current.branchId ?? branchId;
    try {
      await saveBeforeExit();
      flushedForPark.current = true;
    } catch {
      reservation.cancelIfUnused();
      return;
    }
    setReady(false);
    setStatus('正在切换窗口…');
    launchRoleplayTarget({
      storyId: targetStoryId,
      branchId: targetBranchId,
      fromChats,
      navigate,
      reservation,
      forceMode: 'detached',
    });
    navigate(fromChats ? '/play' : buildStoryReadPath(targetStoryId, { branchId: targetBranchId }), { replace: true });
  };

  const dockBackInline = async () => {
    if (leaving || !detached || generating.current) return;
    const targetStoryId = returnTarget.current.storyId ?? id;
    const targetBranchId = returnTarget.current.branchId ?? branchId;
    try {
      await saveBeforeExit();
    } catch {
      return;
    }
    setReady(false);
    setStatus('正在切换窗口…');
    launchRoleplayTarget({
      storyId: targetStoryId,
      branchId: targetBranchId,
      fromChats,
      navigate,
      forceMode: 'inline',
    });
  };

  const closeChat = async () => {
    pendingExit.current = { kind: 'release' };
    try {
      await saveBeforeExit();
      await goToDestination({ kind: 'release' });
    } catch { /* Keep recovery available. */ }
  };

  const exportRecovery = async () => {
    setExporting(true);
    setExportNotice(undefined);
    try {
      const child = frame.current?.contentWindow as TavernFrameWindow | null;
      if (!child?.__STE_TAVERN_SNAPSHOT__) throw new Error('聊天界面尚未准备好');
      const output = await child.__STE_TAVERN_SNAPSHOT__();
      const result = await saveTextFile({ ...output, label: '聊天恢复文件', extension: 'jsonl' });
      setExportNotice(
        result === 'cancelled'
          ? '已取消导出，当前聊天仍未保存。'
          : '已导出当时的聊天、编辑内容和未发送输入。之后的修改需要再次导出。',
      );
    } catch (reason) {
      setExportNotice('导出未完成：' + errorMessage(reason));
    } finally {
      setExporting(false);
    }
  };

  const openSettings = (section: TavernSettingsSection) => {
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    void child?.__STE_TAVERN_OPEN_SETTINGS__?.(section).catch((reason) => setError(errorMessage(reason)));
  };

  const changeGuide = (open: boolean) => {
    setGuideOpen(open);
    if (!open) {
      try { localStorage.setItem('ste-play-guide-seen', '1'); } catch { /* Optional preference. */ }
    }
  };

  useEffect(() => {
    setStartupSlow(false);
    if (ready || error) return undefined;
    const timer = setTimeout(() => setStartupSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [ready, error, launch]);

  const retryStartup = async () => {
    if (ready || leaving) return;
    const child = frame.current?.contentWindow as TavernFrameWindow | null;
    try {
      if (child?.__STE_TAVERN_DIRTY__?.()) await saveBeforeExit();
      else await processHost?.flush();
      setLaunch({ ...returnTarget.current });
    } catch (reason) {
      reportSaveError(reason);
    }
  };

  useAndroidBackButton(active && !detached);
  useReaderBack(active && !detached, () => { void leave(); });

  const shellContent = (
    <div
      aria-hidden={!active}
      style={active ? undefined : { position: 'fixed', inset: 0, visibility: 'hidden', pointerEvents: 'none' }}
    >
      <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
        {!detached && isTauri() && <ClientTitleBar titleBarContent="聊天" />}
        <RoleplayHeaderBar
          detached={detached}
          fromChats={fromChats}
          isMobile={isMobile}
          ready={ready}
          leaving={leaving}
          isGenerating={isGenerating}
          status={status}
          detachedContainer={detachedContainer}
          onDockBackInline={() => { void dockBackInline(); }}
          onLeave={() => { void leave(); }}
          onPopOutToDetached={() => { void popOutToDetached(); }}
          onManageModels={() => {
            if (ready) openSettings('models');
            else {
              saveSettingsSection('ai');
              void navigateToModule('/settings');
            }
          }}
          onOpenProcess={() => setProcessOpen(true)}
          onOpenSettings={openSettings}
          onOpenGuide={() => changeGuide(true)}
          onCloseChat={() => { void closeChat(); }}
        />

        <RoleplayRecoveryBanners
          ready={ready}
          error={error}
          saveFailed={saveFailed}
          startupSlow={startupSlow}
          leaving={leaving}
          exporting={exporting}
          exportNotice={exportNotice}
          confirmExit={confirmExit}
          closingWindow={pendingExit.current?.kind === 'close'}
          detachedContainer={detachedContainer}
          onRetryStartup={() => { void retryStartup(); }}
          onRetrySave={() => { void saveBeforeExit().catch(() => { /* reportSaveError already surfaced recovery UI */ }); }}
          onExportRecovery={() => { void exportRecovery(); }}
          onConfirmExitChange={setConfirmExit}
          onForceLeave={() => { void goToDestination(pendingExit.current ?? { kind: 'release' }); }}
        />

        {src ? (
          <iframe ref={frame} title="SillyTavern 角色扮演" src={src} className="min-h-0 w-full flex-1 border-0" />
        ) : (
          !error && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )
        )}

        <ChatProcessPanel
          host={processHost}
          storyId={returnTarget.current.storyId}
          branchId={returnTarget.current.branchId}
          open={processOpen && active}
          onOpenChange={setProcessOpen}
          portalContainer={detachedContainer}
        />
        <RoleplayGuide
          open={guideOpen && active}
          onOpenChange={changeGuide}
          runtimeReady={ready}
          portalContainer={detachedContainer}
          onModels={() => {
            if (ready) openSettings('models');
            else {
              saveSettingsSection('ai');
              void navigateToModule('/settings');
            }
          }}
          onRuntime={() => { if (ready) openSettings('runtime'); }}
        />
      </div>
    </div>
  );

  return (
    <>
      {!active && !detached && taskDock && createPortal(
        <div className="flex max-w-full shrink-0 items-center gap-2 rounded-lg border bg-background p-2 shadow-lg">
          <Button
            variant={saveFailed ? 'destructive' : 'outline'}
            size="sm"
            onClick={() => navigate(
              '/play/' + encodeURIComponent(returnTarget.current.storyId ?? id)
              + '?branch=' + encodeURIComponent(returnTarget.current.branchId ?? '')
              + (fromChats ? '&from=chats' : ''),
            )}
          >
            返回聊天 · {saveFailed ? '保存未完成' : status}
          </Button>
          <Button variant="ghost" size="icon" aria-label="关闭后台聊天" disabled={leaving} onClick={() => { void closeChat(); }}>
            <X className="h-4 w-4" />
          </Button>
        </div>,
        taskDock,
      )}
      {detached && detachedContainer ? createPortal(shellContent, detachedContainer) : shellContent}
    </>
  );
}
