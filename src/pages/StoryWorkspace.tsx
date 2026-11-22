/**
 * 故事工作区（大屏统一落点 `/story/:id`）。
 * 共享同一个故事上下文（角色卡/故事/分支/阅读位置），左侧可收起二级栏切换：
 * 阅读与编辑 / 分卷总结 / 角色日记 / 自定义记录 / 故事树 / 导入与导出。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, BookOpenCheck, BookOpenText, ArrowDownUp, MessageSquare, Cpu,
  ScrollText, NotebookPen, PenLine, Network, Link2, PanelLeftClose, ExternalLink,
} from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChatWorkbench, type ChatWorkbenchHandle } from '@/components/chat/ChatWorkbench';
import { IOPanel } from '@/components/workspace/IOPanel';
import { OrganizeContextBar, type ContextStoryOption } from '@/components/workspace/OrganizeContextBar';
import { STUpdateHint } from '@/components/workspace/STUpdateHint';
import { BranchPanel } from '@/components/workspace/BranchPanel';
import { OutlinePanel } from '@/components/workspace/OutlinePanel';
import { SummaryWorkspace } from '@/components/organize/SummaryWorkspace';
import { StoryTreeWorkspace } from '@/components/organize/StoryTreeWorkspace';
import { BindStoryDialog } from '@/components/chat/BindStoryDialog';
import NovelView from '@/components/reader/NovelView';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import type { SummarySurfaceKind } from '@/types/summary';
import {
  getArchiveStory,
  updateArchiveStory,
  getCharacter,
  getBranchLine,
  resolveInitialBranchId,
  updateBranchLine,
  buildBranchFromSession,
} from '@/lib/archive-db';
import { listStoryIndex } from '@/lib/archive-index';
import { StoryDraftSaver } from '@/lib/story-draft-save';
import { parseJsonl, parseJson } from '@/lib/adapters/st';
import {
  applyGlobalAppearanceToSettings,
  getDefaultExportSettings,
  hasNonAppearanceSettingsChange,
  normalizeAppearanceSettings,
} from '@/lib/session-storage';
import {
  buildEditorStoryPath,
  buildStoryReadPath,
  isSummarySurfaceKind,
  parseEditorStoryView,
  setEditorStoryId,
  setEditorSummaryKind,
  type EditorStoryView,
  type OrganizeTarget,
} from '@/lib/editor-story-context';
import { isOrganizeWorkspaceView } from '@/lib/story-workspace-layout';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { useViewport } from '@/hooks/use-viewport';
import { getVaultEpoch } from '@/lib/vault/active';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import {
  focusDetachedTavernWindow,
  launchRoleplayTarget,
  preopenDetachedTavernWindow,
  useRoleplaySessionState,
} from '@/lib/roleplay/detached-window';

const RAIL_COLLAPSED_STORAGE_KEY = 'ste-story-rail-collapsed';

function readInitialRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

type WorkspaceView = EditorStoryView;

interface StoryWorkspaceLocationState {
  view?: string;
  branchId?: string | null;
  initialTarget?: OrganizeTarget;
  sourceFloor?: number;
}

const VIEW_ITEMS: { key: WorkspaceView; label: string; icon: typeof BookOpenText; group?: string }[] = [
  { key: 'read', label: '阅读与编辑', icon: BookOpenText },
  { key: 'volume', label: '分卷总结', icon: ScrollText, group: '整理与记录' },
  { key: 'diary', label: '角色日记', icon: NotebookPen, group: '整理与记录' },
  { key: 'diy', label: '自定义记录', icon: PenLine, group: '整理与记录' },
  { key: 'tree', label: '故事树', icon: Network, group: '整理与记录' },
  { key: 'io', label: '导入与导出', icon: ArrowDownUp },
];

function parseQueryFloor(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

const StoryWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { isCompact } = useViewport();
  const [story, setStory] = useState<ArchiveStory | null>(null);
  const [character, setCharacter] = useState<ArchiveCharacter | null>(null);
  const [siblingStories, setSiblingStories] = useState<ContextStoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRetry, setLoadRetry] = useState(0);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [spotlightFloor, setSpotlightFloor] = useState<number | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(readInitialRailCollapsed);

  const toggleRailCollapsed = useCallback((next: boolean) => {
    setRailCollapsed(next);
    try {
      if (next) localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, '1');
      else localStorage.removeItem(RAIL_COLLAPSED_STORAGE_KEY);
    } catch { /* non-critical preference */ }
  }, []);

  const locationState = location.state as StoryWorkspaceLocationState | null;
  const latestLocationStateRef = useRef(locationState);
  latestLocationStateRef.current = locationState;
  const latestSearchParamsRef = useRef(searchParams);
  latestSearchParamsRef.current = searchParams;
  const queryView = searchParams.get('view');
  const [view, setView] = useState<WorkspaceView>(() => {
    return parseEditorStoryView(queryView ?? locationState?.view) ?? 'read';
  });
  const initialTarget = locationState?.view === view ? locationState.initialTarget : undefined;
  const [novelOpen, setNovelOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [playBusy, setPlayBusy] = useState(false);
  const playBusyRef = useRef(false);
  const workbenchRef = useRef<ChatWorkbenchHandle>(null);
  const roleplaySession = useRoleplaySessionState();
  const isLiveInDetachedTavern = Boolean(roleplaySession.detached && id && roleplaySession.openChat?.id === id);

  useEffect(() => {
    const stateView = (location.state as StoryWorkspaceLocationState | null)?.view;
    const requestedView = searchParams.get('view') ?? stateView;
    const parsedView = parseEditorStoryView(requestedView);
    if (parsedView) {
      setView(parsedView);
      if (!searchParams.get('view') && stateView) {
        setSearchParams((current) => {
          current.set('view', stateView);
          return current;
        }, { replace: true, state: location.state });
      }
    }
  }, [location.state, searchParams, setSearchParams]);

  const changeView = useCallback((next: WorkspaceView) => {
    setView(next);
    setSearchParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set('view', next);
      copy.delete('floor');
      return copy;
    }, { replace: true });
  }, [setSearchParams]);
  const changeSummaryKind = useCallback((kind: SummarySurfaceKind) => changeView(kind), [changeView]);

  useEffect(() => {
    if (id && isSummarySurfaceKind(view)) setEditorSummaryKind(id, view);
  }, [id, view]);

  useEffect(() => {
    if (spotlightFloor === null) return;
    const timer = setTimeout(() => setSpotlightFloor(null), 3500);
    return () => clearTimeout(timer);
  }, [spotlightFloor]);

  const storyRef = useRef<ArchiveStory | null>(null);
  const saverRef = useRef(new StoryDraftSaver(updateArchiveStory));
  const mutateStory = useCallback((fn: (cur: ArchiveStory) => ArchiveStory) => {
    const current = storyRef.current;
    if (!current) return;
    const next = fn(current);
    if (next === current) return;
    storyRef.current = next;
    saverRef.current.queueMutation(current.id, (latest) => fn(latest));
    setStory(next);
  }, []);

  useEffect(() => {
    if (!story || !saverRef.current.isDirty()) return;
    const t = setTimeout(() => {
      void saverRef.current.flush().catch((error: unknown) => {
        toastRef.current({
          title: '保存故事未成功',
          description: error instanceof Error ? error.message : '请检查文件库目录是否可写后重试',
          variant: 'destructive',
        });
      });
    }, 600);
    return () => clearTimeout(t);
  }, [story]);
  useEffect(() => () => {
    void saverRef.current.flush().catch((error: unknown) => {
      toastRef.current({
        title: '离开页面时保存故事未成功',
        description: error instanceof Error ? error.message : '请重新打开故事检查最新改动',
        variant: 'destructive',
      });
    });
  }, []);

  useEffect(() => {
    if (!isLiveInDetachedTavern || !id) return undefined;
    let alive = true;
    const syncLatest = () => {
      const epoch = getVaultEpoch();
      void getArchiveStory(id)
        .then((latest) => {
          if (!alive || !latest || epoch !== getVaultEpoch()) return;
          storyRef.current = latest;
          setStory(latest);
        })
        .catch((err) => {
          console.warn('[StoryWorkspace] 实时同步独立窗口最新楼层未成功:', err);
        });
    };
    syncLatest();
    const off = subscribeRecordChanges((change) => {
      if (change.store === 'archiveStories' && change.id === id) syncLatest();
    });
    return () => {
      alive = false;
      off();
    };
  }, [id, isLiveInDetachedTavern]);

  // 加载故事 + 角色；记录 lastViewedAt（排序依据，不动 updatedAt）
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const epoch = getVaultEpoch();
    let loadedSaver: StoryDraftSaver | undefined;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const s = await getArchiveStory(id);
        if (cancelled || epoch !== getVaultEpoch()) return;
        if (!s) {
          storyRef.current = null;
          setStory(null);
          return;
        }
        setEditorStoryId(s.id);
        const navState = latestLocationStateRef.current;
        const params = latestSearchParamsRef.current;
        const hasBranchQuery = params.has('branch');
        const requestedBranchId = hasBranchQuery
          ? (params.get('branch') || null)
          : navState?.branchId;
        const restoredBranchId = resolveInitialBranchId(s, requestedBranchId);
        setBranchId(restoredBranchId);
        const viewedAt = Date.now();
        const viewPatch = (current: ArchiveStory) => ({
          settings: current.settings ?? getDefaultExportSettings(),
          lastViewedAt: viewedAt,
          lastViewedBranchId: restoredBranchId ?? undefined,
        });
        loadedSaver = new StoryDraftSaver((storyId, mutation) => {
          if (epoch !== getVaultEpoch()) return Promise.reject(new Error('文件库已切换，已停止保存原故事'));
          return updateArchiveStory(storyId, mutation);
        });
        saverRef.current = loadedSaver;
        saverRef.current.queueMutation(s.id, viewPatch);
        let withView: ArchiveStory = { ...s, ...viewPatch(s) };
        const sourceFloor = parseQueryFloor(params.get('floor')) ?? navState?.sourceFloor;
        const sourceLine = getBranchLine(withView, restoredBranchId);
        if (Number.isSafeInteger(sourceFloor) && sourceFloor! >= 0 && sourceLine && sourceFloor! < sourceLine.session.messages.length) {
          withView = updateBranchLine(withView, restoredBranchId, { lastFloor: sourceFloor });
          saverRef.current.queueMutation(s.id, (cur) => updateBranchLine(cur, restoredBranchId, { lastFloor: sourceFloor }));
          setSpotlightFloor(sourceFloor!);
        } else {
          setSpotlightFloor(null);
        }
        storyRef.current = withView;
        setStory(withView);
        setLoading(false);
        if (withView.characterId) {
          const charId = withView.characterId;
          const [c, allStoryIdx] = await Promise.all([
            getCharacter(charId).catch(() => null),
            listStoryIndex().catch(() => []),
          ]);
          if (!cancelled) {
            setCharacter(c ?? null);
            setSiblingStories(
              allStoryIdx
                .filter((entry) => entry.characterId === charId)
                .map((entry) => ({ id: entry.id, title: entry.title })),
            );
          }
        } else {
          setCharacter(null);
          setSiblingStories([]);
        }
      } catch (error) {
        if (!cancelled && epoch === getVaultEpoch()) {
          storyRef.current = null;
          setStory(null);
          const msg = error instanceof Error ? error.message : '请检查文件库目录是否可读后重试';
          setLoadError(msg);
          toastRef.current({
            title: '读取故事失败',
            description: msg,
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void loadedSaver?.flush().catch((error: unknown) => {
        toastRef.current({
          title: '切换故事时保存改动未成功',
          description: error instanceof Error ? error.message : '请重新打开原故事检查最新改动',
          variant: 'destructive',
        });
      });
    };
  }, [id, loadRetry]);

  // 同故事 id 下通过导航传入新的 branch / floor 时原地定位，不重拉磁盘覆盖未保存草稿
  useEffect(() => {
    const current = storyRef.current;
    if (!current || current.id !== id) return;
    const hasBranchQuery = searchParams.has('branch');
    const requestedBranch = hasBranchQuery
      ? (searchParams.get('branch') || null)
      : locationState?.branchId;
    const nextBranch = requestedBranch !== undefined
      ? resolveInitialBranchId(current, requestedBranch)
      : branchId;
    if (nextBranch !== branchId) setBranchId(nextBranch);
    const sf = parseQueryFloor(searchParams.get('floor')) ?? locationState?.sourceFloor;
    const targetLine = getBranchLine(current, nextBranch);
    if (Number.isSafeInteger(sf) && sf! >= 0 && targetLine && sf! < targetLine.session.messages.length) {
      if (targetLine.lastFloor !== sf) {
        mutateStory((cur) => updateBranchLine(cur, nextBranch, { lastFloor: sf }));
      }
      setSpotlightFloor(sf!);
      setTimeout(() => workbenchRef.current?.scrollToFloor(sf!), 120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, location.key]);

  const line = story ? getBranchLine(story, branchId) : undefined;

  const handleSessionChange = useCallback((next: ChatSession) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => {
      let updated = updateBranchLine(cur, branchId, { session: next });
      if (branchId === null && next.title && next.title !== cur.title) {
        updated = { ...updated, title: next.title };
      }
      return updated;
    });
  }, [isLiveInDetachedTavern, mutateStory, branchId]);

  const handleMarkersChange = useCallback((next: ArchiveStory['markers']) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => updateBranchLine(cur, branchId, { markers: next }));
  }, [isLiveInDetachedTavern, mutateStory, branchId]);

  const handleFavoritesChange = useCallback((next: string[]) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => updateBranchLine(cur, branchId, { favorites: next }));
  }, [isLiveInDetachedTavern, mutateStory, branchId]);

  const handleFloorChange = useCallback((floor: number) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => updateBranchLine(cur, branchId, { lastFloor: floor }));
  }, [isLiveInDetachedTavern, mutateStory, branchId]);

  const handleSettingsChange = useCallback((next: NonNullable<ArchiveStory['settings']>) => {
    mutateStory((cur) => {
      const prev = cur.settings ?? getDefaultExportSettings();
      if (!hasNonAppearanceSettingsChange(prev, next)) {
        return { ...cur, settings: next };
      }
      return { ...cur, settings: next, updatedAt: Date.now() };
    });
  }, [mutateStory]);

  const handleSwitchBranch = useCallback((nextBranchId: string | null) => {
    setSpotlightFloor(null);
    setBranchId(nextBranchId);
    setSearchParams((current) => {
      if (!current.has('branch') && !current.has('floor')) return current;
      const copy = new URLSearchParams(current);
      if (copy.has('branch')) copy.set('branch', nextBranchId ?? '');
      copy.delete('floor');
      return copy;
    }, { replace: true });
    mutateStory((cur) => {
      if ((cur.lastViewedBranchId ?? null) === nextBranchId) return cur;
      return { ...cur, lastViewedBranchId: nextBranchId ?? undefined };
    });
  }, [mutateStory, setSearchParams]);

  const jumpFromRecordToFloor = useCallback((targetFloor: number, targetBranchId?: string | null) => {
    const current = storyRef.current;
    if (!current) return;
    const resolvedBranch = targetBranchId !== undefined
      ? resolveInitialBranchId(current, targetBranchId)
      : branchId;
    if (resolvedBranch !== branchId) {
      setBranchId(resolvedBranch);
    }
    const targetLine = getBranchLine(current, resolvedBranch);
    const clamped = targetLine && targetLine.session.messages.length > 0
      ? Math.min(Math.max(0, targetFloor), targetLine.session.messages.length - 1)
      : Math.max(0, targetFloor);
    mutateStory((cur) => updateBranchLine(cur, resolvedBranch, { lastFloor: clamped }));
    setSpotlightFloor(clamped);
    setView('read');
    setSearchParams((prev) => {
      const copy = new URLSearchParams(prev);
      copy.set('view', 'read');
      if (copy.has('branch') || targetBranchId !== undefined) {
        copy.set('branch', resolvedBranch ?? '');
      }
      copy.delete('floor');
      return copy;
    }, { replace: true });
    setTimeout(() => workbenchRef.current?.scrollToFloor(clamped), 180);
  }, [branchId, mutateStory, setSearchParams]);

  const handleImportBranch = async (files: FileList | null) => {
    if (isLiveInDetachedTavern || !files || files.length === 0 || !story) return;
    let ok = 0;
    let fail = 0;
    let lastId: string | null = null;
    const newBranches = [] as NonNullable<ArchiveStory['branches']>;
    for (const file of Array.from(files)) {
      try {
        const content = await file.text();
        const isJsonl = file.name.endsWith('.jsonl') || content.trim().split('\n').length > 1;
        const { messages, metadata } = isJsonl ? parseJsonl(content) : parseJson(content);
        if (messages.length === 0) throw new Error('empty');
        const session: ChatSession = {
          id: crypto.randomUUID(),
          title: file.name.replace(/\.(jsonl|json)$/i, ''),
          messages,
          character: { name: metadata?.character_name || story.session.character.name },
          user: { name: metadata?.user_name || story.session.user.name },
          createdAt: Date.now(),
          rawMetadata: metadata,
        };
        const branch = buildBranchFromSession(session, session.title);
        newBranches.push(branch);
        lastId = branch.id;
        ok++;
      } catch {
        fail++;
      }
    }
    if (newBranches.length > 0) {
      mutateStory((cur) => ({
        ...cur,
        branches: [...(cur.branches ?? []), ...newBranches],
        updatedAt: Date.now(),
      }));
      handleSwitchBranch(lastId);
    }
    toast({ title: `导入分支：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}` });
  };

  const handleRenameBranch = (bid: string, name: string) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => ({
      ...cur,
      branches: (cur.branches ?? []).map((b) => (b.id === bid ? { ...b, name, updatedAt: Date.now() } : b)),
      updatedAt: Date.now(),
    }));
  };

  const handleDeleteBranch = (bid: string) => {
    if (isLiveInDetachedTavern) return;
    mutateStory((cur) => ({
      ...cur,
      branches: (cur.branches ?? []).filter((b) => b.id !== bid),
      updatedAt: Date.now(),
    }));
    if (branchId === bid) handleSwitchBranch(null);
    toast({ title: '分支已删除' });
  };

  const handleBind = (c: ArchiveCharacter) => {
    mutateStory((cur) => ({ ...cur, characterId: c.id, updatedAt: Date.now() }));
    setCharacter(c);
    toast({ title: `已绑定到「${c.name}」`, description: '故事与已生成的总结/故事树一并归入该角色名下' });
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">{LOADING_LABEL}</div>
      </AppLayout>
    );
  }

  if (loadError) {
    return (
      <AppLayout>
        <div role="alert" className="flex flex-col min-h-[50vh] items-center justify-center gap-3 text-center px-4">
          <BookOpen className="w-12 h-12 text-muted-foreground/50" />
          <p className="text-sm text-destructive">读取故事失败：{loadError}</p>
          <p className="text-xs text-muted-foreground">这不是故事被删了，数据仍保存在库里，请重试读取。</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLoadRetry((v) => v + 1)}>重试读取</Button>
            <Button variant="ghost" onClick={() => navigate('/library')}>返回角色库</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!story || !line) {
    return (
      <AppLayout>
        <div className="flex flex-col min-h-[50vh] items-center justify-center gap-4">
          <BookOpen className="w-16 h-16 text-muted-foreground/50" />
          <p className="text-muted-foreground">找不到该故事</p>
          <Button onClick={() => navigate('/library')}>返回角色库</Button>
        </div>
      </AppLayout>
    );
  }

  const settings = applyGlobalAppearanceToSettings(
    normalizeAppearanceSettings(story.settings ?? getDefaultExportSettings()),
  );
  const backTarget = story.characterId ? `/character/${story.characterId}` : '/chat';
  const backLabel = character?.displayMeta?.name || character?.name || (story.characterId ? '角色详情' : '聊天处理');
  const organizeView = isOrganizeWorkspaceView(view);
  const showWideRail = !organizeView && !isCompact && !railCollapsed;
  const showContextBar = organizeView || isCompact || railCollapsed;

  const characterAvatarUrl = character?.pngBase64
    ? `data:image/png;base64,${character.pngBase64}`
    : undefined;

  const viewNav = (
    <nav className="space-y-0.5">
      {VIEW_ITEMS.map((item, i) => {
        const Icon = item.icon;
        const active = view === item.key;
        const groupStart = item.group && VIEW_ITEMS[i - 1]?.group !== item.group;
        const groupEnd = !item.group && VIEW_ITEMS[i - 1]?.group;
        return (
          <div key={item.key}>
            {groupStart && (
              <p className="px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground/80">{item.group}</p>
            )}
            {groupEnd && <div className="pt-1" />}
            <button
              type="button"
              onClick={() => changeView(item.key)}
              className={cn(
                'w-full flex items-center gap-2 rounded-md text-sm transition-colors',
                isCompact ? 'px-2.5 py-2.5' : 'px-2 py-1.5',
                item.group && (isCompact ? 'pl-4' : 'pl-3'),
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );

  const storyContext = view === 'read' ? (
    <>
      <BranchPanel
        story={story}
        activeBranchId={branchId}
        readOnly={isLiveInDetachedTavern}
        onSwitch={handleSwitchBranch}
        onImportBranch={handleImportBranch}
        onRenameBranch={handleRenameBranch}
        onDeleteBranch={handleDeleteBranch}
      />
      <Separator />
      <OutlinePanel
        session={line.session}
        markers={line.markers}
        favorites={line.favorites}
        onJump={(mid) => workbenchRef.current?.scrollToMessageId(mid)}
      />
    </>
  ) : null;

  const runContinuePlay = async () => {
    if (isLiveInDetachedTavern) {
      focusDetachedTavernWindow();
      return;
    }
    if (playBusyRef.current) return;
    playBusyRef.current = true;
    setPlayBusy(true);
    const epoch = getVaultEpoch();
    const reservation = preopenDetachedTavernWindow();
    try {
      await saverRef.current.flush();
      const { prepareStoryPlay } = await import('@/lib/roleplay/open-story');
      const target = await prepareStoryPlay(story.id, branchId);
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
        title: '保存未完成，暂未进入聊天',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      playBusyRef.current = false;
      setPlayBusy(false);
    }
  };

  return (
    <AppLayout
      mobileDrawer={isCompact ? (
        <div>
          <p className="px-2 pb-1 text-[11px] text-[color:var(--text-muted)]">当前故事</p>
          {viewNav}
          {!story.characterId && (
            <div className="mt-2 border-t border-[color:var(--border-subtle)] px-2 pt-2.5">
              <Badge variant="outline" className="h-5 text-[11px] text-muted-foreground">未绑定</Badge>
              <Button variant="outline" size="sm" className="mt-1.5 w-full text-xs" onClick={() => setBindOpen(true)}>
                <Link2 className="w-3.5 h-3.5 mr-1" />
                绑定到角色
              </Button>
            </div>
          )}
        </div>
      ) : undefined}
      mobileContextDrawer={isCompact && storyContext ? {
        title: story.title,
        description: `${line.session.messages.length} 楼 · 分支、章节与书签`,
        content: <div className="space-y-4">{storyContext}</div>,
      } : undefined}
    >
      <div className={organizeView ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'flex flex-col'}>
        {showContextBar && (
          <OrganizeContextBar
            storyTitle={story.title}
            backLabel={backLabel}
            onBack={() => navigate(backTarget)}
            onRead={() => changeView('read')}
            hideReadAction={view === 'read'}
            onExpandRail={!organizeView && !isCompact && railCollapsed ? () => toggleRailCollapsed(false) : undefined}
            currentStoryId={story.id}
            stories={siblingStories}
            onSelectStory={(targetStoryId) => {
              void (async () => {
                try {
                  await saverRef.current.flush();
                  navigate(view === 'read' ? buildStoryReadPath(targetStoryId) : buildEditorStoryPath(targetStoryId, view));
                } catch (error) {
                  toast({
                    title: '当前故事尚未保存成功，已取消切换',
                    description: error instanceof Error ? error.message : '请检查文件库目录是否可写后重试',
                    variant: 'destructive',
                  });
                }
              })();
            }}
            currentBranchId={branchId}
            branches={(story.branches ?? []).map((b) => ({ id: b.id, name: b.name }))}
            onSelectBranch={handleSwitchBranch}
          />
        )}

        <div className={organizeView ? 'min-h-0 min-w-0 flex-1' : 'flex items-start flex-wrap'}>
          {showWideRail && (
            <aside className="w-56 basis-56 shrink-0 grow-0 border-r border-border bg-card/40 sticky top-0 max-h-[calc(100vh-62px)] overflow-y-auto overscroll-contain p-3 space-y-4">
              <div>
                <div className="flex items-center justify-between gap-1">
                  <Button variant="ghost" size="sm" className="px-1.5 -ml-1 text-muted-foreground min-w-0" onClick={() => navigate(backTarget)}>
                    <ArrowLeft className="w-4 h-4 mr-1 shrink-0" />
                    <span className="truncate">{backLabel}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => toggleRailCollapsed(true)}
                    aria-label="收起故事目录栏"
                    title="收起左侧目录栏，让正文铺得更宽"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </Button>
                </div>
                <p className="font-display font-semibold text-sm mt-1 px-1.5 break-words">{story.title}</p>
                <p className="text-xs text-muted-foreground px-1.5 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    {line.session.messages.length} 楼
                  </span>
                  {story.meta.lastModel && (
                    <span className="flex items-center gap-1 min-w-0">
                      <Cpu className="w-3 h-3 shrink-0" />
                      <span className="truncate" title={story.meta.lastModel}>{story.meta.lastModel}</span>
                    </span>
                  )}
                </p>
                {!story.characterId && (
                  <div className="px-1.5 mt-2 space-y-1.5">
                    <Badge variant="outline" className="h-5 text-[11px] text-muted-foreground">未绑定</Badge>
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setBindOpen(true)}>
                      <Link2 className="w-3.5 h-3.5 mr-1" />
                      绑定到角色
                    </Button>
                  </div>
                )}
              </div>

              {viewNav}

              {storyContext && (
                <>
                  <Separator />
                  {storyContext}
                </>
              )}
            </aside>
          )}

          <div className={cn(
            organizeView ? 'h-full min-h-0 min-w-0 flex-1' : 'flex-1',
            !organizeView && (isCompact ? 'min-w-0' : 'min-w-[24rem]'),
          )}>
            {view === 'read' && (
              <div className="flex items-start flex-wrap">
                <div className={cn('flex-1', isCompact ? 'min-w-0' : 'min-w-[20rem]')}>
                  {isLiveInDetachedTavern && (
                    <div
                      role="status"
                      data-detached-sync-banner
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--brand-hairline)] bg-[var(--brand-active-bg)] px-4 py-2 text-xs text-[color:var(--text-primary)]"
                    >
                      <span>当前故事正在独立酒馆窗口对话中 · 已开启实时同步回看（暂锁正文编辑以防两边冲突）</span>
                      <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => { focusDetachedTavernWindow(); }}>
                        <ExternalLink className="w-3.5 h-3.5 mr-1" />聚焦酒馆窗口
                      </Button>
                    </div>
                  )}
                  <ChatWorkbench
                    readerMode={isLiveInDetachedTavern}
                    recordContext={{ storyId: story.id, branchId, flush: () => saverRef.current.flush() }}
                    characterId={story.characterId}
                    characterAvatarUrl={characterAvatarUrl}
                    highlightedFloor={spotlightFloor}
                    key={branchId ?? 'trunk'}
                    ref={workbenchRef}
                    session={line.session}
                    markers={line.markers}
                    favorites={line.favorites}
                    settings={settings}
                    onSessionChange={handleSessionChange}
                    onMarkersChange={handleMarkersChange}
                    onFavoritesChange={handleFavoritesChange}
                    onSettingsChange={handleSettingsChange}
                    onFloorChange={handleFloorChange}
                    initialFloor={line.lastFloor}
                    titleBadge={
                      branchId !== null ? (
                        <Badge variant="secondary" className="shrink-0">
                          分支：{story.branches?.find((b) => b.id === branchId)?.name}
                        </Badge>
                      ) : undefined
                    }
                    toolbarExtras={
                      <>
                        {story.characterId && (
                          <Button
                            size="sm"
                            disabled={playBusy}
                            onClick={() => { void runContinuePlay(); }}
                            title="接着当前剧情进入酒馆继续聊"
                          >
                            <MessageSquare className="w-4 h-4 mr-1.5" />
                            {isLiveInDetachedTavern ? '聚焦酒馆窗口' : '继续聊天'}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => setNovelOpen(true)} title="小说视图：拆句重排+用户楼层弱化/隐藏+单栏或双页阅读（Esc 退出）">
                          <BookOpenCheck className="w-4 h-4 mr-1.5" />
                          小说视图
                        </Button>
                      </>
                    }
                  />
                </div>
              </div>
            )}

            {isSummarySurfaceKind(view) && (
              <SummaryWorkspace
                story={story}
                characterName={character?.displayMeta?.name || character?.name}
                currentBranchId={branchId}
                kind={view}
                initialTarget={initialTarget}
                onKindChange={changeSummaryKind}
                onJumpToFloor={jumpFromRecordToFloor}
              />
            )}

            {view === 'tree' && (
              <StoryTreeWorkspace
                story={story}
                currentBranchId={branchId}
                initialTarget={initialTarget}
                onJumpToFloor={jumpFromRecordToFloor}
              />
            )}

            {view === 'io' && (
              <IOPanel
                story={story}
                branchId={branchId}
                line={line}
                settings={settings}
                readOnly={isLiveInDetachedTavern}
                onStoryUpdate={mutateStory}
              />
            )}
          </div>
        </div>
      </div>

      {!isLiveInDetachedTavern && <STUpdateHint story={story} onStoryUpdate={mutateStory} />}
      <BindStoryDialog open={bindOpen} onOpenChange={setBindOpen} onSelect={handleBind} />

      {novelOpen && (
        <NovelView
          session={line.session}
          markers={line.markers}
          regexRules={settings.regexRules}
          onClose={() => setNovelOpen(false)}
          onMarkersChange={isLiveInDetachedTavern ? undefined : handleMarkersChange}
          favorites={line.favorites}
          onFavoritesChange={isLiveInDetachedTavern ? undefined : handleFavoritesChange}
          initialFloor={line.lastFloor}
          onFloorChange={handleFloorChange}
          progressKey={`${story.id}:${branchId ?? 'main'}`}
          polish={isLiveInDetachedTavern ? undefined : { story, branchId }}
          renderTopActions={story.characterId ? () => (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              disabled={playBusy}
              onClick={() => { void runContinuePlay(); }}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {isLiveInDetachedTavern ? '聚焦酒馆窗口' : '继续聊天'}
            </Button>
          ) : undefined}
        />
      )}
    </AppLayout>
  );
};

export default StoryWorkspace;
