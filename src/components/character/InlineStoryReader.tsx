/**
 * 就地阅读（10.3b，对照 character-detail.html）：在角色页故事 tab 内打开正文。
 * - 顶部：返回故事列表 + 故事名下拉切换（含分支）+ 状态 chip + 「继续聊天 / 从当前楼开支线 / 在编辑器中打开」
 * - 正文：ChatWorkbench readerMode（保留 外观/搜索/楼层跳转/正则/导出/小说视图/每楼支线与名场面收录）
 * - 持久化沿用工作区模式：dirty+防抖 600ms，卸载兜底补存；lastViewedAt/lastFloor 照记
 */
import { forwardRef, useImperativeHandle, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { ArrowLeft, BookOpenCheck, ChevronDown, ExternalLink, GitBranch, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChatWorkbench, type ChatWorkbenchHandle } from '@/components/chat/ChatWorkbench';
import NovelView from '@/components/reader/NovelView';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import {
  getArchiveStory, updateArchiveStory, getBranchLine, updateBranchLine, resolveInitialBranchId,
} from '@/lib/archive-db';
import { getDefaultExportSettings, normalizeAppearanceSettings } from '@/lib/session-storage';
import { StoryDraftSaver, flushBeforeStoryTransition } from '@/lib/story-draft-save';
import { useToast } from '@/hooks/use-toast';
import { useViewport } from '@/hooks/use-viewport';
import { cn } from '@/lib/utils';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { getVaultEpoch } from '@/lib/vault/active';

export interface FloorJumpRequest {
  floor: number;
  seq: number;
}

interface InlineStoryReaderProps {
  storyId: string;
  /** 同角色下的全部故事（下拉切换用，按展示序） */
  stories: Pick<ArchiveStory, 'id' | 'title'>[];
  onSwitchStory: (id: string) => void;
  onBack: () => void;
  /** 返回按钮可见文案（默认「故事列表」，从总结/日记/故事树跳入时可显示「返回总结」等） */
  backLabel?: string;
  /** 「在编辑器中打开」→ /story/:id */
  onOpenEditor: (id: string) => void;
  /** 保存阅读变更后继续当前主线或分支的聊天。 */
  onOpenChat?: (id: string, branchId: string | null) => void;
  /** 从指定楼层分叉新支线并直接开启续聊 */
  onBranchChatFromFloor?: (id: string, branchId: string | null, floor: number, messageId?: string | null) => void;
  /** 收录角色语录后同步父页角色状态 */
  onCharacterUpdated?: (character: ArchiveCharacter) => void;
  /** 进入时直接打开的分支（null=显式打开主线，string=指定支线，undefined=恢复上次看的脉络） */
  initialBranchId?: string | null;
  /** 一次性楼层定位请求（从分卷总结/日记/故事树点击跳入，消费后不会锁死后续滚动） */
  jumpRequest?: FloorJumpRequest | null;
  /** 回顾视图等待正文布局完成后恢复楼内像素位置。 */
  onReadyChange?: (ready: boolean) => void;
  restoreFloor?: boolean;
}

export interface InlineStoryReaderHandle { flushPendingSave: () => Promise<void> }

function createReaderSaver() {
  const epoch = getVaultEpoch();
  return new StoryDraftSaver((id, mutation) => {
    if (epoch !== getVaultEpoch()) return Promise.reject(new Error('文件库已切换，已停止保存原故事'));
    return updateArchiveStory(id, mutation);
  });
}

export const InlineStoryReader = forwardRef<InlineStoryReaderHandle, InlineStoryReaderProps>(function InlineStoryReader({
  storyId,
  stories,
  onSwitchStory,
  onBack,
  backLabel = '故事列表',
  onOpenEditor,
  onOpenChat,
  onBranchChatFromFloor,
  onCharacterUpdated,
  initialBranchId,
  jumpRequest = null,
  onReadyChange,
  restoreFloor = true,
}, ref) {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { isCompact } = useViewport();
  const [story, setStory] = useState<ArchiveStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [novelOpen, setNovelOpen] = useState(false);
  const [spotlightMessageId, setSpotlightMessageId] = useState<string | null>(null);
  const [visibleRawFloor, setVisibleRawFloor] = useState<number>(0);
  const workbenchRef = useRef<ChatWorkbenchHandle>(null);
  const consumedJumpSeqRef = useRef<number>(-1);

  const readerHeaderRef = useRef<HTMLDivElement>(null);
  const [readerHeaderHeight, setReaderHeaderHeight] = useState(0);
  const initialReaderMounted = useRef(false);

  useLayoutEffect(() => {
    if (!loading && story) initialReaderMounted.current = true;
  }, [loading, story]);

  useLayoutEffect(() => {
    if (!onReadyChange) return;
    onReadyChange(false);
    let layoutFrame = 0;
    let readyFrame = 0;
    if (!loading && story?.id === storyId) {
      layoutFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => onReadyChange(true));
      });
    }
    return () => {
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(readyFrame);
      onReadyChange(false);
    };
  }, [loading, story?.id, storyId, onReadyChange]);

  useLayoutEffect(() => {
    const header = readerHeaderRef.current;
    if (!header) return;
    const measure = () => setReaderHeaderHeight(header.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [storyId, loading]);

  const storyRef = useRef<ArchiveStory | null>(null);
  const saverRef = useRef(createReaderSaver());
  useImperativeHandle(ref, () => ({ flushPendingSave: () => saverRef.current.flush() }), []);
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
          title: '保存故事失败',
          description: error instanceof Error ? error.message : '请检查库目录是否可写',
          variant: 'destructive',
        });
      });
    }, 600);
    return () => clearTimeout(t);
  }, [story]);
  useEffect(() => () => {
    void saverRef.current.flush().catch((error: unknown) => {
      toastRef.current({
        title: '离开阅读器时保存进度未成功',
        description: error instanceof Error ? error.message : '请检查文件库目录是否可写',
        variant: 'destructive',
      });
    });
  }, []);

  // 加载 + 记 lastViewedAt（切换故事 id 或显式脉络请求时重挂）
  useEffect(() => {
    let cancelled = false;
    let loadedSaver: StoryDraftSaver | undefined;
    const epoch = getVaultEpoch();
    const isCurrent = () => !cancelled && epoch === getVaultEpoch();
    setLoading(true);
    setLoadError(null);
    setStory(null);
    storyRef.current = null;
    (async () => {
      try {
        const s = await getArchiveStory(storyId);
        if (!isCurrent()) return;
        if (!s) {
          storyRef.current = null;
          setStory(null);
          return;
        }
        const restoredBranchId = resolveInitialBranchId(s, initialBranchId);
        setBranchId(restoredBranchId);
        const restoredLine = getBranchLine(s, restoredBranchId);
        setVisibleRawFloor(restoredLine?.lastFloor ?? 0);
        const viewedAt = Date.now();
        const viewPatch = (current: ArchiveStory) => ({
          settings: current.settings ?? getDefaultExportSettings(),
          lastViewedAt: viewedAt,
          lastViewedBranchId: restoredBranchId ?? undefined,
        });
        loadedSaver = createReaderSaver();
        saverRef.current = loadedSaver;
        saverRef.current.queueMutation(s.id, viewPatch);
        const withView = { ...s, ...viewPatch(s) };
        storyRef.current = withView;
        setStory(withView);
      } catch (error) {
        if (isCurrent()) {
          setLoadError(error instanceof Error ? error.message : '请稍后重试');
          toastRef.current({
            title: '读取故事失败',
            description: error instanceof Error ? error.message : '请稍后重试',
            variant: 'destructive',
          });
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void loadedSaver?.flush().catch((error: unknown) => {
        toastRef.current({
          title: '切换故事时保存改动未成功',
          description: error instanceof Error ? error.message : '请检查文件库目录是否可写',
          variant: 'destructive',
        });
      });
    };
  }, [storyId, initialBranchId, retry]);

  // 消费单次外部楼层定位请求：按稳定 messageId 定位与高亮，且消费后绝不随滚动重触发
  useEffect(() => {
    if (!jumpRequest || loading || !storyRef.current || storyRef.current.id !== storyId) return;
    if (consumedJumpSeqRef.current === jumpRequest.seq) return;
    const currentLine = getBranchLine(storyRef.current, branchId);
    if (!currentLine) return;
    consumedJumpSeqRef.current = jumpRequest.seq;

    const msgs = currentLine.session.messages;
    if (msgs.length === 0) return;
    const clamped = Math.min(Math.max(0, Math.trunc(jumpRequest.floor)), msgs.length - 1);
    const targetMsg = msgs.slice(clamped).find((m) => m.content.trim().length > 0) ?? msgs[clamped];
    const targetId = targetMsg?.id ?? null;
    setSpotlightMessageId(targetId);
    setVisibleRawFloor(clamped);

    const jumpTimer = setTimeout(() => {
      if (targetId) workbenchRef.current?.scrollToMessageId(targetId);
      else workbenchRef.current?.scrollToFloor(clamped);
    }, 180);
    const clearTimer = setTimeout(() => {
      setSpotlightMessageId((cur) => (cur === targetId ? null : cur));
    }, 3200);
    return () => {
      clearTimeout(jumpTimer);
      clearTimeout(clearTimer);
    };
  }, [jumpRequest, loading, storyId, branchId]);

  const transitionAfterFlush = useCallback(async (transition: () => void) => {
    try {
      await flushBeforeStoryTransition(saverRef.current, transition);
    } catch (error) {
      toast({
        title: '故事尚未保存，已取消离开',
        description: error instanceof Error ? error.message : '请检查库目录是否可写后重试',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const line = story ? getBranchLine(story, branchId) : undefined;

  const handleFavoritesChange = useCallback((next: string[]) => {
    mutateStory((cur) => updateBranchLine(cur, branchId, { favorites: next }));
  }, [mutateStory, branchId]);

  const handleFloorChange = useCallback((floor: number) => {
    mutateStory((cur) => {
      const curLine = getBranchLine(cur, branchId);
      const msgId = workbenchRef.current?.getCurrentMessageId();
      const rawIdx = msgId && curLine
        ? curLine.session.messages.findIndex((m) => m.id === msgId)
        : -1;
      setVisibleRawFloor(rawIdx >= 0 ? rawIdx : floor);
      return updateBranchLine(cur, branchId, { lastFloor: floor });
    });
  }, [mutateStory, branchId]);

  const handleSettingsChange = useCallback((next: NonNullable<ArchiveStory['settings']>) => {
    mutateStory((cur) => ({ ...cur, settings: next, updatedAt: Date.now() }));
  }, [mutateStory]);

  const handleSwitchBranch = useCallback((nextBranchId: string | null) => {
    setSpotlightMessageId(null);
    setBranchId(nextBranchId);
    mutateStory((cur) => {
      if ((cur.lastViewedBranchId ?? null) === nextBranchId) return cur;
      return { ...cur, lastViewedBranchId: nextBranchId ?? undefined };
    });
  }, [mutateStory]);

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">{LOADING_LABEL}</div>;
  }
  if (loadError) {
    return <div role="alert" className="space-y-3 py-12 text-center text-sm">
      <p>读取故事失败：{loadError}。故事仍保留在库中。</p>
      <Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试读取故事</Button>
    </div>;
  }
  if (!story || !line) {
    return (
      <div className="py-16 flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">找不到该故事</p>
        <Button variant="outline" size="sm" onClick={onBack}>{backLabel}</Button>
      </div>
    );
  }

  const settings = normalizeAppearanceSettings(story.settings ?? getDefaultExportSettings());
  const currentBranchName = branchId !== null
    ? story.branches?.find((b) => b.id === branchId)?.name
    : null;

  const triggerTopBranch = () => {
    if (!onBranchChatFromFloor) return;
    const msgId = workbenchRef.current?.getCurrentMessageId() ?? null;
    const rawIdx = msgId ? line.session.messages.findIndex((m) => m.id === msgId) : -1;
    const fallbackFloor = workbenchRef.current?.getCurrentFloor() ?? line.lastFloor ?? (line.session.messages.length - 1);
    const resolvedFloor = rawIdx >= 0 ? rawIdx : fallbackFloor;
    void transitionAfterFlush(() => onBranchChatFromFloor(story.id, branchId, resolvedFloor, msgId));
  };

  const pendingUnconsumedJump = jumpRequest && consumedJumpSeqRef.current !== jumpRequest.seq;

  return (
    <div className="flex flex-col">
      <div ref={readerHeaderRef} data-reader-header className={cn(
        'sticky top-0 z-50 flex items-center gap-2 border-b border-border bg-background/95 py-1.5 backdrop-blur-sm',
        isCompact ? 'flex-nowrap' : 'flex-wrap',
      )}>
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5 shrink-0 text-muted-foreground"
          onClick={() => void transitionAfterFlush(onBack)}
          aria-label="返回故事列表"
          title={`返回${backLabel}`}
        >
          <ArrowLeft className={cn('w-4 h-4', !isCompact && 'mr-1')} />
          {backLabel !== '故事列表' ? (!isCompact && backLabel) : null}
          {backLabel === '故事列表' && <>
            {!isCompact && '故事列表'}
          </>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={cn(
              'font-display font-semibold',
              isCompact ? 'min-w-0 flex-1 justify-start px-1.5' : 'max-w-72',
            )}>
              <span className="truncate" title={story.title}>
                {story.title}
                {currentBranchName ? ` · ${currentBranchName}` : ''}
              </span>
              <ChevronDown className="w-3.5 h-3.5 ml-1 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto min-w-56">
            {isCompact && onBranchChatFromFloor && line.session.messages.length > 0 && (
              <>
                <DropdownMenuItem onClick={triggerTopBranch}>
                  <GitBranch className="w-3.5 h-3.5 mr-1.5 shrink-0 text-primary" />
                  <span>从 #{visibleRawFloor} 楼开支线续聊</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel className="text-xs text-muted-foreground">切换故事与支线</DropdownMenuLabel>
            {stories.map((s) => (
              <div key={s.id}>
                <DropdownMenuItem
                  className={s.id === story.id && branchId === null ? 'bg-primary/10 text-primary' : ''}
                  onClick={() => (
                    s.id === story.id
                      ? handleSwitchBranch(null)
                      : void transitionAfterFlush(() => onSwitchStory(s.id))
                  )}
                >
                  <span className="truncate" title={s.title}>{s.title}</span>
                </DropdownMenuItem>
                {s.id === story.id && (story.branches ?? []).map((b) => (
                  <DropdownMenuItem
                    key={b.id}
                    className={branchId === b.id ? 'bg-primary/10 text-primary pl-6' : 'pl-6'}
                    onClick={() => handleSwitchBranch(b.id)}
                  >
                    <GitBranch className="w-3.5 h-3.5 mr-1.5 shrink-0 opacity-60" />
                    <span className="truncate" title={b.name}>{b.name}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {!isCompact && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal">
            {story.status ?? '未开始'}
          </Badge>
        )}
        {!isCompact && <div className="flex-1" />}
        {onOpenChat && <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void transitionAfterFlush(() => onOpenChat(story.id, branchId))}
          title="接着当前剧情进入酒馆继续聊"
          aria-label="继续聊天"
        >
          <MessageSquare className={cn('w-4 h-4', !isCompact && 'mr-1.5')} />
          {!isCompact && '继续聊天'}
        </Button>}
        {onBranchChatFromFloor && !isCompact && line.session.messages.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={triggerTopBranch}
            title={`保留截止 #${visibleRawFloor} 楼的剧情与设定，拉出一条新平行支线续聊（也可直接点任意楼层右上角的分叉按钮）`}
          >
            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
            从 #{visibleRawFloor} 楼开支线
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void transitionAfterFlush(() => onOpenEditor(story.id))}
          title="进入故事工作区（编辑器）：分支/整理与记录/导入导出"
          aria-label="在编辑器中打开"
        >
          <ExternalLink className={cn('w-4 h-4', !isCompact && 'mr-1.5')} />
          {!isCompact && '在编辑器中打开'}
        </Button>
      </div>

      <div className="border-b border-border" />

      {novelOpen ? (
        <NovelView
          session={line.session}
          markers={line.markers}
          regexRules={settings.regexRules}
          onClose={() => setNovelOpen(false)}
          favorites={line.favorites}
          onFavoritesChange={handleFavoritesChange}
          initialFloor={line.lastFloor}
          onFloorChange={handleFloorChange}
          progressKey={`${story.id}:${branchId ?? 'main'}`}
          embedded
          readOnly
          renderTopActions={({ currentFloor }) => (
            <>
              {onOpenChat && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => void transitionAfterFlush(() => onOpenChat(story.id, branchId))}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  继续聊
                </Button>
              )}
              {onBranchChatFromFloor && line.session.messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => {
                    const msgId = line.session.messages[currentFloor]?.id ?? null;
                    void transitionAfterFlush(() => onBranchChatFromFloor(story.id, branchId, currentFloor, msgId));
                  }}
                  title={`保留截止 #${currentFloor} 楼的剧情与设定，拉出一条新支线续聊`}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  从 #{currentFloor} 楼开支线
                </Button>
              )}
            </>
          )}
        />
      ) : (
        <ChatWorkbench
          key={`${story.id}:${branchId ?? 'trunk'}`}
          ref={workbenchRef}
          characterId={story.characterId}
          onCharacterUpdated={onCharacterUpdated}
          onBranchFromMessage={
            onBranchChatFromFloor
              ? (messageId, rawFloor) => void transitionAfterFlush(() => onBranchChatFromFloor(story.id, branchId, rawFloor, messageId))
              : undefined
          }
          highlightedMessageId={spotlightMessageId}
          session={line.session}
          markers={line.markers}
          favorites={line.favorites}
          settings={settings}
          onFavoritesChange={handleFavoritesChange}
          onSettingsChange={handleSettingsChange}
          onFloorChange={handleFloorChange}
          initialFloor={pendingUnconsumedJump ? undefined : (!initialReaderMounted.current && !restoreFloor ? undefined : line.lastFloor)}
          readerMode
          readerStickyTop={readerHeaderHeight}
          toolbarExtras={
            <Button variant="outline" size="sm" onClick={() => setNovelOpen(true)} title="小说视图：拆句重排+用户楼层弱化/隐藏+场景分隔（Esc 退出）">
              <BookOpenCheck className="w-4 h-4 mr-1.5" />
              小说视图
            </Button>
          }
        />
      )}
    </div>
  );
});
