/**
 * 统一聊天工作台（2.0 阶段2，定稿 5.1 / 第六章）。
 * 聊天处理页（未绑定）与故事工作区（已绑定）共用的同一套阅读与编辑界面：
 * 预览/搜索/每楼编辑/swipe 切换/章节标记/每楼收藏/正则侧栏/隐藏楼与 OOC 开关/标题改名。
 */
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ChatPreview, type ChatPreviewHandle } from '@/components/chat/ChatPreview';
import { MessageNavBar, type FavoriteItem } from '@/components/chat/MessageNavBar';
import { MessageSearchBar } from '@/components/chat/MessageSearchBar';
import { EditorToolbar } from '@/components/chat/EditorToolbar';
import { ChapterMarkerDialog } from '@/components/chat/ChapterMarkerDialog';
import { MessageEditDialog } from '@/components/chat/MessageEditDialog';
import { RegexSidebar } from '@/components/chat/RegexSidebar';
import { SettingsPanel } from '@/components/chat/SettingsPanel';
import { applyRegexRules } from '@/lib/regex-processor';
import { selectSwipe, syncEditedMessage, isOOCMessage, isManagedHidden, hideMessage, unhideMessage, setManualHiddenRange } from '@/lib/chat-edit';
import {
  PAPER_WIDTH_FULL,
  loadGlobalReadingAppearance,
  saveGlobalReadingAppearance,
  saveSettings,
} from '@/lib/session-storage';
import { FloorProcessingMenu } from './FloorProcessingMenu';
import { CaptureRecordDialog } from '@/components/summary/CaptureRecordDialog';
import { useViewport } from '@/hooks/use-viewport';
import { cn } from '@/lib/utils';
import type { ChatSession, ExportSettings, ChapterMarker, ChatMessage, RegexRule } from '@/types/chat';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

export interface ChatWorkbenchHandle {
  /** 跳到第 floor 楼（0-based 原始楼层号，与界面 #N 一致） */
  scrollToFloor: (floor: number) => void;
  /** 按 messageId 跳转（章节/书签列表用） */
  scrollToMessageId: (messageId: string) => void;
  /** 当前顶部可见楼层号（0-based 原始楼层号） */
  getCurrentFloor: () => number;
  /** 当前顶部可见楼层的稳定 messageId */
  getCurrentMessageId: () => string | null;
}

interface ChatWorkbenchProps {
  recordContext?: { storyId: string; branchId: string | null; flush: () => Promise<void> };
  characterId?: string;
  characterAvatarUrl?: string;
  /** 外部定位跳转高亮的目标楼层（0-based 原始楼层号） */
  highlightedFloor?: number | null;
  /** 按稳定 messageId 高亮目标楼层 */
  highlightedMessageId?: string | null;
  session: ChatSession;
  markers: ChapterMarker[];
  favorites: string[];
  settings: ExportSettings;
  onSessionChange?: (next: ChatSession) => void;
  onMarkersChange?: (next: ChapterMarker[]) => void;
  onFavoritesChange: (next: string[]) => void;
  onSettingsChange: (next: ExportSettings) => void;
  /** 顶部可见楼层变化（父页存阅读位置） */
  onFloorChange?: (floor: number) => void;
  /** 挂载后恢复到的楼层（等虚拟列表就绪后跳一次） */
  initialFloor?: number;
  /** 标题行左侧徽标位（「未绑定」横幅 / 分支名等） */
  titleBadge?: React.ReactNode;
  /** 工具条右侧追加动作（绑定按钮 / 小说视图等） */
  toolbarExtras?: React.ReactNode;
  /** 重新导入（清空当前记录）；不传则不显示 */
  onReset?: () => void;
  /** 就地阅读模式：只保留阅读增强和非破坏性操作 */
  readerMode?: boolean;
  /** 就地阅读返回栏的实测高度；工作台工具栏与楼层栏按此向下堆叠。 */
  readerStickyTop?: number;
}

export const ChatWorkbench = forwardRef<ChatWorkbenchHandle, ChatWorkbenchProps>(function ChatWorkbench(
  {
    session, markers, favorites, settings,
    onSessionChange, onMarkersChange, onFavoritesChange, onSettingsChange,
    onFloorChange, initialFloor, titleBadge, toolbarExtras, onReset, readerMode,
    readerStickyTop = 0,
    recordContext,
    characterAvatarUrl,
    highlightedFloor = null,
    highlightedMessageId = null,
  },
  ref,
) {
  const { toast } = useToast();
  const [capture, setCapture] = useState<{ messageId: string; content: string } | null>(null);
  const { isCompact, isMobile } = useViewport();
  const sessionRef = useRef(session);
  const markersRef = useRef(markers);
  const favoritesRef = useRef(favorites);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { markersRef.current = markers; }, [markers]);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);
  const mutateSession = useCallback((fn: (cur: ChatSession) => ChatSession) => {
    if (readerMode) return;
    onSessionChange?.(fn(sessionRef.current));
  }, [onSessionChange, readerMode]);
  const mutateMarkers = useCallback((fn: (cur: ChapterMarker[]) => ChapterMarker[]) => {
    if (readerMode) return;
    onMarkersChange?.(fn(markersRef.current));
  }, [onMarkersChange, readerMode]);
  const mutateFavorites = useCallback((fn: (cur: string[]) => string[]) => {
    onFavoritesChange(fn(favoritesRef.current));
  }, [onFavoritesChange]);

  const previewRef = useRef<ChatPreviewHandle>(null);
  const [currentFloor, setCurrentFloor] = useState(0);
  const [currentFloorMsgId, setCurrentFloorMsgId] = useState<string | null>(null);
  const [floorCount, setFloorCount] = useState(0);
  const [visibleFloors, setVisibleFloors] = useState<number[]>([]);
  const [floorMap, setFloorMap] = useState<Map<string, number>>(new Map());
  const onFloorChangeRef = useRef(onFloorChange);
  useEffect(() => { onFloorChangeRef.current = onFloorChange; }, [onFloorChange]);

  const rawFloorToMsgId = useMemo(() => {
    const map = new Map<number, string>();
    floorMap.forEach((rawFloor, messageId) => { map.set(rawFloor, messageId); });
    return map;
  }, [floorMap]);

  const resolveNearestVisibleFloor = useCallback((requested: number): number => {
    if (visibleFloors.length === 0) return 0;
    const found = visibleFloors.find((f) => f >= requested);
    return found !== undefined ? found : visibleFloors[visibleFloors.length - 1];
  }, [visibleFloors]);

  const jumpToFloor = useCallback((floor: number) => {
    if (floorCount <= 0) return;
    const target = resolveNearestVisibleFloor(Math.max(0, floor));
    setCurrentFloor(target);
    setCurrentFloorMsgId(rawFloorToMsgId.get(target) ?? null);
    onFloorChangeRef.current?.(target);
    previewRef.current?.scrollToFloor(target);
  }, [floorCount, rawFloorToMsgId, resolveNearestVisibleFloor]);

  const stepPrevFloor = useCallback(() => {
    if (visibleFloors.length === 0) return;
    let prev = visibleFloors[0];
    for (const f of visibleFloors) {
      if (f < currentFloor) prev = f;
      else break;
    }
    jumpToFloor(prev);
  }, [currentFloor, jumpToFloor, visibleFloors]);

  const stepNextFloor = useCallback(() => {
    if (visibleFloors.length === 0) return;
    const next = visibleFloors.find((f) => f > currentFloor) ?? visibleFloors[visibleFloors.length - 1];
    jumpToFloor(next);
  }, [currentFloor, jumpToFloor, visibleFloors]);

  const jumpToMessageId = useCallback((messageId: string) => {
    const target = floorMap.get(messageId);
    if (target !== undefined) {
      setCurrentFloor(target);
      setCurrentFloorMsgId(messageId);
      onFloorChangeRef.current?.(target);
    }
    previewRef.current?.scrollToMessageId(messageId);
  }, [floorMap]);

  const pendingRestoreFloorRef = useRef<number | null>(
    typeof initialFloor === 'number' && initialFloor > 0 ? initialFloor : null,
  );

  // 全文搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState({ total: 0, current: 0 });
  const handleSearchResult = useCallback((total: number, current: number) => {
    setSearchResult({ total, current });
  }, []);
  const [editMode, setEditMode] = useState(false);

  // 隐藏楼 / OOC 注释楼显隐偏好全局记住
  const [initialAppearance] = useState(loadGlobalReadingAppearance);
  const [showHidden, setShowHiddenState] = useState(initialAppearance.showHidden);
  const [showOOC, setShowOOCState] = useState(initialAppearance.showOOC);
  const setShowHidden = useCallback((next: boolean) => {
    setShowHiddenState(next);
    saveGlobalReadingAppearance({ showHidden: next });
  }, []);
  const setShowOOC = useCallback((next: boolean) => {
    setShowOOCState(next);
    saveGlobalReadingAppearance({ showOOC: next });
  }, []);

  const handleGlobalSettingsChange = useCallback((next: ExportSettings) => {
    saveGlobalReadingAppearance({
      theme: next.theme,
      fontSize: next.fontSize,
      paperWidth: next.paperWidth,
      paperWidthConfigured: next.paperWidth > 0 && next.paperWidth < PAPER_WIDTH_FULL,
      showTimestamp: next.showTimestamp,
      showAvatar: next.showAvatar,
      showModel: next.showModel !== false,
      fontFamily: next.fontFamily,
    });
    saveSettings(next);
    onSettingsChange(next);
  }, [onSettingsChange]);

  const [markerDialogOpen, setMarkerDialogOpen] = useState(false);
  const [messageEditDialogOpen, setMessageEditDialogOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<{ id: string; index: number } | null>(null);
  const [regexSidebarOpen, setRegexSidebarOpenState] = useState(() => (
    !readerMode && !isCompact ? initialAppearance.regexSidebarOpen !== false : false
  ));
  const setRegexSidebarOpen = useCallback((next: boolean) => {
    setRegexSidebarOpenState(next);
    if (!readerMode && !isCompact) {
      saveGlobalReadingAppearance({ regexSidebarOpen: next });
    }
  }, [isCompact, readerMode]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  const [previewRule, setPreviewRule] = useState<RegexRule | null>(null);

  useEffect(() => {
    const floor = pendingRestoreFloorRef.current;
    if (floor == null || floorCount === 0) return;
    pendingRestoreFloorRef.current = null;
    const t = setTimeout(() => {
      jumpToFloor(floor);
    }, 150);
    return () => clearTimeout(t);
  }, [floorCount, jumpToFloor]);

  useImperativeHandle(ref, () => ({
    scrollToFloor: jumpToFloor,
    scrollToMessageId: jumpToMessageId,
    getCurrentFloor: () => currentFloor,
    getCurrentMessageId: () => currentFloorMsgId ?? rawFloorToMsgId.get(currentFloor) ?? null,
  }), [jumpToFloor, jumpToMessageId, currentFloor, currentFloorMsgId, rawFloorToMsgId]);

  const handleMessageClick = useCallback((messageId: string, messageIndex: number) => {
    if (!readerMode && editMode) {
      setSelectedMessage({ id: messageId, index: messageIndex });
      setMarkerDialogOpen(true);
    }
  }, [editMode, readerMode]);

  const handleEditMessage = useCallback((messageId: string, messageIndex: number) => {
    if (readerMode) return;
    setSelectedMessage({ id: messageId, index: messageIndex });
    setMessageEditDialogOpen(true);
  }, [readerMode]);

  const handleSaveMessage = (updatedMessage: ChatMessage) => {
    if (readerMode) return;
    const synced = syncEditedMessage(updatedMessage);
    const prevMessage = sessionRef.current.messages.find((msg) => msg.id === synced.id);
    mutateSession((cur) => ({
      ...cur,
      messages: cur.messages.map((msg) => (msg.id === synced.id ? synced : msg)),
    }));
    if (!prevMessage) return;
    const changed =
      prevMessage.content !== synced.content ||
      prevMessage.name !== synced.name ||
      prevMessage.role !== synced.role;
    if (!changed) return;
    toast({
      title: '已修改该楼',
      action: (
        <ToastAction altText="撤销修改" onClick={() => {
          mutateSession((cur) => ({
            ...cur,
            messages: cur.messages.map((m) => (m.id === prevMessage.id ? prevMessage : m)),
          }));
        }}>
          撤销
        </ToastAction>
      ),
    });
  };

  const setMessageHidden = useCallback((messageId: string, messageIndex: number, hidden: boolean) => {
    if (readerMode) return;
    const current = sessionRef.current.messages[messageIndex]
      ?? sessionRef.current.messages.find((m) => m.id === messageId);
    if (!current || current.hidden === hidden) return;
    if (isManagedHidden(current)) {
      toast({ title: '此楼层由系统或记忆插件管理', description: '请在对应记忆设置中处理隐藏。' });
      return;
    }
    mutateSession((currentSession) => ({
      ...currentSession,
      messages: currentSession.messages.map((message) => (
        message.id === messageId ? (hidden ? hideMessage(message) : unhideMessage(message)) : message
      )),
    }));
    toast({ title: hidden ? `已隐藏第 #${messageIndex} 楼` : `已恢复显示第 #${messageIndex} 楼` });
  }, [mutateSession, readerMode, toast]);

  const handleUnhideMessage = useCallback((messageId: string, messageIndex: number) => {
    setMessageHidden(messageId, messageIndex, false);
  }, [setMessageHidden]);

  const handleHideMessage = useCallback((messageId: string, messageIndex: number) => {
    setMessageHidden(messageId, messageIndex, true);
  }, [setMessageHidden]);

  const handleDeleteMessage = () => {
    if (readerMode) return;
    if (!selectedMessage) return;
    const delId = selectedMessage.id;
    const cur = sessionRef.current;
    const delIndex = cur.messages.findIndex((m) => m.id === delId);
    const delMessage = cur.messages[delIndex];
    if (!delMessage) return;
    const delMarkers = markersRef.current.filter((m) => m.messageId === delId);
    const wasFavorite = favoritesRef.current.includes(delId);

    mutateSession((c) => ({ ...c, messages: c.messages.filter((msg) => msg.id !== delId) }));
    mutateMarkers((prev) => prev.filter((m) => m.messageId !== delId));
    mutateFavorites((prev) => prev.filter((id) => id !== delId));

    toast({
      title: '已删除该楼',
      description: delMarkers.length > 0 ? '连同其章节标记一并删除' : undefined,
      action: (
        <ToastAction altText="撤销删除" onClick={() => {
          mutateSession((c) => {
            if (c.messages.some((m) => m.id === delId)) return c;
            const msgs = [...c.messages];
            msgs.splice(Math.min(delIndex, msgs.length), 0, delMessage);
            return { ...c, messages: msgs };
          });
          if (delMarkers.length > 0) {
            mutateMarkers((prev) => [...prev, ...delMarkers].sort((a, b) => a.messageIndex - b.messageIndex));
          }
          if (wasFavorite) {
            mutateFavorites((prev) => (prev.includes(delId) ? prev : [...prev, delId]));
          }
        }}>
          撤销
        </ToastAction>
      ),
    });
  };

  const [readerSwipeOverrides, setReaderSwipeOverrides] = useState<Record<string, number>>({});
  useEffect(() => {
    setReaderSwipeOverrides({});
  }, [session.id]);

  const previewSession = useMemo(() => {
    if (!readerMode || Object.keys(readerSwipeOverrides).length === 0) return session;
    return {
      ...session,
      messages: session.messages.map((m) => {
        const override = readerSwipeOverrides[m.id];
        return override === undefined ? m : selectSwipe(m, override);
      }),
    };
  }, [readerMode, readerSwipeOverrides, session]);

  const handleSwipeSelect = useCallback((messageId: string, targetId: number) => {
    if (readerMode) {
      setReaderSwipeOverrides((prev) => ({ ...prev, [messageId]: targetId }));
      return;
    }
    mutateSession((cur) => ({
      ...cur,
      messages: cur.messages.map((m) => (m.id === messageId ? selectSwipe(m, targetId) : m)),
    }));
  }, [mutateSession, readerMode]);

  const handleToggleFavorite = useCallback((messageId: string) => {
    mutateFavorites((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  }, [mutateFavorites]);

  const handleVisibleFloorChange = useCallback((floor: number, messageId: string | null) => {
    setCurrentFloor(floor);
    setCurrentFloorMsgId(messageId);
    onFloorChangeRef.current?.(floor);
  }, []);

  const handleFloorMapChange = useCallback((map: Map<string, number>, floors: number[]) => {
    setFloorMap(map);
    setVisibleFloors(floors);
    setFloorCount(floors.length);
  }, []);

  const favoriteItems = useMemo<FavoriteItem[]>(() => {
    const byId = new Map(session.messages.map((m, idx) => [m.id, { msg: m, rawFloor: idx }]));
    return favorites
      .map((id) => {
        const hit = byId.get(id);
        const snippet = (hit?.msg.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || '（空消息）';
        return { messageId: id, floor: floorMap.get(id) ?? hit?.rawFloor ?? null, snippet };
      })
      .sort((a, b) => (a.floor ?? Infinity) - (b.floor ?? Infinity));
  }, [favorites, floorMap, session]);

  const { hiddenCount, oocCount } = useMemo(() => {
    let hidden = 0;
    let ooc = 0;
    for (const m of session.messages) {
      if (!m.hidden) continue;
      if (isOOCMessage(m)) ooc++;
      else hidden++;
    }
    return { hiddenCount: hidden, oocCount: ooc };
  }, [session]);

  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const startTitleEdit = () => {
    if (readerMode) return;
    setTitleDraft(session.title);
    setTitleEditing(true);
  };
  const commitTitleEdit = () => {
    if (readerMode) return;
    setTitleEditing(false);
    const next = titleDraft.trim();
    if (!next || next === session.title) return;
    mutateSession((cur) => ({ ...cur, title: next }));
    toast({ title: '已重命名', description: next });
  };

  const handleSaveMarker = (marker: ChapterMarker) => {
    if (readerMode) return;
    mutateMarkers((prev) => {
      const existing = prev.findIndex((m) => m.messageId === marker.messageId);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = marker;
        return updated;
      }
      return [...prev, marker].sort((a, b) => a.messageIndex - b.messageIndex);
    });
  };

  const handleDeleteMarker = () => {
    if (readerMode) return;
    if (!selectedMessage) return;
    const delId = selectedMessage.id;
    const delMarkers = markersRef.current.filter((m) => m.messageId === delId);
    if (delMarkers.length === 0) return;
    mutateMarkers((prev) => prev.filter((m) => m.messageId !== delId));
    toast({
      title: '已删除章节标记',
      action: (
        <ToastAction altText="撤销删除" onClick={() => {
          mutateMarkers((prev) =>
            prev.some((m) => m.messageId === delId)
              ? prev
              : [...prev, ...delMarkers].sort((a, b) => a.messageIndex - b.messageIndex),
          );
        }}>
          撤销
        </ToastAction>
      ),
    });
  };

  const handleApplyRegexToOriginal = () => {
    if (readerMode) return;
    const cur = sessionRef.current;
    const activeRules = settings.regexRules.filter((r) => !r.disabled);
    if (activeRules.length === 0) {
      toast({ title: '没有已启用的正则规则', variant: 'destructive' });
      return;
    }
    const prevMessages = cur.messages;
    const prevRules = settings.regexRules;
    let changed = 0;
    const nextMessages = cur.messages.map((msg, index) => {
      const next = applyRegexRules(msg.content, activeRules, msg.role === 'user', cur.messages.length - index - 1).trim();
      if (next === msg.content) return msg;
      changed++;
      return syncEditedMessage({ ...msg, content: next });
    });
    if (changed === 0) {
      toast({ title: '没有需要修改的楼层', description: '当前启用的规则对原文没有产生改动' });
      return;
    }
    mutateSession((c) => ({ ...c, messages: nextMessages }));
    handleGlobalSettingsChange({ ...settings, regexRules: prevRules.map((r) => (r.disabled ? r : { ...r, disabled: true })) });
    toast({
      title: `已将正则结果写入 ${changed} 个楼层的原文`,
      description: '用过的规则已自动停用；持久化与导出均使用新文本',
      action: (
        <ToastAction altText="撤销应用" onClick={() => {
          mutateSession((c) => ({ ...c, messages: prevMessages }));
          handleGlobalSettingsChange({ ...settings, regexRules: prevRules });
        }}>
          撤销
        </ToastAction>
      ),
    });
  };

  const selectedMarker = selectedMessage
    ? markers.find((m) => m.messageId === selectedMessage.id)
    : undefined;

  const minVisibleFloor = visibleFloors.length > 0 ? visibleFloors[0] : 0;
  const maxVisibleFloor = visibleFloors.length > 0 ? visibleFloors[visibleFloors.length - 1] : 0;
  const canStepPrev = visibleFloors.length > 1 && currentFloor > minVisibleFloor;
  const canStepNext = visibleFloors.length > 1 && currentFloor < maxVisibleFloor;
  const fullPaperWidth = settings.paperWidth >= PAPER_WIDTH_FULL;
  const adaptivePaperWidth = settings.paperWidth <= 0;

  return (
    <div className="flex flex-col">
      <div
        ref={toolbarRef}
        data-chat-toolbar
        className={`sticky z-40 border-b border-border bg-card/60 backdrop-blur-sm ${readerMode ? '' : 'top-0'}`}
        style={readerMode ? { top: readerStickyTop } : undefined}
      >
        <div className={cn(
          'px-4 py-2.5 grid items-center gap-2',
          isMobile ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)]',
        )}>
          <div className={isMobile ? 'order-2 flex items-center gap-2 overflow-x-auto scrollbar-thin' : 'contents'} data-chat-controls>
            <div className={cn('flex items-center gap-2 min-w-0', isMobile ? 'flex-nowrap shrink-0' : 'flex-wrap col-start-1 row-start-1')}>
              <SettingsPanel settings={settings} onSettingsChange={handleGlobalSettingsChange} />
              <MessageSearchBar
                query={searchQuery}
                onQueryChange={setSearchQuery}
                total={searchResult.total}
                current={searchResult.current}
                onNext={() => previewRef.current?.nextMatch()}
                onPrev={() => previewRef.current?.prevMatch()}
              />
              <FloorProcessingMenu
                key={session.id}
                count={session.messages.length}
                hiddenCount={hiddenCount}
                oocCount={oocCount}
                showHidden={showHidden}
                showOOC={showOOC}
                onShowHidden={setShowHidden}
                onShowOOC={setShowOOC}
                onApply={!readerMode && onSessionChange ? (start, end, hidden) => {
                  mutateSession((current) => setManualHiddenRange(current, start, end, hidden));
                  toast({ title: hidden ? '已设置范围手动隐藏' : '已取消范围手动隐藏', description: '系统、OOC 和记忆插件管理的隐藏保持不变。' });
                } : undefined}
              />
            </div>
            <div className={cn(
              'flex items-center gap-2',
              isMobile ? 'flex-nowrap shrink-0' : 'flex-wrap justify-end col-start-3 row-start-1',
            )}>
              <EditorToolbar
                session={session}
                settings={settings}
                markers={markers}
                editMode={editMode}
                regexSidebarOpen={regexSidebarOpen}
                onReset={readerMode ? undefined : onReset}
                onToggleEditMode={() => { if (!readerMode) setEditMode(!editMode); }}
                onToggleRegex={() => setRegexSidebarOpen(!regexSidebarOpen)}
                hideChapterMark={readerMode}
              />
              {toolbarExtras}
            </div>
          </div>
          <div className={cn('w-48 shrink-0 min-w-0 self-center justify-self-center', isMobile ? 'order-1' : 'col-start-2 row-start-1')} data-chat-story-name>
            {titleEditing && !readerMode ? (
              <Input
                autoFocus
                aria-label="故事名称"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitleEdit}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') commitTitleEdit();
                  if (e.key === 'Escape') setTitleEditing(false);
                }}
                className="w-full text-center"
              />
            ) : (
              <button
                className="flex w-full min-w-0 items-center gap-1 text-sm font-medium text-center justify-center"
                onClick={startTitleEdit}
                disabled={readerMode}
                title={session.title || '未命名作品'}
                aria-label={`故事名称：${session.title || '未命名作品'}`}
              >
                <span className="truncate min-w-0 flex-1">{session.title || '未命名作品'}</span>
                {!readerMode && <Pencil className="w-3 h-3 shrink-0 text-muted-foreground" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {capture && recordContext && (
        <CaptureRecordDialog
          storyId={recordContext.storyId}
          branchId={recordContext.branchId}
          messageId={capture.messageId}
          initialContent={capture.content}
          beforeSave={recordContext.flush}
          onClose={() => setCapture(null)}
          onSaved={(destination) => toast({
            title: destination === 'note' ? '已收录到角色备注' : '已收录到当前故事的总结/日记',
            description: destination === 'note' ? '可从角色详情的「备注」查看。' : '可在编辑区「总结」中查看；已绑定角色的故事也可从角色详情查看。',
          })}
        />
      )}

      <div className={cn('py-5', isCompact ? 'px-3' : 'px-4')}>
        <div className={cn('flex gap-4', isCompact ? 'flex-col items-stretch' : 'items-start')}>
          <div className="flex-1 min-w-0">
            {!readerMode && (
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 flex-wrap">
                  {titleBadge}
                  <span className="shrink-0">共 {session.messages.length} 楼</span>
                  {markers.length > 0 && (
                    <span className="text-primary shrink-0">· {markers.length} 个章节标记</span>
                  )}
                </div>
                {!readerMode && editMode && (
                  <div className="text-sm text-primary animate-pulse">
                    点击任意楼层添加章节标记
                  </div>
                )}
              </div>
            )}

            <div
              data-chat-preview-shell
              className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3"
              data-tour="chat-preview"
            >
              <MessageNavBar
                floorCount={floorCount}
                minFloor={minVisibleFloor}
                maxFloor={maxVisibleFloor}
                currentFloor={currentFloor}
                currentMessageId={currentFloorMsgId}
                favorites={favoriteItems}
                onJumpToFloor={jumpToFloor}
                onPrev={stepPrevFloor}
                onNext={stepNextFloor}
                onFirst={() => jumpToFloor(minVisibleFloor)}
                onLast={() => jumpToFloor(maxVisibleFloor)}
                canPrev={canStepPrev}
                canNext={canStepNext}
                onToggleFavorite={handleToggleFavorite}
                onJumpToMessageId={jumpToMessageId}
                stickyTop={readerStickyTop + toolbarHeight + 8}
              />
              <div className={`flex min-w-0 flex-1 justify-center py-3 ${readerMode ? 'px-1' : 'px-1 sm:pr-3'}`}>
                <div
                  style={
                    fullPaperWidth
                      ? { width: '100%', maxWidth: '100%' }
                      : adaptivePaperWidth
                        ? { width: '100%', maxWidth: 'min(100%, 960px)' }
                        : { width: settings.paperWidth, maxWidth: '100%' }
                  }
                  className="shadow-warm rounded-lg overflow-hidden animate-fade-in"
                >
                  <ChatPreview
                    ref={previewRef}
                    session={previewSession}
                    theme={settings.theme}
                    showTimestamp={settings.showTimestamp}
                    showModel={settings.showModel !== false}
                    showAvatar={settings.showAvatar}
                    fontSize={settings.fontSize}
                    regexRules={settings.regexRules}
                    markers={markers}
                    characterAvatarUrl={characterAvatarUrl}
                    currentAnchorFloor={currentFloor}
                    onMessageClick={readerMode ? undefined : handleMessageClick}
                    onEditMessage={readerMode ? undefined : handleEditMessage}
                    onSwipeSelect={handleSwipeSelect}
                    onUnhideMessage={readerMode ? undefined : handleUnhideMessage}
                    onHideMessage={readerMode ? undefined : handleHideMessage}
                    editMode={readerMode ? false : editMode}
                    fontFamily={settings.fontFamily}
                    previewRule={previewRule}
                    onVisibleFloorChange={handleVisibleFloorChange}
                    onFloorMapChange={handleFloorMapChange}
                    searchQuery={searchQuery}
                    onSearchResult={handleSearchResult}
                    showHidden={showHidden}
                    onCaptureMessage={!readerMode && recordContext ? (messageId, content) => setCapture({ messageId, content }) : undefined}
                    highlightedFloor={highlightedFloor}
                    highlightedMessageId={highlightedMessageId}
                    showOOC={showOOC}
                    scrollPaddingStart={(readerMode ? readerStickyTop : 0) + toolbarHeight + 8}
                  />
                </div>
              </div>
            </div>
          </div>

          <RegexSidebar
            stickyTop={(readerMode ? readerStickyTop : 0) + toolbarHeight + 8}
            rules={settings.regexRules}
            onRulesChange={(rules) => { if (!readerMode) onSettingsChange({ ...settings, regexRules: rules }); }}
            readOnly={readerMode}
            isOpen={regexSidebarOpen}
            onClose={() => { setRegexSidebarOpen(false); setPreviewRule(null); }}
            sampleMessages={session.messages}
            onPreviewChange={setPreviewRule}
            previewId={previewRule?.id ?? null}
            onApplyToOriginal={readerMode ? undefined : handleApplyRegexToOriginal}
          />
        </div>
      </div>

      {!readerMode && selectedMessage && (
        <ChapterMarkerDialog
          open={markerDialogOpen}
          onOpenChange={setMarkerDialogOpen}
          messageId={selectedMessage.id}
          messageIndex={selectedMessage.index}
          existingMarker={selectedMarker}
          onSave={handleSaveMarker}
          onDelete={selectedMarker ? handleDeleteMarker : undefined}
        />
      )}

      {!readerMode && selectedMessage && (
        <MessageEditDialog
          open={messageEditDialogOpen}
          onOpenChange={setMessageEditDialogOpen}
          message={session.messages.find((m) => m.id === selectedMessage.id) || null}
          floorNumber={selectedMessage.index}
          onSave={handleSaveMessage}
          onDelete={handleDeleteMessage}
        />
      )}
    </div>
  );
});
