import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import type { RemoveOptions } from '@/lib/repo';
import { duplicateArchiveStory } from '@/lib/story-maintenance';
/**
 * 聊天处理页（2.0 阶段2 起 = 未绑定模式的统一聊天工作台，定稿第六章）。
 * 界面主体在 ChatWorkbench（与故事工作区同一套）；本页只负责：
 * 导入落地、自动落库、跨页指针、引导教程，以及「未绑定 → 绑定到角色」升级。
 * 阶段5 书架退役：未绑定聊天直接存为归档故事（characterId 为空），本页空态列出暂存记录。
 */
import { useMemo, useState, useEffect, useRef, useCallback  } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, MessageSquare, Trash2, Clock, BookOpenCheck, ExternalLink, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppLayout } from '@/components/AppLayout';
import { ChatImporter, type ImportStats } from '@/components/chat/ChatImporter';
import { ChatWorkbench } from '@/components/chat/ChatWorkbench';
import { RecentStoryBar } from '@/components/chat/RecentStoryBar';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import NovelView from '@/components/reader/NovelView';
import { BindStoryDialog } from '@/components/chat/BindStoryDialog';
import { GuidedTour } from '@/components/GuidedTour';
import { HOME_TOUR_STEPS, isTourCompleted, setTourCompleted } from '@/lib/tour-steps';
import { DemoData } from '@/components/DemoData';
import { demoSession } from '@/lib/demo-session';
import type { ChatSession, ExportSettings, ChapterMarker } from '@/types/chat';
import { listCharacterIndex, listStoryIndex, toStoryIndex, type CharacterIndexEntry, type StoryIndexEntry } from '@/lib/archive-index';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import {
  buildStoryFromSession,
  saveArchiveStory,
  updateArchiveStory,
  getArchiveStory,
  deleteArchiveStory,
  updateBranchLine,
  getBranchLine,
  resolveInitialBranchId,
} from '@/lib/archive-db';
import { bindSessionToCharacter } from '@/lib/bind-story';
import { takePendingToolFile } from '@/lib/tool-handoff';
import {
  saveSessionPointer,
  loadSessionPointer,
  clearSessionState,
  getDefaultExportSettings,
  saveSettings,
  applyGlobalAppearanceToSettings,
  normalizeAppearanceSettings,
} from '@/lib/session-storage';
import { useToast } from '@/hooks/use-toast';
import {
  buildEditorChatPath,
  getEditorStoryId,
  resolveEditorStoryId,
  setEditorStoryId,
} from '@/lib/editor-story-context';
import { pickRecentEditorStories } from '@/lib/home-layout';
import { executeDeleteAction } from '@/lib/destructive-action';
import { stableJson } from '@/lib/roleplay/fingerprint';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { getVaultEpoch } from '@/lib/vault/active';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { preloadRoleplayPage } from '@/components/roleplay/RoleplayWorkspace';
import {
  focusDetachedTavernWindow,
  launchRoleplayTarget,
  reserveDetachedWindowForAsyncAction,
  useRoleplaySessionState,
} from '@/lib/roleplay/detached-window';
import { prepareStoryPlay } from '@/lib/roleplay/open-story';

const Index = () => {
  useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const routeStoryId = searchParams.get('storyId');
  const hasBranchParam = searchParams.has('branch');
  const routeBranchId = hasBranchParam ? (searchParams.get('branch') || null) : undefined;
  const rawFloorParam = searchParams.get('floor');
  const routeFloor = rawFloorParam !== null && /^\d+$/.test(rawFloorParam) ? Number(rawFloorParam) : undefined;
  const roleplaySession = useRoleplaySessionState();
  const [showTour, setShowTour] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [settings, setSettings] = useState<ExportSettings>(getDefaultExportSettings);
  const [markers, setMarkers] = useState<ChapterMarker[]>([]);
  // 收藏楼层（messageId），轻量书签用于跳转，不进导出
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentFloor, setCurrentFloor] = useState(0);
  // 从指针恢复会话时要跳回的楼层，交给 ChatWorkbench 挂载后消费
  const [restoreFloor, setRestoreFloor] = useState<number | undefined>(undefined);
  const [highlightedFloor, setHighlightedFloor] = useState<number | null>(null);
  // 当前会话对应的归档故事 id（兼容旧指针字段 currentBookId）。
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [loadedStory, setLoadedStory] = useState<ArchiveStory | null>(null);
  const [allCharacters, setAllCharacters] = useState<CharacterIndexEntry[]>([]);
  const [playBusy, setPlayBusy] = useState(false);
  const playBusyRef = useRef(false);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const savedDraft = useRef<{ storyId: string; branchId: string | null; session: ChatSession;
    markers: ChapterMarker[]; favorites: string[]; settings: ExportSettings; lastFloor?: number }>();
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  // 小说视图（阶段6）：未绑定聊天也可用；润色上下文用当前暂存的归档故事
  const [novelStory, setNovelStory] = useState<ArchiveStory | null>(null);
  const [novelOpen, setNovelOpen] = useState(false);
  const [allStories, setAllStories] = useState<StoryIndexEntry[]>([]);
  const [storiesLoadFailed, setStoriesLoadFailed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StoryIndexEntry | null>(null);
  const [copyingStory, setCopyingStory] = useState<string | null>(null);
  // 处理区入口交接来的文件（挂载时取一次，交给 ChatImporter 自动解析）
  const [handoffFile] = useState<File | null>(() => takePendingToolFile('chat'));

  const isLiveInDetachedTavern = Boolean(
    currentStoryId && (roleplaySession.detached || roleplaySession.closing) && roleplaySession.openChat?.id === currentStoryId,
  );
  const wasDetached = useRef(false);
  const syncBarrier = useRef(false);
  const [syncPending, setSyncPending] = useState(false);
  if (isLiveInDetachedTavern) syncBarrier.current = true;

  const recentStories = useMemo(() => pickRecentEditorStories(allStories), [allStories]);
  const unboundStories = useMemo(() => allStories.filter((story) => !story.characterId), [allStories]);
  const currentStory = useMemo(
    () => allStories.find((story) => story.id === currentStoryId) ?? null,
    [allStories, currentStoryId],
  );
  const boundCharacterId = loadedStory?.characterId ?? currentStory?.characterId;
  const boundCharacter = useMemo(
    () => (boundCharacterId ? allCharacters.find((c) => c.id === boundCharacterId) : undefined),
    [allCharacters, boundCharacterId],
  );

  useEffect(() => {
    if (highlightedFloor === null) return undefined;
    const t = setTimeout(() => setHighlightedFloor(null), 3500);
    return () => clearTimeout(t);
  }, [highlightedFloor]);

  const refreshStories = useCallback(async () => {
    try {
      const [stories, chars] = await Promise.all([
        listStoryIndex(),
        listCharacterIndex().catch(() => [] as CharacterIndexEntry[]),
      ]);
      setAllStories(stories);
      setAllCharacters(chars);
      setStoriesLoadFailed(false);
    } catch {
      setStoriesLoadFailed(true);
    }
  }, []);

  const hydrateStory = useCallback((
    story: ArchiveStory,
    pointer = loadSessionPointer(),
    requestedBranchId?: string | null,
    requestedFloor?: number,
  ) => {
    const branchId = resolveInitialBranchId(story, requestedBranchId);
    const line = getBranchLine(story, branchId) ?? getBranchLine(story, null)!;
    const markers = line.markers ?? [];
    const favorites = line.favorites ?? [];
    const settings = applyGlobalAppearanceToSettings(
      normalizeAppearanceSettings(story.settings ?? settingsRef.current),
    );
    savedDraft.current = { storyId: story.id, branchId, session: line.session, markers, favorites, settings, lastFloor: line.lastFloor };
    setLoadedStory(story);
    setCurrentBranchId(branchId);
    setSession(line.session);
    setMarkers(markers);
    setFavorites(favorites);
    setSettings(settings);
    setCurrentStoryId(story.id);
    setEditorStoryId(story.id);
    if (typeof requestedFloor === 'number' && requestedFloor >= 0) {
      const clamped = line.session.messages.length > 0
        ? Math.min(requestedFloor, line.session.messages.length - 1)
        : requestedFloor;
      setRestoreFloor(clamped);
      setCurrentFloor(clamped);
      setHighlightedFloor(clamped);
    } else {
      const lastFloor = pointer?.currentBookId === story.id && (pointer.branchId ?? null) === branchId ? pointer.lastFloor ?? line.lastFloor : line.lastFloor;
      setRestoreFloor(typeof lastFloor === 'number' && lastFloor > 0 ? lastFloor : undefined);
      setCurrentFloor(lastFloor ?? 0);
      setHighlightedFloor(null);
    }
  }, []);

  useEffect(() => {
    const finishing = wasDetached.current && !isLiveInDetachedTavern;
    wasDetached.current = isLiveInDetachedTavern;
    if ((!isLiveInDetachedTavern && !finishing) || !currentStoryId) return undefined;
    syncBarrier.current = true;
    setSyncPending(true);
    let alive = true;
    let request = 0;
    const syncLatest = () => {
      const sequence = ++request;
      const epoch = getVaultEpoch();
      void getArchiveStory(currentStoryId)
        .then((latest) => {
          if (!alive || sequence !== request || !latest || epoch !== getVaultEpoch()) return;
          const line = getBranchLine(latest, currentBranchId) ?? getBranchLine(latest, null);
          if (!line) return;
          savedDraft.current = { storyId: currentStoryId, branchId: currentBranchId,
            session: line.session, markers: line.markers ?? [], favorites: line.favorites ?? [],
            settings: savedDraft.current?.settings ?? settingsRef.current, lastFloor: line.lastFloor };
          setLoadedStory(latest);
          setSession(line.session);
          setMarkers(savedDraft.current.markers);
          setFavorites(savedDraft.current.favorites);
          if (!isLiveInDetachedTavern) syncBarrier.current = false;
          setSyncPending(false);
        })
        .catch(() => {
          if (alive) toastRef.current({ title: tr("最新聊天尚未读回"), description: tr("请重新打开这条故事后再编辑，以保留酒馆刚保存的内容。"), variant: 'destructive' });
        });
    };
    syncLatest();
    const off = isLiveInDetachedTavern ? subscribeRecordChanges((change) => {
      if (change.store === 'archiveStories' && change.id === currentStoryId) syncLatest();
    }) : undefined;
    return () => {
      alive = false;
      off?.();
    };
  }, [currentBranchId, currentStoryId, isLiveInDetachedTavern]);

  // Auto-start tour for first-time visitors; an explicit or remembered story always wins.
  useEffect(() => {
    const hasRememberedStory = !!(routeStoryId || getEditorStoryId() || loadSessionPointer()?.currentBookId);
    if (!isTourCompleted('home') && !handoffFile && !hasRememberedStory) {
      // Load demo data and start tour
      setSession(demoSession);
      // Delay tour start to let DOM render
      const timer = setTimeout(() => setShowTour(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [handoffFile, routeStoryId]);

  // 显式 storyId > 编辑区共享记忆 > 旧聊天指针；三种入口最终加载同一条归档故事。
  useEffect(() => {
    if (showTour || handoffFile) return; // Don't override demo data during tour
    const pointer = loadSessionPointer();
    const targetId = resolveEditorStoryId(routeStoryId, pointer?.currentBookId);
    if (!targetId) return;
    let cancelled = false;
    getArchiveStory(targetId).then((story) => {
      if (cancelled) return;
      if (!story) {
        if (getEditorStoryId() === targetId) setEditorStoryId(null);
        if (routeStoryId) toast({ title: tr("找不到这条故事"), variant: 'destructive' });
        return;
      }
      hydrateStory(story, pointer, routeBranchId, routeFloor);
    }).catch((err) => {
      if (!cancelled) {
        toast({
          title: routeStoryId ? tr("故事加载失败") : tr("读取上次编辑的故事没成功"),
          description: err instanceof Error ? err.message : tr("可以从下方暂存列表重新选择故事打开"),
          variant: 'destructive',
        });
      }
    });
    return () => { cancelled = true; };
  }, [handoffFile, hydrateStory, routeStoryId, routeBranchId, routeFloor, showTour, toast]);

  useEffect(() => { void refreshStories(); }, [refreshStories]);

  // 检测 AI 生成的章节标记
  useEffect(() => {
    const aiMarkers = sessionStorage.getItem('ai-chapter-markers');
    if (aiMarkers) {
      sessionStorage.removeItem('ai-chapter-markers');
      try {
        const parsed = JSON.parse(aiMarkers) as ChapterMarker[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMarkers(prev => {
            const merged = [...prev];
            for (const marker of parsed) {
              const existing = merged.findIndex(m => m.messageIndex === marker.messageIndex);
              if (existing >= 0) {
                merged[existing] = marker;
              } else {
                merged.push(marker);
              }
            }
            return merged.sort((a, b) => a.messageIndex - b.messageIndex);
          });
          toast({ title: tr("已导入 {{v0}} 个 AI 生成的章节标记", { v0: parsed.length }) });
        }
      } catch { /* ignore */ }
    }
  }, [toast]);

  // The small pointer must also survive immediate branch/page navigation.
  useEffect(() => {
    if (session) {
      saveSessionPointer({ currentBookId: currentStoryId, branchId: currentBranchId, markers, favorites, lastFloor: currentFloor });
    }
  }, [session, markers, currentStoryId, currentBranchId, favorites, currentFloor]);

  // 保存设置变更到 localStorage
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // 自动落库：正则规则/楼层编辑/章节标记等处理状态随未绑定故事保存（防抖），
  // 否则暂存的记录永远停留在导入时的快照，重新打开会丢失之后的全部处理。
  const storySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef(new KeyedSerialQueue());
  const persistCurrentStory = useCallback(async () => {
    if (!session || !currentStoryId) return;
    return saveQueue.current.enqueue('editor', async () => {
      const base = savedDraft.current;
      if (!base || base.storyId !== currentStoryId || base.branchId !== currentBranchId) return;
      // A live Tavern owns content, but reading progress remains local to this line.
      if (isLiveInDetachedTavern || syncPending || syncBarrier.current) {
        if ((base.lastFloor ?? 0) !== currentFloor) {
          await updateArchiveStory(currentStoryId, current => updateBranchLine(current, currentBranchId, { lastFloor: currentFloor }));
          if (savedDraft.current === base) savedDraft.current = { ...base, lastFloor: currentFloor };
        }
        return;
      }
      if (base.session === session && base.markers === markers && base.favorites === favorites && base.settings === settings && (base.lastFloor ?? 0) === currentFloor) return;
      const next = { storyId: currentStoryId, branchId: currentBranchId, session, markers, favorites, settings, lastFloor: currentFloor };
      await updateArchiveStory(currentStoryId, (current) => {
        const line = getBranchLine(current, currentBranchId);
        if (!line) throw new Error(tr("故事分支不存在"));
        if (base.session !== session && stableJson(line.session) !== stableJson(base.session)) {
          throw new Error(tr("这条分支有新的聊天内容，请重新打开后再编辑；当前内容未覆盖"));
        }
        const updated = updateBranchLine(current, currentBranchId, {
          lastFloor: currentFloor,
          ...(base.session !== session ? { session } : {}),
          ...(base.markers !== markers ? { markers } : {}),
          ...(base.favorites !== favorites ? { favorites } : {}),
        });
        return {
          ...updated,
          ...(currentBranchId === null && base.session !== session ? { title: session.title || current.title } : {}),
          ...(base.settings !== settings ? { settings } : {}),
        };
      });
      if (savedDraft.current?.storyId === currentStoryId && savedDraft.current.branchId === currentBranchId) savedDraft.current = next;
    });
  }, [currentStoryId, currentBranchId, favorites, markers, session, settings, currentFloor, isLiveInDetachedTavern, syncPending]);

  const latestPersistRef = useRef(persistCurrentStory);
  latestPersistRef.current = persistCurrentStory;

  useEffect(() => {
    if (!session || !currentStoryId) return;
    if (storySyncTimerRef.current) clearTimeout(storySyncTimerRef.current);
    storySyncTimerRef.current = setTimeout(() => {
      void persistCurrentStory().catch((error) => {
        toast({
          title: tr("聊天处理内容尚未保存"),
          description: error instanceof Error ? error.message : tr("保存失败，请重试"),
          variant: 'destructive',
        });
      });
    }, 800);
    return () => { if (storySyncTimerRef.current) clearTimeout(storySyncTimerRef.current); };
  }, [currentStoryId, persistCurrentStory, session, toast]);

  useEffect(() => () => {
    if (storySyncTimerRef.current) clearTimeout(storySyncTimerRef.current);
    void latestPersistRef.current().catch((error: unknown) => {
      toastRef.current({
        title: tr("离开页面时保存暂存故事未成功"),
        description: error instanceof Error ? error.message : tr("请回到聊天处理页检查最新改动"),
        variant: 'destructive',
      });
    });
  }, []);

  const handleImport = async (newSession: ChatSession, stats?: ImportStats) => {
    setSession(newSession);
    setMarkers([]);
    setRestoreFloor(undefined);
    // 导入即存为未绑定归档故事（书架退役后的暂存地），随编辑自动同步
    try {
      const story = buildStoryFromSession(newSession);
      story.settings = settings;
      await saveArchiveStory(story);
      savedDraft.current = { storyId: story.id, branchId: null, session: newSession, markers: [], favorites: [], settings };
      setCurrentBranchId(null);
      setCurrentStoryId(story.id);
      setEditorStoryId(story.id);
      setFavorites([]);
      await refreshStories();
      navigate(buildEditorChatPath(story.id), { replace: true });

      // Build description with swipes stats
      let description = tr("已自动暂存，绑定角色后进入故事工作区");
      if (stats && stats.swipesRemoved > 0) {
        const sizeStr = stats.swipesBytesEstimate < 1024
          ? `${stats.swipesBytesEstimate} B`
          : stats.swipesBytesEstimate < 1024 * 1024
            ? `${(stats.swipesBytesEstimate / 1024).toFixed(1)} KB`
            : `${(stats.swipesBytesEstimate / (1024 * 1024)).toFixed(1)} MB`;
        description = tr("导入 {{v0}} 楼 · 发现 {{v1}} 条多余备选回复（约 {{v2}}），导出时将自动精简", { v0: stats.totalMessages, v1: stats.swipesRemoved, v2: sizeStr });
      }
      toast({ title: tr("导入成功"), description });
    } catch (error) {
      console.error('Auto-save failed:', error instanceof Error ? error.name : 'UnknownError');
      toast({
        title: tr("自动暂存失败"),
        description: tr("聊天已在当前页面打开，但未能写入本地库；请先点右上角「导出」留存备份，再检查磁盘空间或文件库权限。"),
        variant: 'destructive',
      });
    }
  };

  const handleReset = () => {
    savedDraft.current = undefined;
    setLoadedStory(null);
    setCurrentBranchId(null);
    setSession(null);
    setMarkers([]);
    setFavorites([]);
    setCurrentStoryId(null);
    setEditorStoryId(null);
    setRestoreFloor(undefined);
    setHighlightedFloor(null);
    clearSessionState();
    // 清掉 ?storyId，否则加载 effect 在刷新/重挂时会按显式路由复活刚关闭的会话
    navigate('/chat', { replace: true });
  };

  const handleOpenStory = async (story: StoryIndexEntry) => {
    try {
      await persistCurrentStory();
    } catch {
      toast({ title: tr("当前故事保存失败，已取消切换"), variant: 'destructive' });
      return;
    }
    let fresh: ArchiveStory | null = null;
    try {
      fresh = await getArchiveStory(story.id) ?? null;
    } catch {
      fresh = null;
    }
    if (!fresh) {
      toast({ title: tr("故事读取失败，已取消切换"), variant: 'destructive' });
      return;
    }
    hydrateStory(fresh);
    navigate(buildEditorChatPath(story.id));
  };

  const handleSwitchBranch = async (nextBranchId: string | null) => {
    if (!currentStoryId) return;
    try {
      await persistCurrentStory();
      const fresh = await getArchiveStory(currentStoryId);
      if (!fresh) return;
      await updateArchiveStory(currentStoryId, (cur) => ({
        ...cur,
        lastViewedBranchId: nextBranchId ?? undefined,
      }));
      hydrateStory(fresh, loadSessionPointer(), nextBranchId);
      navigate(buildEditorChatPath(currentStoryId, { branchId: nextBranchId }), { replace: true });
    } catch (error) {
      toast({
        title: tr("切换分支未成功"),
        description: error instanceof Error ? error.message : tr("请先保存当前改动后重试"),
        variant: 'destructive',
      });
    }
  };

  const runContinuePlay = async () => {
    if (!currentStoryId) return;
    if (isLiveInDetachedTavern) {
      focusDetachedTavernWindow();
      return;
    }
    if (playBusyRef.current) return;
    playBusyRef.current = true;
    setPlayBusy(true);
    const epoch = getVaultEpoch();
    const reservation = reserveDetachedWindowForAsyncAction();
    try {
      await persistCurrentStory();
      const [target] = await Promise.all([
        prepareStoryPlay(currentStoryId, currentBranchId),
        preloadRoleplayPage(),
      ]);
      if (epoch !== getVaultEpoch()) {
        reservation?.cancelIfUnused();
        return;
      }
      launchRoleplayTarget({
        storyId: target.storyId,
        branchId: target.branchId,
        navigate,
        reservation,
      });
    } catch (error) {
      reservation?.cancelIfUnused();
      toast({
        title: tr("暂时未能进入聊天"),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      playBusyRef.current = false;
      setPlayBusy(false);
    }
  };

  const handleDeleteUnbound = async (options: RemoveOptions) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deleted = await executeDeleteAction(async () => {
      await deleteArchiveStory(target.id, options);
      setAllStories((current) => current.filter((story) => story.id !== target.id));
      if (target.id === currentStoryId) handleReset();
    }, {
      onSuccess: () => toast({ title: tr("已删除暂存故事「{{v0}}」", { v0: target.title }) }),
      onFailure: () => toast({ title: tr("删除暂存故事失败"), variant: 'destructive' }),
    });
    if (deleted) setDeleteTarget(null);
    return deleted;
  };

  // 绑定到角色：未绑定故事补上 characterId 原地升级，总结/故事树成果带走，跳故事工作区
  const handleBind = async (character: ArchiveCharacter) => {
    if (!session) return;
    try {
      await persistCurrentStory();
      const { story, carried } = await bindSessionToCharacter({
        characterId: character.id,
        storyId: currentStoryId,
        branchId: currentBranchId,
        expectedSession: savedDraft.current?.session,
        session,
        markers,
        favorites,
        settings,
      });
      setLoadedStory(story);
      setCurrentStoryId(story.id);
      setEditorStoryId(story.id);
      setAllStories((current) => [toStoryIndex(story), ...current.filter((item) => item.id !== story.id)]);
      toast({
        title: tr("已绑定到「{{v0}}」", { v0: character.name }),
        description: carried > 0 ? tr("{{v0}} 条总结/故事树已一并带走", { v0: carried }) : undefined,
      });
      navigate(buildEditorChatPath(story.id, currentBranchId ? { branchId: currentBranchId } : undefined), { replace: true });
    } catch (error) {
      console.error('Bind failed:', error instanceof Error ? error.name : 'UnknownError');
      toast({
        title: tr("归入角色名下没成功"),
        description: tr("当前暂存对话并未丢失，请稍后重新点「绑定到角色」再试一次。"),
        variant: 'destructive',
      });
    }
  };

  const handleFloorChange = useCallback((floor: number) => setCurrentFloor(floor), []);

  const handleOpenNovel = async () => {
    // 润色成果要挂在归档故事上；暂存故事在 IDB 里即时读一份（demo 数据无故事则只读不润色）
    if (currentStoryId) {
      try {
        const story = await getArchiveStory(currentStoryId);
        setNovelStory(story ?? null);
      } catch {
        setNovelStory(null);
        toast({
          title: tr("未能读取当前故事的润色存档"),
          description: tr("小说视图已按预览模式打开，暂不支持写入润色记录"),
        });
      }
    } else {
      setNovelStory(null);
    }
    setNovelOpen(true);
  };

  return (
    <AppLayout>
      {!session ? (
        <div className="flex h-full min-h-0 flex-col">
          <RecentStoryBar stories={recentStories} activeStoryId={currentStoryId} onSelect={(story) => void handleOpenStory(story)} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="container mx-auto px-4 py-6">
              <div className="max-w-xl mx-auto animate-fade-in">
            {/* Tour replaces old onboarding */}
            <div className="text-center mb-8">
              <h2 className="font-display text-3xl mb-3 text-gradient">{tr("处理你的对话记录")}</h2>
              <p className="text-muted-foreground">{tr("导入 SillyTavern 聊天记录，支持正则清理、章节标记、范围导出和多种阅读主题")}</p>
            </div>
            <ChatImporter onImport={handleImport} initialFile={handoffFile} />

            <div className="mt-4 flex justify-center">
              <DemoData onLoad={setSession} />
            </div>

            {/* 未绑定暂存列表：书架退役后，临时聊天的唯一入口 */}
            {storiesLoadFailed && (
              <div role="alert" className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
                <span>{tr("暂存记录列表读取没成功，原有记录仍保存在库里。")}</span>
                <Button variant="outline" size="sm" onClick={() => void refreshStories()}>{tr("重新读取")}</Button>
              </div>
            )}
            {unboundStories.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{tr("未绑定的暂存记录")}</h3>
                <div className="space-y-2">
                  {unboundStories.map((story) => (
                    <div
                      key={story.id}
                      role="button"
                      tabIndex={0}
                      className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border card-elevated cursor-pointer hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void handleOpenStory(story)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleOpenStory(story);
                        }
                      }}
                    >
                      <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" title={story.title}>{story.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span>{tr("{{v0}} 楼", { v0: story.floorCount })}</span>
                          {story.meta.lastModel && <span className="truncate" title={story.meta.lastModel}>{story.meta.lastModel}</span>}
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {new Date(story.updatedAt).toLocaleDateString(getLocale())}
                          </span>
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" disabled={!!copyingStory}
                        onClick={event => {
                          event.stopPropagation(); setCopyingStory(story.id);
                          void duplicateArchiveStory(story.id).then(copy => {
                            setAllStories(current => [...current, toStoryIndex(copy)]);
                            toast({ title: tr("已复制故事"), description: copy.title });
                          }).catch(error => toast({ title: tr("复制失败"), description: String(error), variant: 'destructive' }))
                            .finally(() => setCopyingStory(null));
                        }}>{copyingStory === story.id ? tr("正在复制…") : tr("复制故事")}</Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(story); }}
                        aria-label={tr("删除暂存记录")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {isLiveInDetachedTavern && (
            <div
              role="status"
              data-detached-sync-banner
              className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[color:var(--brand-hairline)] bg-[var(--brand-active-bg)] px-4 py-2 text-xs text-[color:var(--text-primary)]"
            >
              <span>{tr("当前故事正在独立酒馆窗口对话中 · 已开启实时同步回看（暂锁正文编辑以防两边冲突）")}</span>
              <Button variant="outline" size="sm" className="px-2.5 text-xs" onClick={() => { focusDetachedTavernWindow(); }}>
                <ExternalLink className="w-3.5 h-3.5 mr-1" />{tr("聚焦酒馆窗口")}</Button>
            </div>
          )}
          {/* 工作态不再放最近故事栏（用户拍板：只在导入前需要）；切故事走全局菜单/窄工具栏 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ChatWorkbench
              key={`${currentStoryId ?? 'preview'}:${currentBranchId ?? 'main'}`}
              readerMode={isLiveInDetachedTavern || syncPending}
              characterId={boundCharacterId}
              highlightedFloor={highlightedFloor}
              recordContext={currentStoryId ? {
                storyId: currentStoryId,
                branchId: currentBranchId,
                flush: persistCurrentStory,
              } : undefined}
              session={session}
              markers={markers}
              favorites={favorites}
              settings={settings}
              onSessionChange={setSession}
              onMarkersChange={setMarkers}
              onFavoritesChange={setFavorites}
              onSettingsChange={setSettings}
              onFloorChange={handleFloorChange}
              initialFloor={restoreFloor}
              onReset={handleReset}
              titleBadge={
                <div className="inline-flex items-center gap-1.5 flex-wrap">
                  {boundCharacterId ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/character/${encodeURIComponent(boundCharacterId)}`)}
                      className="tap-target inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground hover:border-primary/40 hover:text-primary transition-colors"
                      title={tr("打开所属角色主页")}
                    >
                      <span>{boundCharacter?.displayMeta?.name || boundCharacter?.name || tr("角色主页")}</span>
                    </button>
                  ) : (
                    <Badge
                      variant="outline"
                      className="shrink-0 text-muted-foreground"
                      title={tr("这条故事尚未绑定角色卡")}
                    >{tr("未绑定")}</Badge>
                  )}
                  {(loadedStory?.branches?.length ?? 0) > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="tap-target inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          title={tr("切换故事主线或分支")}
                        >
                          <GitBranch className="w-3 h-3" />
                          <span>
                            {currentBranchId
                              ? (loadedStory?.branches?.find((b) => b.id === currentBranchId)?.name ?? tr("分支"))
                              : tr("主线")}
                          </span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          className={currentBranchId === null ? 'bg-primary/10 text-primary' : ''}
                          onClick={() => { void handleSwitchBranch(null); }}
                        >{tr("主线（{{v0}} 楼）", { v0: loadedStory?.session.messages.length ?? 0 })}</DropdownMenuItem>
                        {(loadedStory?.branches ?? []).map((b) => (
                          <DropdownMenuItem
                            key={b.id}
                            className={currentBranchId === b.id ? 'bg-primary/10 text-primary' : ''}
                            onClick={() => { void handleSwitchBranch(b.id); }}
                          >
                            {tr("{{v0}}（{{v1}} 楼）", { v0: b.name, v1: b.session.messages.length })}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              }
              toolbarExtras={
                <>
                  {boundCharacterId && currentStoryId && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={playBusy}
                      onClick={() => { void runContinuePlay(); }}
                      title={tr("接着当前剧情进入酒馆继续聊")}
                    >
                      <MessageSquare className="w-4 h-4 mr-1.5" />
                      {isLiveInDetachedTavern ? tr("聚焦酒馆") : tr("继续聊天")}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleOpenNovel} title={tr("小说视图：拆句重排+用户楼层弱化/隐藏+场景分隔（Esc 退出）")}>
                    <BookOpenCheck className="w-4 h-4 mr-1.5" />{tr("小说视图")}</Button>
                  {!boundCharacterId && (
                    <Button variant="outline" size="sm" onClick={() => setBindDialogOpen(true)}>
                      <Link2 className="w-4 h-4 mr-1.5" />{tr("绑定到角色")}</Button>
                  )}
                </>
              }
            />
          </div>
        </div>
      )}

      {/* 小说视图（未绑定模式；成果挂当前暂存故事，绑定时随 id 带走） */}
      {novelOpen && session && (
        <NovelView
          session={session}
          markers={markers}
          regexRules={settings.regexRules}
          onClose={() => setNovelOpen(false)}
          onMarkersChange={setMarkers}
          favorites={favorites}
          onFavoritesChange={setFavorites}
          initialFloor={restoreFloor ?? currentFloor}
          onFloorChange={handleFloorChange}
          progressKey={currentStoryId ? `${currentStoryId}:${currentBranchId ?? 'main'}` : undefined}
          polish={novelStory ? { story: novelStory, branchId: currentBranchId } : undefined}
        />
      )}

      <BindStoryDialog open={bindDialogOpen} onOpenChange={setBindDialogOpen} onSelect={handleBind} />

      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={tr("删除暂存故事「{{v0}}」？", { v0: deleteTarget?.title ?? '' })}
        description={tr("日记、总结和故事树会保留为未绑定记录。当前共 {{v0}} 楼。", { v0: deleteTarget?.floorCount ?? 0 })}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        fileTarget={deleteTarget ? { store: 'archiveStories', id: deleteTarget.id } : undefined}
        onConfirm={handleDeleteUnbound}
      />

      {/* Guided Tour */}
      {showTour && (
        <GuidedTour
          steps={HOME_TOUR_STEPS}
          module="home"
          onComplete={() => {
            setTourCompleted('home');
            setShowTour(false);
            toast({ title: tr("引导完成！"), description: tr("您可以清除示例数据并导入自己的文件。") });
          }}
          onSkip={() => {
            setTourCompleted('home');
            setShowTour(false);
          }}
        />
      )}

    </AppLayout>
  );
};

export default Index;
