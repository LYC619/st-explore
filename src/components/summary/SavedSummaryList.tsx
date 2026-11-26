import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import type { RemoveOptions } from '@/lib/repo';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { MoveRecordDialog } from '@/components/organize/MoveRecordDialog';
import { useMemo, useCallback, useEffect, useState  } from 'react';
import { Eye, LocateFixed, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { deleteSummary, getAllSummaries } from '@/lib/summary-db';
import { summaryToObsidian } from '@/lib/obsidian-export';
import { exportTextFile, type TextFileExportResult } from '@/lib/text-file-export';
import { SUMMARY_KIND_LABELS, type SummaryItem, type SummaryKind } from '@/types/summary';
import { compareSummaryOrder, summaryVolumeLabel } from '@/lib/summary-order';

interface SavedSummaryListProps {
  currentBookId: string | null;
  refreshKey: number;
  kind: SummaryKind;
  onAdd: () => void;
  onView: (item: SummaryItem) => void;
  onRegenerate: (item: SummaryItem) => void;
  onChanged?: () => void;
  onJumpToFloor?: (floor: number, branchId?: string | null) => void;
}

export function SavedSummaryList({
  currentBookId,
  refreshKey,
  kind,
  onAdd,
  onView,
  onRegenerate,
  onChanged,
  onJumpToFloor,
}: SavedSummaryListProps) {
  useI18n();
  const { toast } = useToast();
  const [all, setAll] = useState<SummaryItem[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveRecord, setMoveRecord] = useState<SummaryItem | null>(null);

  const load = useCallback(() => {
    getAllSummaries()
      .then((list) => {
        setAll(list);
        setLoadFailed(false);
      })
      .catch(() => {
        setLoadFailed(true);
      });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = useMemo(() => all
    .filter((item) => (!currentBookId || item.bookId === currentBookId) && item.kind === kind)
    .sort(compareSummaryOrder), [all, currentBookId, kind]);

  const handleDelete = async (options: RemoveOptions) => {
    if (!deleteId) return;
    await deleteSummary(deleteId, options);
    setDeleteId(null);
    load();
    onChanged?.();
    toast({ title: tr("已删除") });
  };

  const notifyExport = (result: TextFileExportResult, count = 1) => {
    if (result === 'cancelled') return;
    if (result === 'failed') {
      toast({ title: tr("导出失败"), description: tr("没有写入任何文件，请重新选择位置后再试。"), variant: 'destructive' });
      return;
    }
    toast({ title: count > 1 ? tr("已导出 {{v0}} 份总结", { v0: count }) : tr("导出完成") });
  };

  const handleExport = async (item: SummaryItem) => {
    const result = await exportTextFile({
      suggestedName: item.title || SUMMARY_KIND_LABELS[item.kind],
      content: summaryToObsidian(item),
    });
    notifyExport(result);
  };

  const handleExportAll = async () => {
    if (filtered.length === 0) return;
    const result = await exportTextFile({
      suggestedName: tr("{{v0}}-总结合集", { v0: filtered[0]?.bookTitle || tr("故事") }),
      content: filtered.map(summaryToObsidian).join('\n\n---\n\n'),
    });
    notifyExport(result, filtered.length);
  };

  return (
    <Card className="h-full min-h-0">
      <CardContent className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <span className="text-sm font-medium">{SUMMARY_KIND_LABELS[kind]}</span>
          <span className="text-muted-foreground">{tr("共 ")}{filtered.length}{tr(" 条")}</span>
          <Button variant="outline" size="sm" className="ml-auto gap-1" aria-label={tr("手动添加总结")} title={tr("手动添加总结")} onClick={onAdd}>
            <Plus className="h-4 w-4" />{tr("手动添加")}</Button>
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1 px-2" onClick={() => void handleExportAll()}>
              <Upload className="w-3 h-3" />{tr("导出全部")}</Button>
          )}
        </div>

        {loadFailed ? (
          <div role="alert" className="py-6 text-center space-y-2">
            <p className="text-sm text-destructive">{tr("读取已保存记录失败，库内原有记录并未丢失。")}</p>
            <Button variant="outline" size="sm" onClick={load}>{tr("重试读取")}</Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tr("暂无已保存记录，可在左侧生成或点右上角手动添加")}</p>
        ) : (
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1 scrollbar-thin">
            {filtered.map((item) => {
              const jumpFloor = !item.rangeDetached && Number.isSafeInteger(item.floorStart)
                ? item.floorStart
                : (Number.isSafeInteger(item.source?.floor) ? item.source!.floor : null);
              const canJump = jumpFloor !== null && !!onJumpToFloor;
              return (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent/40 text-sm">
                  <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0">{SUMMARY_KIND_LABELS[item.kind]}</Badge>
                  {summaryVolumeLabel(item) && <span className="text-xs text-muted-foreground shrink-0">{summaryVolumeLabel(item)}</span>}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:text-primary transition-colors"
                    onClick={() => onView(item)}
                  >
                    <span className="block truncate" title={item.title || tr("（无标题）")}>
                      {item.title || tr("（无标题）")}
                    </span>
                  </button>
                  {canJump ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10 shrink-0 tabular-nums"
                      title={tr("跳回第 #{{v0}} 楼原文", { v0: jumpFloor })}
                      onClick={() => onJumpToFloor!(jumpFloor, item.branchId ?? null)}
                    >
                      <LocateFixed className="h-3 w-3" />
                      {item.rangeDetached ? `#${jumpFloor}` : `#${item.floorStart}~${item.floorEnd}`}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {item.rangeDetached ? tr("原来源 ") : '#'}{item.floorStart}~{item.floorEnd}
                    </span>
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button variant="ghost" size="icon" aria-label={tr("查看或编辑")} title={tr("查看或编辑")} onClick={() => onView(item)}><Eye className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" aria-label={tr("用相同设置重新生成")} title={item.rangeDetached ? tr("请先在编辑器关联目标楼层") : tr("用相同设置重新生成")} disabled={item.rangeDetached} onClick={() => onRegenerate(item)}><RotateCcw className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setMoveRecord(item)}>{tr("移动")}</Button>
                    <Button variant="ghost" size="icon" aria-label={tr("导出 Markdown")} title={tr("导出 Markdown")} onClick={() => void handleExport(item)}><Upload className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" aria-label={tr("删除记录")} title={tr("删除")} onClick={() => setDeleteId(item.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="shrink-0 text-xs text-muted-foreground">{tr("所有已生成与手动添加的记录都会长久保存；点击标题可展开详情编辑，点击楼层范围可跳回原文。")}</p>
      </CardContent>

      <DeleteConfirmDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title={tr("删除这条总结？")} description={tr("该记录将从列表移除。")}
        fileTarget={deleteId ? { store: 'summaries', id: deleteId } : undefined} onConfirm={handleDelete} />
      <MoveRecordDialog open={!!moveRecord} record={moveRecord} onOpenChange={(open) => { if (!open) setMoveRecord(null); }}
        onMoved={(item) => { load(); onChanged?.(); toast({ title: tr("记录已移动"), description: item.bookTitle }); }} />
    </Card>
  );
}
