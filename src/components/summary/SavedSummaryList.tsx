import type { RemoveOptions } from '@/lib/repo';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { MoveRecordDialog } from '@/components/organize/MoveRecordDialog';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { deleteSummary, getAllSummaries } from '@/lib/summary-db';
import { summaryToObsidian } from '@/lib/obsidian-export';
import { exportTextFile, type TextFileExportResult } from '@/lib/text-file-export';
import { SUMMARY_KIND_LABELS, type SummaryItem, type SummaryKind } from '@/types/summary';

interface SavedSummaryListProps {
  currentBookId: string | null;
  refreshKey: number;
  kind: SummaryKind;
  onAdd: () => void;
  onView: (item: SummaryItem) => void;
  onRegenerate: (item: SummaryItem) => void;
  onChanged?: () => void;
}

export function SavedSummaryList({
  currentBookId,
  refreshKey,
  kind,
  onAdd,
  onView,
  onRegenerate,
  onChanged,
}: SavedSummaryListProps) {
  const { toast } = useToast();
  const [all, setAll] = useState<SummaryItem[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveRecord, setMoveRecord] = useState<SummaryItem | null>(null);

  const load = useCallback(() => {
    getAllSummaries().then(setAll).catch(() => setAll([]));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const filtered = useMemo(() => all
    .filter((item) => (!currentBookId || item.bookId === currentBookId) && item.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt), [all, currentBookId, kind]);

  const handleDelete = async (options: RemoveOptions) => {
    if (!deleteId) return;
    await deleteSummary(deleteId, options);
    setDeleteId(null);
    load();
    onChanged?.();
    toast({ title: '已删除' });
  };

  const notifyExport = (result: TextFileExportResult, count = 1) => {
    if (result === 'cancelled') return;
    if (result === 'failed') {
      toast({ title: '导出失败', description: '没有写入任何文件，请重新选择位置后再试。', variant: 'destructive' });
      return;
    }
    toast({ title: count > 1 ? `已导出 ${count} 份总结` : '导出完成' });
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
      suggestedName: `${filtered[0]?.bookTitle || '故事'}-总结合集`,
      content: filtered.map(summaryToObsidian).join('\n\n---\n\n'),
    });
    notifyExport(result, filtered.length);
  };

  return (
    <Card className="h-full min-h-0">
      <CardContent className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className="text-sm font-medium">{SUMMARY_KIND_LABELS[kind]}</span>
          <span className="text-muted-foreground">共 {filtered.length} 条</span>
          <Button variant="ghost" size="icon" className="ml-auto" aria-label="手动添加总结" title="手动添加总结" onClick={onAdd}>
            <Plus className="h-4 w-4" />
          </Button>
          {filtered.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1 px-2" onClick={() => void handleExportAll()}>
              <Upload className="w-3 h-3" />导出全部
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">暂无总结</p>
        ) : (
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
            {filtered.map((item) => (
              <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent/40 text-sm">
                <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0">{SUMMARY_KIND_LABELS[item.kind]}</Badge>
                {item.volumeNumber != null && <span className="text-xs text-muted-foreground shrink-0">第{item.volumeNumber}卷</span>}
                <span className="truncate flex-1" title={item.title}>{item.title || '（无标题）'}</span>
                <span className="text-xs text-muted-foreground shrink-0">{item.rangeDetached ? "原来源 " : ""}{item.floorStart}~{item.floorEnd}</span>
                {!item.autoSaved && <Badge variant="secondary" className="text-[11px] px-1 py-0 shrink-0">永久</Badge>}
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" title="查看或编辑" onClick={() => onView(item)}><Eye className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" title={item.rangeDetached ? "请先在编辑器关联目标楼层" : "用相同设置重新生成"} disabled={item.rangeDetached} onClick={() => onRegenerate(item)}><RotateCcw className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => setMoveRecord(item)}>移动</Button>
                  <Button variant="ghost" size="icon" title="导出 Markdown" onClick={() => void handleExport(item)}><Upload className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="text-destructive" title="删除" onClick={() => setDeleteId(item.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="shrink-0 text-xs text-muted-foreground">标“永久”的是手动保存记录；其他为自动暂存。查看后会切换到详情编辑。</p>
      </CardContent>

      <DeleteConfirmDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}
        title="删除这条总结？" description="该记录将从列表移除。"
        fileTarget={deleteId ? { store: 'summaries', id: deleteId } : undefined} onConfirm={handleDelete} />
      <MoveRecordDialog open={!!moveRecord} record={moveRecord} onOpenChange={open => { if (!open) setMoveRecord(null); }}
        onMoved={item => { load(); onChanged?.(); toast({ title: '记录已移动', description: item.bookTitle }); }} />
    </Card>
  );
}
