import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
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
  /** 跳到第 floor 楼（0-based 原始楼层号，与界面 #N 一致） */
  scrollToFloor: (floor: number) => void;
  /** 按 messageId 跳转（收藏列表用，id 稳定不受空消息过滤影响） */
  scrollToMessageId: (messageId: string) => void;
  /** 过滤空消息后的可见总楼层数 */
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
  characterAvatarUrl?: string;
  currentAnchorFloor?: number;
  onMessageClick?: (messageId: string, messageIndex: number) => void;
  onEditMessage?: (messageId: string, messageIndex: number) => void;
  editMode?: boolean;
  fontFamily?: string;
  previewRule?: RegexRule | null;
  onVisibleFloorChange?: (floor: number, messageId: string | null) => void;
  onFloorMapChange?: (map: Map<string, number>, visibleFloors: number[]) => void;
  searchQuery?: string;
  onSearchResult?: (total: number, current: number) => void;
  showHidden?: boolean;
  showOOC?: boolean;
  onSwipeSelect?: (messageId: string, targetId: number) => void;
  onUnhideMessage?: (messageId: string, messageIndex: number) => void;
  onHideMessage?: (messageId: string, messageIndex: number) => void;
  onCaptureMessage?: (messageId: string, content: string) => void;
  /** 外部定位跳转的目标楼层高亮（0-based 原始楼层号） */
  highlightedFloor?: number | null;
  /** 按稳定 messageId 高亮目标楼层（不受隐藏楼过滤影响） */
  highlightedMessageId?: string | null;
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
    characterAvatarUrl,
    currentAnchorFloor = 0,
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
    highlightedFloor = null,
    highlightedMessageId = null,
    showModel = true,
    scrollPaddingStart = 0,
  }, ref) => {
    useI18n();
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
          rawFloor: index,
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

    const idToVirtualIndex = useMemo(() => {
      const m = new Map<string, number>();
      processedMessages.forEach((msg, i) => m.set(msg.id, i));
      return m;
    }, [processedMessages]);

    useEffect(() => {
      if (!onFloorMapChange) return;
      const m = new Map<string, number>();
      const visibleFloors: number[] = [];
      processedMessages.forEach((msg) => {
        m.set(msg.id, msg.rawFloor);
        visibleFloors.push(msg.rawFloor);
      });
      onFloorMapChange(m, visibleFloors);
    }, [processedMessages, onFloorMapChange]);

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
    const anchorFloorRef = useRef(currentAnchorFloor);
    anchorFloorRef.current = currentAnchorFloor;
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
      if (matchIndices.length === 0) return;
      if (matchPosRef.current < 0) {
        const anchor = anchorFloorRef.current;
        if (direction === 1) {
          const idx = matchIndices.findIndex((vi) => (processedMessages[vi]?.rawFloor ?? 0) >= anchor);
          scrollToSearchMatch(idx >= 0 ? idx : 0);
        } else {
          let idx = -1;
          for (let i = matchIndices.length - 1; i >= 0; i--) {
            if ((processedMessages[matchIndices[i]]?.rawFloor ?? 0) <= anchor) {
              idx = i;
              break;
            }
          }
          scrollToSearchMatch(idx >= 0 ? idx : matchIndices.length - 1);
        }
        return;
      }
      const next = cycleSearchPosition(matchPosRef.current, matchIndices.length, direction);
      if (next >= 0) scrollToSearchMatch(next);
    }, [matchIndices, processedMessages, scrollToSearchMatch]);

    const resolveVirtualIndexForFloor = useCallback((targetFloor: number): number => {
      if (processedMessages.length === 0) return -1;
      const clamped = Math.max(0, targetFloor);
      const found = processedMessages.findIndex((msg) => msg.rawFloor >= clamped);
      return found >= 0 ? found : processedMessages.length - 1;
    }, [processedMessages]);

    useImperativeHandle(ref, () => ({
      scrollToFloor: (floor: number) => {
        const idx = resolveVirtualIndexForFloor(floor);
        if (idx >= 0) scrollToVirtualRow(idx);
      },
      scrollToMessageId: (messageId: string) => {
        const idx = idToVirtualIndex.get(messageId);
        if (idx !== undefined) scrollToVirtualRow(idx);
      },
      getFloorCount: () => processedMessages.length,
      nextMatch: () => moveSearchMatch(1),
      prevMatch: () => moveSearchMatch(-1),
    }), [idToVirtualIndex, moveSearchMatch, processedMessages.length, resolveVirtualIndexForFloor, scrollToVirtualRow]);

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
        if (top < 0) return;
        const rawFloor = processedMessages[top]?.rawFloor ?? top;
        if (rawFloor === lastReportedFloorRef.current) return;
        lastReportedFloorRef.current = rawFloor;
        onVisibleFloorChange(rawFloor, processedMessages[top]?.id ?? null);
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
              <div className="text-xs text-muted-foreground tracking-widest uppercase">{tr("对话记录")}</div>
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
                    isHighlightedFloor={
                      highlightedMessageId != null
                        ? message.id === highlightedMessageId
                        : highlightedFloor === message.rawFloor
                    }
                    userName={session.user.name}
                    charName={session.character.name}
                    characterAvatarUrl={characterAvatarUrl}
                    onMessageClick={onMessageClick}
                    onEditMessage={onEditMessage}
                    onSwipeSelect={onSwipeSelect}
                    onUnhideMessage={onUnhideMessage}
                    onHideMessage={onHideMessage}
                    onCaptureMessage={onCaptureMessage}
                  />
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        {theme === 'elegant' && (
          <div className="mt-12 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            <div className="mb-2">{tr("— 完 —")}</div>
            <div className="text-xs">{tr("共 {{v0}} 楼", { v0: session.messages.length })}</div>
          </div>
        )}
      </div>
    );
  },
));

ChatPreview.displayName = 'ChatPreview';
