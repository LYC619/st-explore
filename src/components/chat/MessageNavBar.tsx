import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Star, Bookmark, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/** 收藏楼层在列表里展示用的信息（由父组件按 messageId 解析好传入） */
export interface FavoriteItem {
  messageId: string;
  /** 0-based 原始楼层号；解析不到时为 null */
  floor: number | null;
  /** 正文片段，帮用户辨认这条书签 */
  snippet: string;
}

interface MessageNavBarProps {
  /** 可见楼层数（为 0 时禁用翻页） */
  floorCount: number;
  /** 最大原始楼层号（默认 floorCount - 1） */
  maxFloor?: number;
  /** 最小可见原始楼层号（默认 0） */
  minFloor?: number;
  /** 当前顶部可见楼层（0-based 原始楼层号） */
  currentFloor: number;
  /** 当前顶部楼层的 messageId，用于判断是否已收藏 */
  currentMessageId: string | null;
  favorites: FavoriteItem[];
  onJumpToFloor: (floor: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onFirst?: () => void;
  onLast?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  onToggleFavorite: (messageId: string) => void;
  onJumpToMessageId: (messageId: string) => void;
  /** 避开上方实际占用的返回栏与工具栏。 */
  stickyTop?: number;
}

/**
 * 正文左侧的竖向跳转条，由预览容器提供本地 sticky 定位：
 * - 首楼 / 上一楼 / 下一楼 / 末楼
 * - 楼层号输入跳转（仅按 Enter 提交，失焦/Esc 自动恢复不误跳）
 * - 收藏/取消当前顶部楼层（轻量书签，不进导出）
 * - 收藏列表 popover，点一条跳过去
 */
export function MessageNavBar({
  floorCount,
  maxFloor,
  minFloor = 0,
  currentFloor,
  currentMessageId,
  favorites,
  onJumpToFloor,
  onPrev,
  onNext,
  onFirst,
  onLast,
  canPrev,
  canNext,
  onToggleFavorite,
  onJumpToMessageId,
  stickyTop = 0,
}: MessageNavBarProps) {
  useI18n();
  const [floorInput, setFloorInput] = useState(String(currentFloor));
  const [editing, setEditing] = useState(false);

  const effectiveMaxFloor = maxFloor !== undefined ? Math.max(maxFloor, 0) : Math.max(floorCount - 1, 0);
  const prevEnabled = canPrev !== undefined ? canPrev : floorCount > 0 && currentFloor > minFloor;
  const nextEnabled = canNext !== undefined ? canNext : floorCount > 0 && currentFloor < effectiveMaxFloor;

  // 滚动导致当前楼层变化时同步输入框（用户正在输入时不抢）
  useEffect(() => {
    if (!editing) setFloorInput(String(currentFloor));
  }, [currentFloor, editing]);

  const isCurrentFavorited = !!currentMessageId && favorites.some((f) => f.messageId === currentMessageId);

  const commitJump = () => {
    const n = parseInt(floorInput, 10);
    if (!Number.isNaN(n) && floorCount > 0) {
      const clamped = Math.min(Math.max(n, 0), effectiveMaxFloor);
      onJumpToFloor(clamped);
      setFloorInput(String(clamped));
    } else {
      setFloorInput(String(currentFloor));
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setFloorInput(String(currentFloor));
    setEditing(false);
  };

  return (
    <TooltipProvider>
      <div
        className="sticky self-start z-30 flex shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-card/90 px-1.5 py-2 shadow-md backdrop-blur-sm"
        style={{ top: stickyTop }}
      >
        {/* 首楼 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={tr("首楼")}
              variant="ghost"
              size="icon"
              onClick={onFirst ?? (() => onJumpToFloor(minFloor))}
              disabled={!prevEnabled}
            >
              <ChevronsUp className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{tr("跳至首楼")}</TooltipContent>
        </Tooltip>

        {/* 上一楼 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label={tr("上一楼")} variant="ghost" size="icon" onClick={onPrev} disabled={!prevEnabled}>
              <ChevronUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{tr("上一楼")}</TooltipContent>
        </Tooltip>

        {/* 楼层号输入 + 当前/总楼 */}
        <form
          className="flex flex-col items-center gap-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            commitJump();
          }}
        >
          <Input
            size="sm"
            value={floorInput}
            onChange={(e) => { setEditing(true); setFloorInput(e.target.value.replace(/[^0-9]/g, '')); }}
            onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
            onBlur={cancelEdit}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                commitJump();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
                e.currentTarget.blur();
              }
            }}
            className="w-11 px-1 text-center text-xs tabular-nums"
            inputMode="numeric"
            enterKeyHint="go"
            title={tr("输入楼层号后按回车跳转")}
            aria-label={tr("跳转到楼层")}
          />
          <span className="text-[11px] leading-none text-muted-foreground tabular-nums">/ {effectiveMaxFloor}</span>
        </form>

        {/* 下一楼 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label={tr("下一楼")} variant="ghost" size="icon" onClick={onNext} disabled={!nextEnabled}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{tr("下一楼")}</TooltipContent>
        </Tooltip>

        {/* 末楼 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={tr("末楼")}
              variant="ghost"
              size="icon"
              onClick={onLast ?? (() => onJumpToFloor(effectiveMaxFloor))}
              disabled={!nextEnabled}
            >
              <ChevronsDown className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{tr("跳至末楼")}</TooltipContent>
        </Tooltip>

        <div className="my-0.5 h-px w-6 bg-border" />

        {/* 收藏当前顶部楼层 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={isCurrentFavorited ? tr("取消收藏当前楼层") : tr("收藏当前楼层")}
              disabled={!currentMessageId}
              onClick={() => currentMessageId && onToggleFavorite(currentMessageId)}
            >
              <Star className={`h-4 w-4 ${isCurrentFavorited ? 'fill-primary text-primary' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{isCurrentFavorited ? tr("取消收藏当前楼层") : tr("收藏当前楼层")}</TooltipContent>
        </Tooltip>

        {/* 收藏列表 */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label={tr("收藏列表")}>
                  <Bookmark className="h-4 w-4" />
                  {favorites.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground">
                      {favorites.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{tr("收藏列表")}</TooltipContent>
          </Tooltip>
          <PopoverContent side="right" align="center" className="w-72 p-0">
            {favorites.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">{tr("还没有收藏的楼层")}<br />
                <span className="text-xs">{tr("可点每楼右上角的「☆」或上方星标收藏")}</span>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto overscroll-contain">
                <div className="py-1">
                  {favorites.map((f) => (
                    <div key={f.messageId} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onJumpToMessageId(f.messageId)}
                        className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                      >
                        <span className="mt-0.5 shrink-0 font-mono text-xs text-primary">
                          {f.floor !== null ? `#${f.floor}` : '—'}
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground" title={f.snippet}>{f.snippet}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mr-1 shrink-0"
                        aria-label={f.floor !== null ? tr("删除第 {{v0}} 楼书签", { v0: f.floor }) : tr("删除失效书签")}
                        title={tr("删除书签")}
                        onClick={() => onToggleFavorite(f.messageId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
