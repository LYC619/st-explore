import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CharacterIndexEntry, StoryIndexEntry } from '@/lib/archive-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { presetOptionLabel } from '@/lib/preset-catalog';
import { formatFullTime, formatListTime } from '@/lib/time-display';

export interface ChatHubStoryRowProps {
  story: StoryIndexEntry;
  charEntry?: CharacterIndexEntry;
  charName: string;
  presets: AssetIndexEntry[];
  isLiveDetached: boolean;
  isMobile: boolean;
  onOpenChat: (storyId: string) => void;
  onOpenDetached: (storyId: string) => void;
  onOpenReader: (storyId: string) => void;
  onChangeStoryPreset: (storyId: string, presetId: string | null) => Promise<void>;
  onRenameStory: (storyId: string, nextTitle: string) => Promise<void>;
  onRequestDelete: (story: StoryIndexEntry) => void;
}

export function ChatHubStoryRow({
  story,
  charEntry,
  charName,
  presets,
  isLiveDetached,
  isMobile,
  onOpenChat,
  onOpenDetached,
  onOpenReader,
  onChangeStoryPreset,
  onRenameStory,
  onRequestDelete,
}: ChatHubStoryRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(story.title);
  const [busyPreset, setBusyPreset] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const cancellingRef = useRef(false);
  const savingRef = useRef(false);
  const renamingPendingFocusRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming || renamingPendingFocusRef.current) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  const branchCount = story.branchIndex?.length ?? 0;
  const storyPresetRef = story.assets?.find((ref) => ref.kind === 'preset');
  const charPresetRef = charEntry?.assets?.find((ref) => ref.kind === 'preset');
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  const activePresets = presets.filter((p) => p.catalog?.status !== 'retired' || p.id === storyPresetRef?.assetId);

  const storyPresetItem = storyPresetRef ? presetMap.get(storyPresetRef.assetId) : undefined;
  const charPresetItem = charPresetRef ? presetMap.get(charPresetRef.assetId) : undefined;
  const presetBadgeText = storyPresetItem
    ? presetOptionLabel(storyPresetItem)
    : charPresetItem
      ? `随角色 · ${presetOptionLabel(charPresetItem)}`
      : '默认预设';

  const beginRename = () => {
    if (isLiveDetached) return;
    cancellingRef.current = false;
    renamingPendingFocusRef.current = true;
    setDraftTitle(story.title);
    setRenaming(true);
  };

  const cancelRename = () => {
    cancellingRef.current = true;
    setDraftTitle(story.title);
    setRenaming(false);
  };

  const commitRename = async () => {
    if (renamingPendingFocusRef.current) return;
    if (cancellingRef.current) {
      cancellingRef.current = false;
      return;
    }
    if (savingRef.current || isLiveDetached) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === story.title) {
      setRenaming(false);
      return;
    }
    savingRef.current = true;
    setSavingTitle(true);
    try {
      await onRenameStory(story.id, trimmed);
      setRenaming(false);
    } catch {
      /* Parent already surfaced destructive toast; retain edit state for retry or Escape. */
    } finally {
      savingRef.current = false;
      setSavingTitle(false);
    }
  };

  const selectPreset = async (presetId: string | null) => {
    if (busyPreset || isLiveDetached) return;
    setBusyPreset(true);
    try {
      await onChangeStoryPreset(story.id, presetId);
    } finally {
      setBusyPreset(false);
    }
  };

  const presetMenuItems = (
    <>
      <DropdownMenuItem onSelect={() => { void selectPreset(null); }}>
        <Check className={`mr-2 h-3.5 w-3.5 ${!storyPresetRef ? 'opacity-100 text-brand' : 'opacity-0'}`} />
        <span className="truncate">{charPresetItem ? `跟随角色预设（${presetOptionLabel(charPresetItem)}）` : '不单设（使用角色或默认预设）'}</span>
      </DropdownMenuItem>
      {activePresets.map((p) => {
        const selected = storyPresetRef?.assetId === p.id;
        const label = presetOptionLabel(p);
        return (
          <DropdownMenuItem key={p.id} onSelect={() => { void selectPreset(p.id); }}>
            <Check className={`mr-2 h-3.5 w-3.5 shrink-0 ${selected ? 'opacity-100 text-brand' : 'opacity-0'}`} />
            <span className="truncate" title={label}>{label}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );

  return (
    <div className="group flex min-w-0 items-center gap-2 px-3 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-[var(--hover-overlay)] sm:px-4">
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {charEntry ? (
            <span className="relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-lg bg-chrome shadow-sm">
              <CharacterPortrait character={charEntry} markFontSize={15} />
            </span>
          ) : (
            <span aria-hidden="true" className="flex aspect-[3/4] w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--hover-overlay)] font-serif text-sm font-semibold text-brand">
              {Array.from(charName)[0]}
            </span>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Input
              ref={renameInputRef}
              aria-label="对话名称"
              disabled={savingTitle}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => { void commitRename(); }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              className="text-base sm:text-sm"
              size="md"
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label={'继续 ' + story.title}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand rounded-md"
          onClick={() => onOpenChat(story.id)}
        >
          {charEntry ? (
            <span className="relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-lg bg-chrome shadow-sm">
              <CharacterPortrait character={charEntry} markFontSize={15} />
            </span>
          ) : (
            <span aria-hidden="true" className="flex aspect-[3/4] w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--hover-overlay)] font-serif text-sm font-semibold text-brand">
              {Array.from(charName)[0]}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate font-serif text-[15px] font-medium text-[color:var(--text-primary)] group-hover:text-brand transition-colors">
                {story.title}
              </span>
              {isLiveDetached && (
                <Badge variant="secondary" className="shrink-0 text-[11px] font-normal text-brand">
                  独立窗口中
                </Badge>
              )}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <span className="truncate max-w-36 sm:max-w-44">{charName}</span>
              <span>·</span>
              <span>{story.floorCount} 楼</span>
              {branchCount > 0 && (
                <>
                  <span>·</span>
                  <span className="text-brand">{branchCount} 条支线</span>
                </>
              )}
              <span className="sm:hidden">· {formatListTime(story.updatedAt)}</span>
            </span>
          </span>
        </button>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {!isMobile && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyPreset || isLiveDetached}
                className="hidden md:inline-flex max-w-40 px-2 text-[11px] text-[color:var(--text-muted)] hover:text-foreground"
                aria-label={`选择 ${story.title} 的预设`}
                title={
                  isLiveDetached
                    ? `正在独立窗口对话中（当前：${presetBadgeText}），请直接在酒馆窗口内切换预设`
                    : `当前预设：${presetBadgeText}（点击切换本场对话预设）`
                }
              >
                <SlidersHorizontal className="mr-1 h-3 w-3 shrink-0" />
                <span className="truncate">{presetBadgeText}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换本场对话挂载预设</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {presetMenuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <span
          className="hidden sm:inline-block shrink-0 px-1.5 text-xs text-[color:var(--text-muted)]"
          title={formatFullTime(story.updatedAt)}
        >
          {formatListTime(story.updatedAt)}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden sm:inline-flex px-2 text-xs text-[color:var(--text-muted)] hover:text-foreground"
          aria-label={`去阅读整理 ${story.title}`}
          title="前往大屏阅读与整理工作台"
          onClick={() => onOpenReader(story.id)}
        >
          <BookOpen className="mr-1 h-3.5 w-3.5" />
          阅读整理
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="tap-target shrink-0 text-[color:var(--text-muted)] hover:text-foreground"
              aria-label={`${story.title} 更多操作`}
              title="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52"
            onCloseAutoFocus={(e) => {
              if (renamingPendingFocusRef.current) {
                e.preventDefault();
                renamingPendingFocusRef.current = false;
                requestAnimationFrame(() => {
                  renameInputRef.current?.focus();
                  renameInputRef.current?.select();
                });
              }
            }}
          >
            <DropdownMenuItem onSelect={() => onOpenReader(story.id)}>
              <BookOpen className="mr-2 h-3.5 w-3.5" />
              去阅读整理
            </DropdownMenuItem>
            {!isMobile && (
              <DropdownMenuItem onSelect={() => onOpenDetached(story.id)}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                独立窗口分屏续聊
              </DropdownMenuItem>
            )}
            {isMobile && !isLiveDetached && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                  <span className="truncate">预设：{presetBadgeText}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56 max-h-64 overflow-y-auto">
                  {presetMenuItems}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem disabled={isLiveDetached} onSelect={beginRename}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {isLiveDetached ? '重命名（对话中暂锁）' : '重命名对话'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => onRequestDelete(story)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              删除对话
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ArrowRight
          aria-hidden="true"
          className="hidden sm:block h-4 w-4 shrink-0 text-[color:var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
        />
      </div>
    </div>
  );
}
