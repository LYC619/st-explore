import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { ChevronLeft, ChevronRight, Tags, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PAGE_SIZES, PAGE_SIZE_LABELS, type PageSize } from '@/lib/library-view';

interface LibraryPagerProps {
  total: number;
  page: number;
  pageCount: number;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  onPageChange: (updater: (p: number) => number) => void;
}

/** 分页栏：总数与当前区间 + 每页张数 + 上下页 */
export function LibraryPager({
  total, page, pageCount, pageSize, onPageSizeChange, onPageChange,
}: LibraryPagerProps) {
  useI18n();
  const paged = pageSize !== 'all' && pageCount > 1;
  return (
    <div className="flex items-center gap-2 mt-4 pb-2">
      <span className="text-xs text-[color:var(--text-faint)]">
        {paged
          ? tr("共 {{v0}} 张 · 第 {{v1}}–{{v2}} 张", {
              v0: total,
              v1: (page - 1) * Number(pageSize) + 1,
              v2: Math.min(page * Number(pageSize), total),
            })
          : tr("共 {{v0}} 张", { v0: total })}
      </span>
      <span className="flex-1" />
      <Select value={pageSize} onValueChange={(v) => onPageSizeChange(v as PageSize)}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((s) => (
            <SelectItem key={s} value={s}>{PAGE_SIZE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {paged && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="icon"
            disabled={page <= 1}
            onClick={() => onPageChange((p) => p - 1)}
            aria-label={tr("上一页")}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-xs text-[color:var(--text-muted)] min-w-[3.5rem] text-center">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline" size="icon"
            disabled={page >= pageCount}
            onClick={() => onPageChange((p) => p + 1)}
            aria-label={tr("下一页")}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface LibraryBatchBarProps {
  selectedCount: number;
  filteredCount: number;
  onSelectAllToggle: () => void;
  onTag: () => void;
  onType: () => void;
  onExport: () => void;
  exporting: boolean;
  onDelete: () => void;
  onExit: () => void;
}

/** 批量模式的常驻底栏：全选筛选结果 / 打标签 / 导出 / 删除 */
export function LibraryBatchBar({
  selectedCount, filteredCount, onSelectAllToggle, onTag, onType, onExport, exporting, onDelete, onExit,
}: LibraryBatchBarProps) {
  useI18n();
  const allSelected = selectedCount === filteredCount && filteredCount > 0;
  return (
    // 底边距 = 原来的 2.5rem + 底部标签栏高度 + 安全区。
    // 桌面档两个后项都是 0，等于原来的 bottom-10；手机上抬到标签栏之上，否则整条被压住。
    <div className="fixed bottom-[calc(2.5rem+var(--mobile-tab-bar-h,0px)+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-lg flex-wrap">
      <span className="text-sm">{tr("已选 {{v0}} 张", { v0: selectedCount })}</span>
      <Button variant="ghost" size="sm" className="px-2 text-xs" onClick={onSelectAllToggle}>
        {allSelected ? tr("清空") : tr("全选筛选结果")}
      </Button>
      <Button
        variant="outline" size="sm" className="px-3 text-xs"
        disabled={selectedCount === 0}
        onClick={onTag}
      >
        <Tags className="w-3.5 h-3.5 mr-1" />{tr("打标签")}</Button>
      <Button variant="outline" size="sm" className="px-3 text-xs" disabled={selectedCount === 0} onClick={onType}>{tr("设置类型")}</Button>
      <Button
        variant="outline" size="sm" className="px-3 text-xs"
        disabled={selectedCount === 0 || exporting}
        onClick={onExport}
      >
        <Upload className="w-3.5 h-3.5 mr-1" />
        {exporting ? tr("导出中…") : tr("导出")}
      </Button>
      <Button
        variant="destructive" size="sm" className="px-3 text-xs"
        disabled={selectedCount === 0}
        onClick={onDelete}
      >
        <Trash2 className="w-3.5 h-3.5 mr-1" />{tr("删除")}</Button>
      <Button variant="ghost" size="sm" className="px-2 text-xs text-muted-foreground" onClick={onExit}>{tr("完成")}</Button>
    </div>
  );
}
