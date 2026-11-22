import { cn } from '@/lib/utils';

/**
 * 骨架占位块。
 * 首屏用骨架代替裸文字跳变，数据到位时平滑填色。
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-skeleton
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-elevated-strong', className)}
      {...props}
    />
  );
}

/** 卡墙骨架：跟真卡一样 2:3 图 + 名字行 + 简介行 */
export function CharacterGridSkeleton({
  count = 8,
  gridTemplateColumns,
}: {
  count?: number;
  gridTemplateColumns?: string;
}) {
  return (
    <div className="grid gap-3.5 content-start" style={{ gridTemplateColumns }} data-character-grid-skeleton>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full rounded-xl" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** 故事/聊天列表骨架：立绘缩略图 + 两行文字 */
export function StoryListSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-label="正在加载故事列表" data-story-list-skeleton>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-3.5 py-3"
        >
          <Skeleton className="aspect-[3/4] h-12 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** 预设库 / 附属库资产卡片网格骨架 */
export function AssetGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div
      data-asset-grid-skeleton
      role="status"
      aria-label="正在加载收藏条目"
      className={cn(
        'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="h-3 w-4/5" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 双栏工作台骨架（用于美化配置、成品前端等面板载入） */
export function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-panel-skeleton
      role="status"
      aria-label="正在读取配置"
      className={cn('grid gap-5 lg:grid-cols-2', className)}
    >
      <div className="space-y-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5">
        <Skeleton className="h-5 w-1/3" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
      <div className="space-y-4 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5">
        <Skeleton className="h-5 w-1/4" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** 顶部刷新指示条 */
export function RefreshIndicator({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <div
      data-refresh-indicator
      role="status"
      aria-label="正在刷新"
      className={cn('sticky top-0 z-20 h-0.5 overflow-hidden bg-elevated-strong', className)}
    >
      <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
    </div>
  );
}
