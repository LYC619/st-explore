import type { ReactNode, RefObject } from 'react';
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List as ListIcon,
  Plus, Search, SlidersHorizontal, Tags, PanelsTopLeft, X,
} from 'lucide-react';
import { HelpCard } from '@/components/HelpCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { LIBRARY_GROUP_BY_OPTIONS, type LibraryGroupBy } from '@/lib/library-grouping';
import type { LibrarySortKey } from '@/lib/library-query';
import { cn } from '@/lib/utils';
import {
  CARD_W_MAX, CARD_W_MIN, FONT_MAX, FONT_MIN, SORT_LABELS,
  type ViewMode,
} from '@/lib/library-view';

interface LibraryToolbarProps {
  characterCount: number;
  filteredCount?: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchInputRef?: RefObject<HTMLInputElement>;
  onOpenTagManager: () => void;
  batchMode: boolean;
  onToggleBatchMode: () => void;
  sortKey: LibrarySortKey;
  onSortKeyChange: (key: LibrarySortKey) => void;
  sortAsc: boolean;
  onSortAscToggle: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  groupBy: LibraryGroupBy;
  onGroupByChange: (value: LibraryGroupBy) => void;
  groupTagCategory: string;
  groupTagCategories: string[];
  onGroupTagCategoryChange: (value: string) => void;
  cardWidth: number;
  onCardWidthChange: (value: number) => void;
  fontScale: number;
  onFontScaleChange: (value: number) => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onPickFiles: (files: FileList | null) => void;
  storyPackageTools?: ReactNode;
  reviewFilters?: ReactNode;
}

/** 顶栏一行：标题 / 搜索 / 排序+方向 / 分组 / 外观 / 导入 */
export function LibraryToolbar({
  characterCount, filteredCount = characterCount, searchQuery, onSearchChange, searchInputRef, onOpenTagManager,
  batchMode, onToggleBatchMode,
  sortKey, onSortKeyChange, sortAsc, onSortAscToggle,
  viewMode, onViewModeChange, groupBy, onGroupByChange,
  groupTagCategory, groupTagCategories, onGroupTagCategoryChange,
  cardWidth, onCardWidthChange, fontScale, onFontScaleChange,
  fileInputRef, onPickFiles, storyPackageTools, reviewFilters,
}: LibraryToolbarProps) {
  return (
    <div className="shrink-0 flex items-center gap-2.5 px-6 pt-4 pb-2 flex-wrap">
      <h1 className="font-serif text-[22px] font-semibold tracking-wide text-[color:var(--text-primary)]">角色库</h1>
      <span aria-label="当前筛选角色数" className="text-xs text-[color:var(--text-faint)]">{filteredCount === characterCount ? `${characterCount} 张` : `${filteredCount} / ${characterCount} 张`}</span>
      <HelpCard>
        角色库是私人收藏馆：导入 ST 角色卡（PNG/JSON）建立档案，聊天记录以「故事」形式挂在角色名下。类型、标签、评分都是 STE 本地整理信息，不会写回角色卡文件。
      </HelpCard>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={searchInputRef}
          placeholder="搜索角色或标签"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-44 pl-7 pr-6 text-sm"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => onSearchChange('')}
            className="tap-target absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline-block rounded border border-border/70 bg-muted/60 px-1 text-[11px] font-mono text-muted-foreground"
          >
            /
          </kbd>
        )}
      </div>
      <Button aria-label="标签管理" variant="outline" size="sm" onClick={onOpenTagManager}>
        <Tags className="w-3.5 h-3.5 mr-1.5" />
        标签管理
      </Button>
      {characterCount > 1 && viewMode !== 'review' && (
        <Button
          variant={batchMode ? 'default' : 'outline'}
          size="sm"
          aria-pressed={batchMode}
          onClick={onToggleBatchMode}
        >
          {batchMode ? '完成' : '批量管理'}
        </Button>
      )}
      <span className="flex-1" />
      <div
        role="group"
        aria-label="切换浏览视图"
        className="flex items-center rounded-md border border-border bg-[var(--bg-canvas)] overflow-hidden shrink-0"
      >
        {([
          { mode: 'grid' as const, label: '网格视图', shortLabel: '网格', Icon: LayoutGrid, extra: '' },
          { mode: 'list' as const, label: '列表视图', shortLabel: '列表', Icon: ListIcon, extra: 'border-l border-border' },
          { mode: 'review' as const, label: '回顾视图', shortLabel: '回顾', Icon: PanelsTopLeft, extra: 'border-l border-border' },
        ]).map(({ mode, label, shortLabel, Icon, extra }) => {
          const active = viewMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-label={label}
              aria-pressed={active}
              title={mode === 'review' && active ? '退出回顾，返回网格视图' : label}
              onClick={() => onViewModeChange(mode === 'review' && active ? 'grid' : mode)}
              className={cn(
                'tap-target h-8 px-2.5 flex items-center gap-1 text-xs transition-colors',
                extra,
                active
                  ? 'bg-[var(--brand-active-bg)] text-brand font-medium'
                  : 'text-[color:var(--sidebar-text-muted)] hover:text-[color:var(--sidebar-text)] hover:bg-[var(--hover-overlay)]',
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{shortLabel}</span>
            </button>
          );
        })}
      </div>
      {viewMode === 'review' && reviewFilters}
      <Select value={sortKey} onValueChange={(v) => onSortKeyChange(v as LibrarySortKey)}>
        <SelectTrigger aria-label="角色排序" className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABELS) as LibrarySortKey[]).map((k) => (
            <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        title={sortAsc ? '当前升序，点击切换降序' : '当前降序，点击切换升序'}
        aria-label="切换排序方向"
        onClick={onSortAscToggle}
      >
        {sortAsc ? <ArrowUpNarrowWide className="w-4 h-4" /> : <ArrowDownWideNarrow className="w-4 h-4" />}
      </Button>
      {viewMode === 'grid' && (
        <>
          <Select value={groupBy} onValueChange={(value) => onGroupByChange(value as LibraryGroupBy)}>
            <SelectTrigger
              aria-label="分组方式"
              title="像资料库一样按字段分组展示；按多选标签分组时，一张卡可能出现在多个标签组"
              className="h-8 w-28 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIBRARY_GROUP_BY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.value === 'none' ? option.label : `按${option.label}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groupBy === 'tag' && (
            <Select value={groupTagCategory} onValueChange={onGroupTagCategoryChange}>
              <SelectTrigger aria-label="标签分组分类" className="h-8 w-28 text-xs">
                <SelectValue placeholder="选择一级标签" />
              </SelectTrigger>
              <SelectContent>
                {groupTagCategories.map((category) => (
                  <SelectItem key={category} value={category}>{category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      )}
      {/* 外观：卡片大小 / 字体大小 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="外观：卡片与字体大小">
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
            外观
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-4">
          {viewMode === 'grid' && (
            <div>
              <p className="text-xs font-medium text-[color:var(--sidebar-text-muted)] mb-2">卡片大小</p>
              <Slider
                value={[cardWidth]}
                min={CARD_W_MIN}
                max={CARD_W_MAX}
                step={10}
                onValueChange={([v]) => onCardWidthChange(v)}
                aria-label="卡片大小"
              />
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-[color:var(--sidebar-text-muted)] mb-2">卡面字体大小</p>
            <Slider
              value={[fontScale]}
              min={FONT_MIN}
              max={FONT_MAX}
              step={0.05}
              onValueChange={([v]) => onFontScaleChange(v)}
              aria-label="卡面字体大小"
            />
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={() => fileInputRef.current?.click()}>
          <Plus className="w-4 h-4 mr-1.5" />
          导入角色卡
        </Button>
        {storyPackageTools}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.json"
        multiple
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
    </div>
  );
}
