import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { CharacterPortrait } from '@/components/library/CharacterPortrait';
import { displayCharacterName } from '@/lib/library-query';
import { introOf } from '@/lib/character-intro';
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { cn } from '@/lib/utils';
import type { ArchiveCharacter } from '@/types/archive';

function RatingTimeBadge({ rating, timestamp, compact = false }: {
  rating?: number;
  timestamp: number;
  compact?: boolean;
}) {
  return (
    <span
      className="flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] bg-[rgba(0,0,0,0.65)] backdrop-blur-sm border border-[rgba(255,255,255,0.12)] min-w-0"
      title={compact ? formatFullTime(timestamp) : undefined}
    >
      <b className="font-semibold text-[color:var(--brand-hi)]">{rating !== undefined ? rating : '未评分'}</b>
      {!compact && (
        <span className="text-white/70 truncate" title={formatFullTime(timestamp)}>
          {formatListTime(timestamp)}
        </span>
      )}
    </span>
  );
}

function StoryCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span data-story-count className={cn(
      'text-[11px] px-2 py-[3px] rounded-full bg-[rgba(0,0,0,0.65)] backdrop-blur-sm text-white border border-[rgba(255,255,255,0.12)] flex items-center gap-1',
      className,
    )}>
      <MessageSquare className="w-3 h-3" />
      {count}
    </span>
  );
}

interface CharacterTileProps {
  character: ArchiveCharacter;
  storyCount: number;
  timestamp: number;
  nameSize: number;
  introSize: number;
  markFontSize?: number | 'default';
  compact?: boolean;
  className?: string;
  onActivate: (shiftKey: boolean) => void;
  batchMode?: boolean;
  selected?: boolean;
  actions?: ReactNode;
  /** 卡面底部快捷动作条（仅在支持鼠标悬停的桌面端悬停/键盘聚焦时滑出，不常驻遮挡立绘） */
  quickAction?: ReactNode;
  dataAttrs?: Record<string, string | undefined>;
}

/**
 * 2:3 立绘卡片。
 * 红线：2:3 比例（ST 标准卡 400×600）不可改、不加左上角编号。
 */
export function CharacterTile({
  character: c, storyCount, timestamp, nameSize, introSize, markFontSize = 'default', className,
  compact = false, onActivate, batchMode = false, selected = false, actions, quickAction, dataAttrs,
}: CharacterTileProps) {
  const displayName = displayCharacterName(c);
  const intro = introOf(c);

  return (
    <article
      aria-label={displayName}
      tabIndex={0}
      data-character-id={c.id}
      data-selected={batchMode && selected ? 'true' : undefined}
      {...dataAttrs}
      className={cn(
        'group relative aspect-[2/3] rounded-xl overflow-hidden cursor-pointer bg-elevated transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)]',
        batchMode && selected && 'ring-2 ring-primary',
        className,
      )}
      onClick={(e) => onActivate(e.shiftKey)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate(e.shiftKey);
        }
      }}
    >
      <CharacterPortrait
        character={c}
        className="group-hover:blur-none group-hover:scale-100"
        markFontSize={markFontSize}
      />

      <div className="absolute top-0 left-0 right-0 z-10 flex justify-between items-start px-2.5 py-2 gap-1.5">
        {batchMode ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={() => onActivate(false)} />
          </span>
        ) : (
          <RatingTimeBadge rating={c.rating} timestamp={timestamp} compact={compact} />
        )}
        <span className="flex items-center gap-1.5 shrink-0">
          <StoryCountBadge count={storyCount} />
          {!batchMode && actions}
        </span>
      </div>

      <div className="absolute left-0 right-0 bottom-0 z-10 px-3.5 pb-3 pt-12 bg-[linear-gradient(transparent,rgba(0,0,0,0.75)_40%,rgba(0,0,0,0.92))]">
        <p
          className="font-serif font-semibold text-white tracking-wide truncate [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]"
          style={{ fontSize: nameSize }}
          title={displayName}
        >
          {displayName}
        </p>
        {intro && (
          <p className="leading-snug text-white/70 line-clamp-2 mt-1" title={intro} style={{ fontSize: introSize }}>
            {intro}
          </p>
        )}
        {!batchMode && quickAction && (
          <div
            className="hidden [@media(hover:hover)]:grid grid-rows-[0fr] opacity-0 transition-all duration-200 group-hover:mt-2 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-within:mt-2 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-h-0 overflow-hidden flex items-center gap-1.5">
              {quickAction}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

export { RatingTimeBadge, StoryCountBadge };
