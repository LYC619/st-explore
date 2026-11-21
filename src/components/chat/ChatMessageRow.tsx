import { memo, useRef } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Bot,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MessageSquareDashed,
  Pencil,
  Quote,
  Share2,
  User,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { parseSTDate } from '@/lib/adapters/st/chat-jsonl';
import { parseRegex } from '@/lib/regex-processor';
import { formatMessageModelLabel } from '@/lib/story-meta';
import type { ChapterMarker, RegexRule, STRawMessage, ThemeStyle } from '@/types/chat';
import { ChatMarkdown } from './ChatMarkdown';
import type { ProcessedMessage, ThemeClasses } from './chat-theme-classes';

function renderPreviewHighlight(content: string, rule: RegexRule): React.ReactNode {
  const regex = parseRegex(rule.findRegex);
  if (!regex) return content;
  const g = regex.flags.includes('g') ? regex : new RegExp(regex.source, regex.flags + 'g');
  g.lastIndex = 0;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  let count = 0;
  while ((m = g.exec(content)) !== null && count < 2000) {
    count++;
    if (m.index > last) nodes.push(content.slice(last, m.index));
    const matched = m[0];
    if (matched.length === 0) {
      g.lastIndex++;
      continue;
    }
    nodes.push(
      <span key={`d${key}`} className="bg-[var(--status-danger-bg)] text-[color:var(--status-danger)] line-through rounded-sm px-0.5">
        {matched}
      </span>,
    );
    if (rule.replaceString) {
      nodes.push(
        <span key={`r${key}`} className="bg-[var(--status-ok-bg)] text-[color:var(--status-ok)] rounded-sm px-0.5">
          {rule.replaceString}
        </span>,
      );
    }
    last = m.index + matched.length;
    key++;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return nodes.length > 0 ? nodes : content;
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface MessageRowProps {
  onCaptureMessage?: (messageId: string, content: string) => void;
  onQuoteMessage?: (messageId: string, floor: number, content: string, speakerName: string) => void;
  onShareMessage?: (floor: number, content: string, speakerName: string) => void;
  message: ProcessedMessage;
  marker?: ChapterMarker;
  index: number;
  theme: ThemeStyle;
  classes: ThemeClasses;
  showTimestamp: boolean;
  showAvatar: boolean;
  editMode: boolean;
  previewRule: RegexRule | null;
  searchQuery: string;
  isActiveMatch: boolean;
  isHighlightedFloor?: boolean;
  userName: string;
  charName: string;
  onMessageClick?: (messageId: string, messageIndex: number) => void;
  onEditMessage?: (messageId: string, messageIndex: number) => void;
  onSwipeSelect?: (messageId: string, targetId: number) => void;
  onUnhideMessage?: (messageId: string, messageIndex: number) => void;
  onHideMessage?: (messageId: string, messageIndex: number) => void;
  showModel: boolean;
}

export const MessageRow = memo(function MessageRow({
  message,
  marker,
  index,
  theme,
  classes,
  showTimestamp,
  showAvatar,
  showModel,
  editMode,
  previewRule,
  searchQuery,
  isActiveMatch,
  isHighlightedFloor = false,
  userName,
  charName,
  onMessageClick,
  onEditMessage,
  onSwipeSelect,
  onUnhideMessage,
  onHideMessage,
  onCaptureMessage,
  onQuoteMessage,
  onShareMessage,
}: MessageRowProps) {
  const captureText = useRef('');
  const isUser = message.role === 'user';
  const hasMarker = !!marker;
  const rawData = message.rawData as STRawMessage | undefined;
  const model = !isUser && showModel ? formatMessageModelLabel(rawData) : undefined;
  const displayTimestamp = message.timestamp ?? parseSTDate(rawData?.send_date);
  const generationHint = rawData?.gen_started || rawData?.gen_finished
    ? `生成耗时：${rawData.gen_started ?? '未记录'} → ${rawData.gen_finished ?? '未记录'}`
    : undefined;
  const speakerName = message.name || (isUser ? userName : charName);

  const readSelectedSnippet = (button: HTMLElement) => {
    const selection = window.getSelection();
    const rowRoot = button.closest('[data-message-header]')?.parentElement;
    if (selection?.anchorNode && rowRoot?.contains(selection.anchorNode)) {
      return selection.toString().trim();
    }
    return '';
  };

  return (
    <div>
      {hasMarker && (
        <div className="my-6 py-4 border-y border-primary/30 bg-primary/5 text-center">
          {marker.volume && (
            <div className="text-xs text-muted-foreground tracking-widest uppercase mb-1">
              {marker.volume}
            </div>
          )}
          <div className="font-display text-lg text-primary">
            {marker.title}
          </div>
          {marker.summary && (
            <div className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              {marker.summary}
            </div>
          )}
        </div>
      )}

      <div
        data-floor-row={index}
        className={`${theme === 'social' ? 'mb-4' : classes.message} ${theme === 'social' ? '' : isUser ? classes.userBubble : classes.charBubble} animate-fade-in group relative w-full ${
          editMode ? 'cursor-pointer hover:bg-primary/5 rounded-lg transition-colors pt-9 px-2' : ''
        } ${isActiveMatch ? 'rounded-lg ring-2 ring-primary/60 ring-offset-2 ring-offset-background' : ''} ${
          isHighlightedFloor ? 'rounded-lg bg-primary/10 ring-1 ring-primary/45 px-2.5 py-1.5 -mx-2.5 transition-colors duration-500' : ''
        }`}
        onClick={() => editMode && onMessageClick?.(message.id, index)}
      >
        {message.hidden && (
          <div className="mb-1.5 inline-flex items-center gap-1 rounded bg-muted/70 px-1.5 py-0.5 text-xs text-muted-foreground">
            {message.ooc ? (
              <>
                <MessageSquareDashed className="w-3 h-3" />OOC / 场外备注
              </>
            ) : (
              <>
                <EyeOff className="w-3 h-3" />酒馆中已隐藏
                {onUnhideMessage && (
                  <button
                    type="button"
                    className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUnhideMessage(message.id, index);
                    }}
                  >
                    恢复显示
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {editMode && (
          <div className="absolute left-1 top-1 flex items-center gap-1 z-10">
            <span className="text-xs text-muted-foreground font-mono">
              #{index}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-xs transition-colors ${
                    hasMarker
                      ? 'bg-primary/15 text-primary'
                      : 'bg-muted/60 text-muted-foreground hover:bg-primary/10 hover:text-primary'
                  }`}
                >
                  {hasMarker ? (
                    <Bookmark className="w-3.5 h-3.5 fill-primary" />
                  ) : (
                    <BookmarkPlus className="w-3.5 h-3.5" />
                  )}
                  <span>{hasMarker ? '已标记' : '设章节'}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left">
                {hasMarker ? '点击修改章节标题' : '点击把这一楼设为新章起点'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {!editMode && (
          <span
            className="pointer-events-none absolute -left-12 top-0.5 hidden w-9 select-none text-right font-mono text-sm font-semibold tabular-nums text-primary/50 md:block"
            aria-hidden="true"
          >
            {index}
          </span>
        )}

        <div className="mb-2 flex items-start justify-between gap-3" data-message-header>
          <div className={`${classes.name} min-w-0 flex-1 break-words`}>
            {speakerName}
            {model && <span className="ml-2 text-[11px] text-muted-foreground/80" title={generationHint}>{model}</span>}
            {showTimestamp && displayTimestamp !== undefined && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{formatTime(displayTimestamp)}</span>
            )}
          </div>

          {!editMode && (
            <div className="flex shrink-0 items-center gap-1" data-message-actions>
              {onCaptureMessage && (
                <button
                  type="button"
                  className="tap-target h-7 rounded border border-border px-2 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  aria-label={`收录第 ${index} 楼`}
                  onMouseDown={(event) => {
                    captureText.current = readSelectedSnippet(event.currentTarget);
                    event.preventDefault();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCaptureMessage(message.id, captureText.current || message.content);
                    captureText.current = '';
                  }}
                >
                  收录
                </button>
              )}
              {onQuoteMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover-reveal tap-target flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      aria-label={`将第 ${index} 楼收进角色语录`}
                      onMouseDown={(event) => {
                        captureText.current = readSelectedSnippet(event.currentTarget);
                        event.preventDefault();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onQuoteMessage(message.id, index, captureText.current || message.content, speakerName);
                        captureText.current = '';
                      }}
                    >
                      <Quote className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>收进角色语录（支持先划选句子）</TooltipContent>
                </Tooltip>
              )}
              {onShareMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover-reveal tap-target flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      aria-label={`生成第 ${index} 楼分享图`}
                      onMouseDown={(event) => {
                        captureText.current = readSelectedSnippet(event.currentTarget);
                        event.preventDefault();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onShareMessage(index, captureText.current || message.content, speakerName);
                        captureText.current = '';
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>生成名场面分享图</TooltipContent>
                </Tooltip>
              )}
              {onHideMessage && !message.hidden && !message.ooc && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="tap-target flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      aria-label={`隐藏第 ${index} 楼`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHideMessage(message.id, index);
                      }}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>隐藏本楼</TooltipContent>
                </Tooltip>
              )}
              {onEditMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-tour="msg-edit-pencil"
                      className="tap-target flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      aria-label={`编辑第 ${index} 楼`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditMessage(message.id, index);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>编辑本楼</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        {theme === 'social' ? (
          <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
            {showAvatar && (
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isUser ? 'bubble-user' : 'bubble-char'
                }`}
              >
                {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
              </div>
            )}
            <div className={isUser ? 'text-right' : 'text-left'}>
              <div
                className={`inline-block ${classes.content} ${
                  isUser ? 'bubble-user' : 'bubble-char'
                } whitespace-pre-wrap`}
              >
                {previewRule
                  ? renderPreviewHighlight(message.content, previewRule)
                  : <ChatMarkdown text={message.content} search={searchQuery} />}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className={`${classes.content} whitespace-pre-wrap`}>
              {previewRule
                ? renderPreviewHighlight(message.content, previewRule)
                : <ChatMarkdown text={message.content} search={searchQuery} />}
            </div>
          </div>
        )}

        {message.swipeTotal > 1 && onSwipeSelect && !editMode && (
          <div className="mt-1.5 flex items-center gap-0.5 text-xs text-muted-foreground select-none">
            <button
              type="button"
              disabled={message.swipeId <= 0}
              onClick={(e) => {
                e.stopPropagation();
                onSwipeSelect(message.id, message.swipeId - 1);
              }}
              className="tap-target flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="上一条回复版本"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="tabular-nums px-0.5">版本 {message.swipeId + 1}/{message.swipeTotal}</span>
            <button
              type="button"
              disabled={message.swipeId >= message.swipeTotal - 1}
              onClick={(e) => {
                e.stopPropagation();
                onSwipeSelect(message.id, message.swipeId + 1);
              }}
              className="tap-target flex h-5 w-5 items-center justify-center rounded hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
              aria-label="下一条回复版本"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {message.swipeIsSteEdit && (
              <span
                className="ml-1 rounded border border-primary/40 px-1 py-px text-[11px] leading-none text-primary/80"
                title="重复导入时保留的本地修改版（酒馆新回复可通过左右切换查看）"
              >
                本地精修版
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
