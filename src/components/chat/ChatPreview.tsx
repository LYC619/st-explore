import { forwardRef, useMemo, useState, useEffect, useLayoutEffect, useRef, useImperativeHandle, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatSession, ThemeStyle, RegexRule, ChapterMarker } from '@/types/chat';
import { applyRegexRules, isRegexRuleApplicable } from '@/lib/regex-processor';
import { swipeCount, currentSwipeId, isOOCMessage, isSteEditedSwipe } from '@/lib/chat-edit';
import { calculateSearchRevealScrollTop, cycleSearchPosition, floorJudgementLine, resolveTopVisibleIndex, type SearchDirection } from '@/lib/chat-navigation';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageRow } from './ChatMessageRow';
import { getThemeClasses, type ProcessedMessage } from './chat-theme-classes';

/**
 * ChatPreview 暴露给父组件的命令式句柄：跳转条/收藏列表通过它驱动滚动。
 */
export interface ChatPreviewHandle {
  /** 跳到第 floor 楼（0-based，与界面 #N 一致） */
  scrollToFloor: (floor: number) => void;
  /** 按 messageId 跳转（收藏列表用，id 稳定不受空消息过滤影响） */
  scrollToMessageId: (messageId: string) => void;
  /** 过滤空消息后的总楼层数，供跳转条做边界 */
  getFloorCount: () => number;
  /** 跳到下一个/上一个搜索命中（循环），无命中时无操作 */
  nextMatch: () => void;
  prevMatch: () => void;
}

export interface ChatPreviewProps {
  session: ChatSession;
  theme: ThemeStyle;
  showTimestamp: boolean;
  showAvatar: boolean;
  fontSize: number;
  regexRules: RegexRule[];
  markers?: ChapterMarker[];
  onMessageClick?: (messageId: string, messageIndex: number) => void;
  onEditMessage?: (messageId: string, messageIndex: number) => void;
  editMode?: boolean;
  fontFamily?: string;
  previewRule?: RegexRule | null;
  onVisibleFloorChange?: (floor: number, messageId: string | null) => void;
  onFloorMapChange?: (map: Map<string, number>) => void;
  searchQuery?: string;
  onSearchResult?: (total: number, current: number) => void;
  showHidden?: boolean;
  showOOC?: boolean;
  onSwipeSelect?: (messageId: string, targetId: number) => void;
  onUnhideMessage?: (messageId: string, messageIndex: number) => void;
  onHideMessage?: (messageId: string, messageIndex: number) => void;
  onCaptureMessage?: (messageId: string, content: string) => void;
  /** 将某楼或划选句子收进角色语录 */
  onQuoteMessage?: (messageId: string, floor: number, content: string, speakerName: string) => void;
  /** 将某楼或划选句子生成名场面分享图 */
  onShareMessage?: (floor: number, content: string, speakerName: string) => void;
  /** 外部定位跳转的目标楼层高亮 */
  highlightedFloor?: number | null;
  showModel?: boolean;
  scrollPaddingStart?: number;
}

export const ChatPreview = memo(forwardRef<ChatPreviewHandle, ChatPreviewProps>(
  ({
    session,
    theme,
    showTimestamp,
    showAvatar,
    fontSize,
    regexRules,
    markers = [],
    onMessageClick,
    onEditMessage,
    editMode = false,
    fontFamily,
    previewRule = null,
    onVisibleFloorChange,
    onFloorMapChange,
    searchQuery = '',
    onSearchResult,
    showHidden = true,
    showOOC = true,
    onSwipeSelect,
    onUnhideMessage,
    onHideMessage,
    onCaptureMessage,
    onQuoteMessage,
    onShareMessage,
    highlightedFloor = null,
    showModel = true,
    scrollPaddingStart = 0,
  }, ref) => {
    const markerMap = useMemo(() => {
      const map = new Map<string, ChapterMarker>();
      markers.forEach((m) => map.set(m.messageId, m));
      return map;
    }, [markers]);

    const [debouncedRules, setDebouncedRules] = useState(regexRules);
    useEffect(() => {
      const t = setTimeout(() => setDebouncedRules(regexRules), 300);
      return () => clearTimeout(t);
    }, [regexRules]);

    const processedMessages = useMemo<ProcessedMessage[]>(() => {
      const activeRules = previewRule
        ? debouncedRules.filter((r) => r.id !== previewRule.id)
        : debouncedRules;
      const out: ProcessedMessage[] = [];
      let prevRole: string | null = null;
      for (const [index, msg] of session.messages.entries()) {
        const depth = session.messages.length - index - 1;
        const ooc = isOOCMessage(msg);
        if (msg.hidden && !(ooc ? showOOC : showHidden)) continue;
        const isUser = msg.role === 'user';
        const processedContent = applyRegexRules(msg.content, activeRules, isUser, depth).trim();
        const swipeTotal = swipeCount(msg);
        if (!processedContent && swipeTotal <= 1) continue;
        const paragraphs = processedContent.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        out.push({
          ...msg,
          depth,
          content: processedContent,
          paragraphs,
          isNewSpeaker: prevRole !== msg.role,
          ooc,
          swipeTotal,
          swipeId: currentSwipeId(msg),
          swipeIsSteEdit: isSteEditedSwipe(msg),
        });
        prevRole = msg.role;
      }
      return out;
    }, [session.messages, debouncedRules, previewRule, showHidden, showOOC]);

    const classes = useMemo(() => getThemeClasses(theme), [theme]);

    const listRef = useRef<HTMLDivElement>(null);
    const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    useLayoutEffect(() => {
      const el = listRef.current;
      if (!el) return;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const overflowY = getComputedStyle(parent).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') break;
        parent = parent.parentElement;
      }
      const nextScrollElement = parent ?? (document.scrollingElement as HTMLElement | null);
      setScrollElement(nextScrollElement);
      const measure = () => {
        if (!nextScrollElement) {
          setScrollMargin(0);
          return;
        }
        const listRect = el.getBoundingClientRect();
        const scrollRect = nextScrollElement.getBoundingClientRect();
        setScrollMargin(Math.max(0, listRect.top - scrollRect.top + nextScrollElement.scrollTop));
      };
      measure();
      const ro = new ResizeObserver(measure);
      if (el.parentElement) ro.observe(el.parentElement);
      return () => ro.disconnect();
    }, [theme, session.title]);

    const virtualizer = useVirtualizer({
      getScrollElement: () => scrollElement,
      count: processedMessages.length,
      estimateSize: () => 200,
      overscan: 6,
      getItemKey: (i) => processedMessages[i]?.id ?? i,
      scrollMargin,
      scrollPaddingStart,
    });

    const virtualItems = virtualizer.getVirtualItems();

    const idToIndex = useMemo(() => {
      const m = new Map<string, number>();
      processedMessages.forEach((msg, i) => m.set(msg.id, i));
      return m;
    }, [processedMessages]);

    useEffect(() => {
      if (!onFloorMapChange) return;
      const m = new Map<string, number>();
      idToIndex.forEach((i, id) => m.set(id, i));
      onFloorMapChange(m);
    }, [idToIndex, onFloorMapChange]);

    const matchIndices = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return [] as number[];
      const out: number[] = [];
      processedMessages.forEach((msg, i) => {
        if (msg.content.toLowerCase().includes(q)) out.push(i);
      });
      return out;
    }, [searchQuery, processedMessages]);

    const [matchPos, setMatchPos] = useState(-1);
    const matchPosRef = useRef(-1);
    const searchScrollFrameRef = useRef<number | null>(null);
    const virtualJumpFrameRef = useRef<number | null>(null);

    useEffect(() => {
      matchPosRef.current = -1;
      setMatchPos(-1);
      onSearchResult?.(matchIndices.length, 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchIndices]);

    useEffect(() => () => {
      if (searchScrollFrameRef.current !== null) cancelAnimationFrame(searchScrollFrameRef.current);
      if (virtualJumpFrameRef.current !== null) cancelAnimationFrame(virtualJumpFrameRef.current);
    }, []);

    const activeMatchIndex = matchPos >= 0 && matchPos < matchIndices.length ? matchIndices[matchPos] : -1;

    const scrollToVirtualRow = useCallback((index: number) => {
      virtualizer.scrollToIndex(index, { align: 'start' });
      if (virtualJumpFrameRef.current !== null) cancelAnimationFrame(virtualJumpFrameRef.current);
      const reveal = (attemptsLeft: number) => {
        virtualJumpFrameRef.current = requestAnimationFrame(() => {
          const target = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
          if (!target || !scrollElement) {
            if (attemptsLeft > 0) reveal(attemptsLeft - 1);
            return;
          }
          const scrollRect = scrollElement.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          scrollElement.scrollTo({
            top: calculateSearchRevealScrollTop({
              scrollTop: scrollElement.scrollTop,
              containerTop: scrollRect.top,
              targetTop: targetRect.top,
              stickyOffset: scrollPaddingStart,
            }),
            behavior: 'auto',
          });
          virtualJumpFrameRef.current = null;
        });
      };
      reveal(5);
    }, [scrollElement, scrollPaddingStart, virtualizer]);

    const scrollToSearchMatch = useCallback((position: number) => {
      const messageIndex = matchIndices[position];
      if (messageIndex === undefined) return;

      matchPosRef.current = position;
      setMatchPos(position);
      onSearchResult?.(matchIndices.length, position + 1);
      virtualizer.scrollToIndex(messageIndex, { align: 'start' });

      if (searchScrollFrameRef.current !== null) cancelAnimationFrame(searchScrollFrameRef.current);
      const reveal = (attemptsLeft: number) => {
        searchScrollFrameRef.current = requestAnimationFrame(() => {
          const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${messageIndex}"]`);
          const target = row?.querySelector<HTMLElement>('mark[data-search-match="true"]');
          if (!target || !scrollElement) {
            if (attemptsLeft > 0) reveal(attemptsLeft - 1);
            return;
          }
          const scrollRect = scrollElement.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          scrollElement.scrollTo({
            top: calculateSearchRevealScrollTop({
              scrollTop: scrollElement.scrollTop,
              containerTop: scrollRect.top,
              targetTop: targetRect.top,
              stickyOffset: scrollPaddingStart,
            }),
            behavior: 'auto',
          });
          searchScrollFrameRef.current = null;
        });
      };
      reveal(4);
    }, [matchIndices, onSearchResult, scrollElement, scrollPaddingStart, virtualizer]);

    const moveSearchMatch = useCallback((direction: SearchDirection) => {
      const next = cycleSearchPosition(matchPosRef.current, matchIndices.length, direction);
      if (next >= 0) scrollToSearchMatch(next);
    }, [matchIndices.length, scrollToSearchMatch]);

    useImperativeHandle(ref, () => ({
      scrollToFloor: (floor: number) => {
        const idx = Math.min(Math.max(floor, 0), processedMessages.length - 1);
        if (idx >= 0) scrollToVirtualRow(idx);
      },
      scrollToMessageId: (messageId: string) => {
        const idx = idToIndex.get(messageId);
        if (idx !== undefined) scrollToVirtualRow(idx);
      },
      getFloorCount: () => processedMessages.length,
      nextMatch: () => moveSearchMatch(1),
      prevMatch: () => moveSearchMatch(-1),
    }), [idToIndex, moveSearchMatch, processedMessages.length, scrollToVirtualRow]);

    const lastReportedFloorRef = useRef(-1);
    useEffect(() => {
      if (!onVisibleFloorChange || !scrollElement) return;
      const report = () => {
        const list = listRef.current;
        if (!list) return;
        const containerTop = scrollElement === document.scrollingElement
          ? 0
          : scrollElement.getBoundingClientRect().top;
        const rows: Array<{ index: number; bottom: number }> = [];
        list.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => {
          rows.push({ index: Number(el.dataset.index), bottom: el.getBoundingClientRect().bottom });
        });
        const top = resolveTopVisibleIndex(rows, floorJudgementLine(containerTop, scrollPaddingStart), -1);
        if (top < 0 || top === lastReportedFloorRef.current) return;
        lastReportedFloorRef.current = top;
        onVisibleFloorChange(top, processedMessages[top]?.id ?? null);
      };
      report();
      scrollElement.addEventListener('scroll', report, { passive: true });
      return () => scrollElement.removeEventListener('scroll', report);
    }, [onVisibleFloorChange, processedMessages, scrollElement, scrollPaddingStart]);

    return (
      <div
        className={`min-h-[400px] ${classes.container}`}
        style={{ fontSize: `${fontSize}px`, fontFamily: fontFamily || undefined }}
      >
        <div className={classes.title}>
          {theme === 'elegant' ? (
            <>
              <div className="text-xs text-muted-foreground tracking-widest uppercase">
                对话记录
              </div>
              <h2 className="font-display text-2xl text-gradient">{session.title}</h2>
              <div className="text-sm text-muted-foreground">
                {session.character.name} & {session.user.name}
              </div>
            </>
          ) : (
            <h2 className="font-display text-xl">{session.title}</h2>
          )}
        </div>

        <TooltipProvider>
          <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((vItem) => {
              const message = processedMessages[vItem.index];
              if (!message) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    display: 'flow-root',
                    transform: `translateY(${vItem.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <MessageRow
                    message={message}
                    marker={markerMap.get(message.id)}
                    index={vItem.index}
                    theme={theme}
                    classes={classes}
                    showTimestamp={showTimestamp}
                    showAvatar={showAvatar}
                    showModel={showModel}
                    editMode={editMode}
                    previewRule={previewRule && isRegexRuleApplicable(previewRule, message.role === 'user', message.depth) ? previewRule : null}
                    searchQuery={searchQuery}
                    isActiveMatch={vItem.index === activeMatchIndex}
                    isHighlightedFloor={highlightedFloor === vItem.index}
                    userName={session.user.name}
                    charName={session.character.name}
                    onMessageClick={onMessageClick}
                    onEditMessage={onEditMessage}
                    onSwipeSelect={onSwipeSelect}
                    onUnhideMessage={onUnhideMessage}
                    onHideMessage={onHideMessage}
                    onCaptureMessage={onCaptureMessage}
                    onQuoteMessage={onQuoteMessage}
                    onShareMessage={onShareMessage}
                  />
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        {theme === 'elegant' && (
          <div className="mt-12 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            <div className="mb-2">— 完 —</div>
            <div className="text-xs">
              共 {processedMessages.length} 楼
            </div>
          </div>
        )}
      </div>
    );
  },
));

ChatPreview.displayName = 'ChatPreview';
