/**
 * 小说视图：按章节和楼层边界分页的小说排版正文。
 * - 纯文本管道见 lib/novel-view；
 * - 顶栏、AI 章节建议与按章 AI 润色拆至同目录独立子组件。
 */
import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import {
  Feather,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { elementScroll, useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { shouldIgnoreGlobalShortcut } from '@/lib/keyboard-shortcuts';
import {
  buildNovelDocument,
  buildNovelBookmarks,
  findNovelPageIndex,
  paginateNovelDocument,
  normalizeNovelSpreadStart,
  clampNovelPageIndex,
  novelPageCapacity,
  findPageForNovelLocation,
  clampNovelLocation,
  type NovelLocation,
  DEFAULT_NOVEL_OPTIONS,
  type UserFloorMode,
  type NovelChapter,
  type NovelPage,
  type NovelBookmark,
} from '@/lib/novel-view';
import { useViewport } from '@/hooks/use-viewport';
import { useImmersiveLock, useReaderBack } from '@/lib/immersive-mode';
import { MobileReaderSettings, ReaderZoneHint, type ReadingMode } from './MobileReaderSettings';
import { NovelChapterSuggestDialog } from './NovelChapterSuggestDialog';
import { NovelPolishDialog } from './NovelPolishDialog';
import { NovelTopBar } from './NovelTopBar';
import { ShareImage } from './ShareImage';
import type { ChatSession, ChapterMarker, RegexRule } from '@/types/chat';
import type { ArchiveStory } from '@/types/archive';

const OPTS_STORAGE_KEY = 'novel-view-options';
const PROGRESS_STORAGE_KEY = 'novel-view-progress';
const ZONE_HINT_STORAGE_KEY = 'novel-view-zone-hint-seen';
const TOOLBAR_AUTO_HIDE_MS = 3000;
const SCROLL_TEXT_MAX_WIDTH = 672;

export interface NovelViewProps {
  session: ChatSession;
  markers: ChapterMarker[];
  regexRules: RegexRule[];
  onClose: () => void;
  /** 应用 AI 章节建议（不传则隐藏该功能） */
  onMarkersChange?: (next: ChapterMarker[]) => void;
  /** 本地进度记忆键；已绑定故事优先通过 onFloorChange 写入归档 */
  progressKey?: string;
  initialFloor?: number;
  onFloorChange?: (floor: number) => void;
  /** 与工作区现有书签（messageId）联动 */
  favorites?: string[];
  onFavoritesChange?: (next: string[]) => void;
  /** 按章 AI 润色的保存上下文（不传则隐藏润色按钮；未绑定聊天也可传自身归档故事） */
  polish?: { story: ArchiveStory; branchId: string | null };
  /** 只读查看：隐藏会写入章节标记或自定义记录的 AI 操作。 */
  readOnly?: boolean;
  /** 嵌入角色卡页时使用内部阅读面板，不脱离当前页面进入全屏层。 */
  embedded?: boolean;
  /** 顶栏扩展操作（例如从当前楼层续聊 / 拉支线） */
  renderTopActions?: (context: { currentFloor: number; currentMessageId?: string }) => ReactNode;
}

interface StoredOptions {
  userMode: UserFloorMode;
  showHidden: boolean;
  sceneGapMinutes: number;
  fontSize: number;
  readingMode: ReadingMode;
}

const STORED_DEFAULTS: StoredOptions = {
  ...DEFAULT_NOVEL_OPTIONS,
  fontSize: 18,
  readingMode: 'scroll',
};

function loadStoredOptions(): StoredOptions {
  try {
    const raw = localStorage.getItem(OPTS_STORAGE_KEY);
    if (raw) return { ...STORED_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* non-critical preference */ }
  return STORED_DEFAULTS;
}

const NovelView = ({
  session,
  markers,
  regexRules,
  onClose,
  onMarkersChange,
  progressKey,
  initialFloor,
  onFloorChange,
  favorites = [],
  onFavoritesChange,
  polish,
  readOnly = false,
  embedded = false,
  renderTopActions,
}: NovelViewProps) => {
  const { isMobile } = useViewport();
  const [stored] = useState(loadStoredOptions);
  const [userMode, setUserMode] = useState<UserFloorMode>(stored.userMode);
  const [showHidden, setShowHidden] = useState(stored.showHidden);
  const [sceneGap, setSceneGap] = useState(stored.sceneGapMinutes);
  const [fontSize, setFontSize] = useState(stored.fontSize);
  const [readingMode, setReadingMode] = useState<ReadingMode>(stored.readingMode);
  const [currentPage, setCurrentPage] = useState(0);
  const currentPageRef = useRef(0);
  const touchStartX = useRef<number | null>(null);

  const step = isMobile ? 1 : 2;
  const normalizePage = isMobile ? clampNovelPageIndex : normalizeNovelSpreadStart;
  const scrolling = isMobile && readingMode === 'scroll';

  useEffect(() => {
    try {
      localStorage.setItem(OPTS_STORAGE_KEY, JSON.stringify({
        userMode, showHidden, sceneGapMinutes: sceneGap, fontSize, readingMode,
      }));
    } catch { /* non-critical preference */ }
  }, [userMode, showHidden, sceneGap, fontSize, readingMode]);

  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoneHintOpen, setZoneHintOpen] = useState(false);
  const [shareImageOpen, setShareImageOpen] = useState(false);
  const [chapterDialogOpen, setChapterDialogOpen] = useState(false);
  const [polishChapter, setPolishChapter] = useState<NovelChapter | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isMobile || !chromeVisible || settingsOpen || zoneHintOpen || shareImageOpen) {
      clearHideTimer();
      return;
    }
    hideTimerRef.current = window.setTimeout(() => setChromeVisible(false), TOOLBAR_AUTO_HIDE_MS);
    return clearHideTimer;
  }, [isMobile, chromeVisible, settingsOpen, zoneHintOpen, shareImageOpen, clearHideTimer]);

  useEffect(() => {
    if (!isMobile) return;
    try {
      if (!localStorage.getItem(ZONE_HINT_STORAGE_KEY)) setZoneHintOpen(true);
    } catch { /* non-critical preference */ }
  }, [isMobile]);

  const dismissZoneHint = useCallback(() => {
    setZoneHintOpen(false);
    try { localStorage.setItem(ZONE_HINT_STORAGE_KEY, '1'); } catch { /* non-critical preference */ }
  }, []);

  const chapters = useMemo(
    () => buildNovelDocument(session.messages, markers, { userMode, showHidden, sceneGapMinutes: sceneGap, regexRules }),
    [session.messages, markers, userMode, showHidden, sceneGap, regexRules],
  );
  const [pageBox, setPageBox] = useState({ width: 0, height: 0 });
  const pageBoxRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageWeight = useMemo(() => novelPageCapacity(pageBox, fontSize), [pageBox, fontSize]);
  const pages = useMemo(() => paginateNovelDocument(chapters, pageWeight), [chapters, pageWeight]);
  const sourceSignature = useMemo(() => JSON.stringify(chapters), [chapters]);
  const blockLengths = useMemo(() => chapters.flatMap(chapter => chapter.blocks.map(block => block.text.length)), [chapters]);
  const locationRef = useRef<NovelLocation | null>(null);
  const initialFloorRef = useRef(initialFloor);
  initialFloorRef.current = initialFloor;
  const readerIdentity = JSON.stringify([session.id, progressKey, polish?.story.id, polish?.branchId]);
  const layoutRef = useRef<{ identity: string; source: string; weight: number; mobile: boolean; scrolling: boolean } | null>(null);
  const hasPages = pages.length > 0;
  const hiddenUserFloors = useMemo(
    () => session.messages.filter((m) => m.role === 'user').length,
    [session.messages],
  );
  const hiddenFloors = useMemo(
    () => session.messages.filter((m) => m.hidden).length,
    [session.messages],
  );

  useEffect(() => {
    const el = scrolling ? scrollRef.current : pageBoxRef.current;
    if (!el) return;
    const measure = () => {
      if (!el.isConnected || el !== (scrolling ? scrollRef.current : pageBoxRef.current)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const style = getComputedStyle(el);
      const horizontalPadding = scrolling ? 0 : (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const verticalPadding = scrolling ? 0 : (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const clientWidth = rect.width - horizontalPadding;
      const clientHeight = rect.height - verticalPadding;
      if (clientWidth <= 0 || clientHeight <= 0) return;
      const width = scrolling ? Math.min(clientWidth, SCROLL_TEXT_MAX_WIDTH) : clientWidth;
      setPageBox((prev) => (prev.width === width && prev.height === clientHeight
        ? prev
        : { width, height: clientHeight }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPages, embedded, scrolling, isMobile]);

  const readStoredFloor = useCallback((): number | undefined => {
    if (!progressKey) return undefined;
    try {
      const map = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}') as Record<string, unknown>;
      return typeof map[progressKey] === 'number' ? map[progressKey] : undefined;
    } catch {
      return undefined;
    }
  }, [progressKey]);

  const saveProgress = useCallback((floor: number) => {
    if (!progressKey || onFloorChange) return;
    try {
      const map = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}') as Record<string, number>;
      map[progressKey] = floor;
      localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(map));
    } catch { /* non-critical preference */ }
  }, [onFloorChange, progressKey]);

  const goToPage = useCallback((pageIndex: number) => {
    if (pages.length === 0) return;
    const next = normalizePage(pageIndex, pages.length);
    currentPageRef.current = next;
    locationRef.current = pages[next].startLocation;
    setCurrentPage(next);
    const floor = pages[next].startFloor;
    onFloorChange?.(floor);
    saveProgress(floor);
  }, [normalizePage, onFloorChange, pages, saveProgress]);

  const scrollSyncRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const jumpRequestId = useRef(0);
  const jumpTimer = useRef<number | undefined>(undefined);
  const scrollCommandRef = useRef<((page: number) => void) | null>(null);
  const sampleScrollRef = useRef<(() => void) | null>(null);
  const allowScrollCommandsRef = useRef(true);

  const cancelPendingJump = useCallback(() => {
    allowScrollCommandsRef.current = false;
    ++jumpRequestId.current;
    if (jumpTimer.current !== undefined) window.clearTimeout(jumpTimer.current);
    jumpTimer.current = undefined;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    scrollSyncRef.current = false;
  }, []);

  const alignScroll = useCallback((page: number) => {
    cancelPendingJump();
    const requestId = jumpRequestId.current;
    scrollSyncRef.current = true;
    allowScrollCommandsRef.current = true;
    scrollCommandRef.current?.(page);
    jumpTimer.current = window.setTimeout(() => {
      if (requestId !== jumpRequestId.current) return;
      jumpTimer.current = undefined;
      scrollSyncRef.current = false;
      sampleScrollRef.current?.();
    }, 120);
  }, [cancelPendingJump]);

  const jumpToPage = useCallback((page: number) => {
    if (!pages.length) return;
    goToPage(page);
    if (scrolling) alignScroll(currentPageRef.current);
  }, [goToPage, scrolling, alignScroll, pages.length]);

  useEffect(() => cancelPendingJump, [cancelPendingJump]);

  const exitReader = useCallback(() => {
    goToPage(currentPageRef.current);
    onClose();
  }, [goToPage, onClose]);

  useImmersiveLock(isMobile && !embedded);
  useReaderBack(!embedded, exitReader);

  const turnPage = useCallback((pageIndex: number) => {
    jumpToPage(pageIndex);
    if (isMobile) setChromeVisible(false);
  }, [jumpToPage, isMobile]);

  const current = pages[currentPage];
  const facing = isMobile ? undefined : pages[currentPage + 1];
  const lastSpreadStart = normalizePage(pages.length - 1, pages.length);
  const polishTarget = current ? chapters[current.chapterIndex] : undefined;
  const novelBookmarks = useMemo<NovelBookmark[]>(
    () => buildNovelBookmarks(session.messages, favorites, pages),
    [favorites, pages, session.messages],
  );
  const currentMessageId = current ? session.messages[current.startFloor]?.id : undefined;
  const currentIsBookmarked = !!currentMessageId && favorites.includes(currentMessageId);

  const toggleCurrentBookmark = useCallback(() => {
    if (!currentMessageId || !onFavoritesChange) return;
    onFavoritesChange(
      favorites.includes(currentMessageId)
        ? favorites.filter((id) => id !== currentMessageId)
        : [...favorites, currentMessageId],
    );
  }, [currentMessageId, favorites, onFavoritesChange]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(e) || chapterDialogOpen || polishChapter) return;
      if (e.key === 'Escape') {
        exitReader();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        turnPage(currentPageRef.current - step);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        turnPage(currentPageRef.current + step);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chapterDialogOpen, polishChapter, exitReader, turnPage, step]);

  const chapterNav = chapters.map((c, i) => ({
    title: c.title ?? '（开篇）',
    index: pages.findIndex((page) => page.chapterIndex === i),
  })).filter((item) => item.index >= 0);

  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null);
  const attachScrollHost = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setScrollHost(node);
  }, []);
  const [scrollMargin, setScrollMargin] = useState(0);
  const scrollInnerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!scrolling) return;
    const host = scrollRef.current;
    const inner = scrollInnerRef.current;
    if (!host || !inner) return;
    const measure = () => {
      const list = inner.firstElementChild;
      if (!host.isConnected || !list) return;
      setScrollMargin(list.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [scrolling, scrollHost]);

  const pageVirtualizer = useVirtualizer({
    count: scrolling ? pages.length : 0,
    getScrollElement: () => scrollHost,
    estimateSize: () => Math.max(240, pageBox.height || 480),
    overscan: 2,
    scrollMargin,
    scrollToFn: (offset, options, instance) => {
      if (allowScrollCommandsRef.current || options.adjustments !== undefined) {
        elementScroll(offset, options, instance);
      }
    },
  });

  const scrollToPage = useCallback((pageIndex: number) => {
    if (!scrollRef.current || pages.length === 0) return;
    pageVirtualizer.scrollToIndex(clampNovelPageIndex(pageIndex, pages.length), { align: 'start' });
  }, [pageVirtualizer, pages.length]);

  useLayoutEffect(() => {
    scrollCommandRef.current = scrollToPage;
    return () => { scrollCommandRef.current = null; };
  }, [scrollToPage]);

  useLayoutEffect(() => {
    const previous = layoutRef.current;
    const initialize = !previous || previous.identity !== readerIdentity || previous.source !== sourceSignature;
    if (!initialize && previous.weight === pageWeight && previous.mobile === isMobile
      && previous.scrolling === scrolling) return;
    layoutRef.current = { identity: readerIdentity, source: sourceSignature, weight: pageWeight, mobile: isMobile, scrolling };
    const target = initialize || !locationRef.current
      ? findNovelPageIndex(pages, initialFloorRef.current ?? readStoredFloor())
      : findPageForNovelLocation(pages, clampNovelLocation(locationRef.current, blockLengths));
    const next = normalizePage(target, pages.length);
    if (initialize) locationRef.current = pages[next]?.startLocation ?? null;
    currentPageRef.current = next;
    setCurrentPage(next);
    if (scrolling && pages.length) alignScroll(next);
    else cancelPendingJump();
  }, [readerIdentity, sourceSignature, pageWeight, isMobile, scrolling, pages, blockLengths,
    normalizePage, readStoredFloor, alignScroll, cancelPendingJump]);

  const syncScrollProgress = useCallback((pageIndex: number) => {
    if (pages.length === 0) return;
    const next = clampNovelPageIndex(pageIndex, pages.length);
    if (next === currentPageRef.current) return;
    currentPageRef.current = next;
    locationRef.current = pages[next].startLocation;
    setCurrentPage(next);
    const floor = pages[next].startFloor;
    onFloorChange?.(floor);
    saveProgress(floor);
  }, [onFloorChange, pages, saveProgress]);

  const sampleScroll = useCallback(() => {
    if (scrollSyncRef.current) return;
    const host = scrollRef.current;
    if (!host) return;
    const probe = host.scrollTop + 8;
    const items = pageVirtualizer.getVirtualItems();
    let index = items[0]?.index ?? 0;
    for (const item of items) {
      if (item.start <= probe) index = item.index;
    }
    syncScrollProgress(index);
  }, [syncScrollProgress, pageVirtualizer]);

  useLayoutEffect(() => {
    sampleScrollRef.current = sampleScroll;
    return () => { sampleScrollRef.current = null; };
  }, [sampleScroll]);

  const handleBodyScroll = useCallback(() => {
    if (scrollSyncRef.current) return;
    setChromeVisible(false);
    if (scrollFrameRef.current !== null) return;
    const requestId = jumpRequestId.current;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (requestId === jumpRequestId.current) sampleScrollRef.current?.();
    });
  }, []);

  const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element
      && event.target.closest('[data-reader-tool], button, input, textarea, [role="slider"], [role="dialog"]')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (isMobile) {
      const zone = (event.clientX - bounds.left) / Math.max(1, bounds.width);
      if (scrolling || (zone >= 1 / 3 && zone < 2 / 3)) {
        setChromeVisible((visible) => !visible);
        return;
      }
      turnPage(currentPage + (zone < 1 / 3 ? -step : step));
      return;
    }
    jumpToPage(event.clientX < bounds.left + bounds.width / 2 ? currentPage - 2 : currentPage + 2);
  };

  const renderBlocks = (blocks: NovelPage['blocks']) => blocks.map((block, blockIndex) => {
    if (block.type === 'scene-break') {
      return <div key={blockIndex} className="my-5 text-center text-xs tracking-[0.45em] text-muted-foreground/70">✦ ✦ ✦</div>;
    }
    return (
      <p
        key={blockIndex}
        className={cn(
          'mb-0 whitespace-pre-wrap',
          block.type !== 'user' && !block.continuedFromPrevious && 'indent-[2em]',
          block.type === 'user' && 'border-l-2 border-border pl-3 text-[0.9em] text-muted-foreground/75 indent-0',
          block.hidden && 'border-l-2 border-dashed border-primary/40 pl-3',
        )}
      >
        {block.text}
      </p>
    );
  });

  const polishButton = !readOnly && polish && polishTarget ? (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1 px-2 text-[11px] text-muted-foreground hover:text-primary"
      onClick={() => setPolishChapter(polishTarget)}
      title="按文风模板将本章润色为连贯小说正文"
    >
      <Feather className="h-3 w-3" />AI 润色本章
    </Button>
  ) : null;

  const renderNovelPage = (page: NovelPage | undefined, pageIndex: number, side: 'left' | 'right' | 'single') => (
    <section
      data-novel-page={side}
      ref={side === 'right' ? undefined : pageBoxRef}
      className={cn(
        'relative min-w-0 overflow-hidden bg-card text-card-foreground',
        side === 'single' ? 'h-full px-5 pb-9 pt-5' : 'px-7 pb-10 pt-7 sm:px-10',
        side === 'left' && 'rounded-l-md border-r border-border/70',
        side === 'right' && 'rounded-r-md',
      )}
    >
      {page ? (
        <article
          className="h-full font-serif text-foreground/90"
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}
        >
          {page.title && (
            <div className="mb-4 text-center">
              <h2 className="font-display text-lg font-semibold text-primary/90">{page.title}</h2>
              <div className="mx-auto mt-2 h-px w-14 bg-primary/30" />
            </div>
          )}
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span>#{page.startFloor}–{page.endFloor} 楼</span>
            {side !== 'right' && polishButton}
          </div>
          {renderBlocks(page.blocks)}
          {pageIndex === pages.length - 1 && (
            <p className="pt-3 text-center text-xs text-muted-foreground/60">—— 完 ——</p>
          )}
        </article>
      ) : (
        <div className="h-full" aria-hidden="true" />
      )}
      <span className={cn(
        'absolute bottom-4 text-xs tabular-nums text-muted-foreground/70',
        side === 'left' ? 'left-7 sm:left-10' : 'right-7 sm:right-10',
      )}>
        {page ? pageIndex + 1 : ''}
      </span>
    </section>
  );

  return (
    <div
      className={cn(
        embedded
          ? 'relative z-0 flex h-[min(78vh,900px)] min-h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-canvas text-[color:var(--text-body)] shadow-sm'
          : isMobile
            ? 'fixed inset-0 z-50 flex flex-col bg-canvas text-[color:var(--text-body)]'
            : 'fixed inset-x-0 bottom-0 top-[var(--app-chrome-h,0px)] z-50 flex flex-col bg-canvas text-[color:var(--text-body)]',
      )}
      onTouchStart={(event) => {
        touchStartX.current = event.target instanceof Element && event.target.closest('[data-reader-tool]')
          ? null : event.changedTouches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (event.target instanceof Element && event.target.closest('[data-reader-tool]')) return;
        if (start === null || end === undefined || Math.abs(end - start) < 48) return;
        if (scrolling) return;
        turnPage(end < start ? currentPage + step : currentPage - step);
      }}
    >
      <NovelTopBar
        title={session.title || '未命名作品'}
        isMobile={isMobile}
        chromeVisible={chromeVisible}
        userMode={userMode}
        onUserModeChange={setUserMode}
        hiddenUserFloors={hiddenUserFloors}
        hiddenFloors={hiddenFloors}
        showHidden={showHidden}
        onShowHiddenChange={setShowHidden}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        sceneGap={sceneGap}
        onSceneGapChange={setSceneGap}
        chapterNav={chapterNav}
        novelBookmarks={novelBookmarks}
        onJumpToPage={jumpToPage}
        onRemoveBookmark={
          onFavoritesChange
            ? (messageId) => onFavoritesChange(favorites.filter((id) => id !== messageId))
            : undefined
        }
        canSuggestChapters={Boolean(onMarkersChange && !readOnly)}
        onOpenChapterSuggest={() => setChapterDialogOpen(true)}
        onOpenMobileSettings={() => setSettingsOpen(true)}
        onExit={exitReader}
        extraActions={renderTopActions?.({
          currentFloor: current?.startFloor ?? 0,
          currentMessageId,
        })}
      />

      <div
        data-novel-surface
        className="relative flex-1 min-h-0 overflow-hidden"
        onClick={handleSurfaceClick}
      >
        {pages.length === 0 ? (
          <p className="flex h-full items-center justify-center text-center text-muted-foreground text-sm">
            暂时没有可展示的正文（可能所有楼层都被设为隐藏，或被当前正则过滤了）。
          </p>
        ) : scrolling ? (
          <div
            ref={attachScrollHost}
            data-novel-scroll
            onScroll={handleBodyScroll}
            onWheel={cancelPendingJump}
            onTouchStart={cancelPendingJump}
            className="relative h-full overflow-y-auto overscroll-y-contain scrollbar-thin"
          >
            <div
              ref={scrollInnerRef}
              className="mx-auto max-w-2xl px-5 pb-24 pt-[calc(env(safe-area-inset-top)+2.75rem)]"
            >
              <div className="relative w-full" style={{ height: pageVirtualizer.getTotalSize() }}>
                {pageVirtualizer.getVirtualItems().map((item) => {
                  const page = pages[item.index];
                  if (!page) return null;
                  return (
                    <section
                      key={item.key}
                      data-index={item.index}
                      data-novel-scroll-page={item.index}
                      ref={pageVirtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      style={{
                        display: 'flow-root',
                        transform: `translateY(${item.start - pageVirtualizer.options.scrollMargin}px)`,
                      }}
                    >
                      {page.title && (
                        <div className={cn('text-center', item.index === 0 ? 'mb-4' : 'mb-4 mt-8 border-t border-border pt-8')}>
                          <h2 className="font-display text-lg font-semibold text-primary/90">{page.title}</h2>
                          <div className="mx-auto mt-2 h-px w-14 bg-primary/30" />
                        </div>
                      )}
                      <article
                        className="font-serif text-foreground/90"
                        style={{ fontSize: `${fontSize}px`, lineHeight: 1.75 }}
                      >
                        {renderBlocks(page.blocks)}
                        {item.index === pages.length - 1 && (
                          <p className="pt-3 text-center text-xs text-muted-foreground/60">—— 完 ——</p>
                        )}
                      </article>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        ) : isMobile ? (
          <div className="h-full px-2 pb-2 pt-[calc(env(safe-area-inset-top)+2.5rem)]">
            <div
              data-novel-spread="single"
              className="h-full overflow-hidden rounded-md border border-border bg-card shadow-lg"
            >
              {renderNovelPage(current, currentPage, 'single')}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-12 py-5 sm:px-16 sm:py-7">
            <div
              data-novel-spread="true"
              className="relative grid h-full max-h-[720px] w-full max-w-5xl grid-cols-2 overflow-hidden rounded-md border border-border bg-card shadow-xl"
            >
              {renderNovelPage(current, currentPage, 'left')}
              {renderNovelPage(facing, currentPage + 1, 'right')}
              <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-6 -translate-x-1/2 bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
            </div>
          </div>
        )}

        {!isMobile && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2"
              onClick={(event) => { event.stopPropagation(); jumpToPage(currentPage - 2); }}
              disabled={currentPage <= 0 || pages.length === 0}
              aria-label="上一页"
              title="上一页"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={(event) => { event.stopPropagation(); jumpToPage(currentPage + 2); }}
              disabled={currentPage >= lastSpreadStart || pages.length === 0}
              aria-label="下一页"
              title="下一页"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </>
        )}

        {isMobile && zoneHintOpen && pages.length > 0 && (
          <ReaderZoneHint mode={readingMode} onDismiss={dismissZoneHint} />
        )}
      </div>

      <div
        data-reader-bottom-bar
        className={cn(
          'shrink-0 border-t border-border/60 bg-card/75 px-4 py-2',
          isMobile && 'absolute inset-x-0 bottom-0 z-20 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm transition-transform duration-200',
          isMobile && !chromeVisible && 'translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCurrentBookmark}
            disabled={!currentMessageId || !onFavoritesChange}
            aria-label={currentIsBookmarked ? '移除当前页书签' : '收藏当前页楼层'}
            title={currentIsBookmarked ? '移除当前页书签' : '收藏当前页楼层'}
          >
            {currentIsBookmarked ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
          </Button>
          <Slider
            value={[currentPage]}
            onValueChange={([value]) => jumpToPage(value)}
            min={0}
            max={lastSpreadStart}
            step={step}
            disabled={pages.length <= step}
            aria-label="小说阅读进度"
            className="flex-1"
          />
          <span data-novel-progress className={cn('text-right text-xs text-muted-foreground', isMobile ? 'min-w-14' : 'min-w-20')}>
            {pages.length
              ? `${currentPage + 1}${facing ? `–${currentPage + 2}` : ''} / ${pages.length}`
              : '0 / 0'}
          </span>
          <ShareImage
            storyTitle={session.title || session.character.name || '未命名故事'}
            characterName={session.character.name}
            currentFloor={pages[currentPage]?.startFloor ?? 1}
            currentText={pages[currentPage]?.blocks.map(b => b.text).join('\n') ?? ''}
            triggerLabel="生成分享图"
            onOpenChange={setShareImageOpen}
          />
        </div>
      </div>

      {isMobile && (
        <MobileReaderSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          readingMode={readingMode}
          onReadingModeChange={setReadingMode}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          userMode={userMode}
          onUserModeChange={setUserMode}
          sceneGap={sceneGap}
          onSceneGapChange={setSceneGap}
          showHidden={showHidden}
          onShowHiddenChange={setShowHidden}
        />
      )}

      <NovelChapterSuggestDialog
        open={chapterDialogOpen}
        onOpenChange={setChapterDialogOpen}
        readOnly={readOnly}
        session={session}
        markers={markers}
        onMarkersChange={onMarkersChange}
        story={polish?.story}
      />

      <NovelPolishDialog
        chapter={polishChapter}
        onClose={() => setPolishChapter(null)}
        readOnly={readOnly}
        session={session}
        polish={polish}
      />
    </div>
  );
};

export default NovelView;
