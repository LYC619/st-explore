import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 角色页故事子视图：总结 / 日记 / 自定义记录 / 故事树 的查看视图。
 * - 默认展示「全部脉络」防分支成果被静默藏起；支持多卷同时展开通读；日记支持切换手账本视图。
 */
import { useMemo, useState, useEffect  } from 'react';
import { BookHeart, ChevronsDownUp, ChevronsUpDown, ExternalLink, LocateFixed, NotebookPen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem, SummaryKind } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import { getAllSummaries } from '@/lib/summary-db';
import { compareSummaryOrder, summaryVolumeLabel } from '@/lib/summary-order';
import { getAllStoryTrees } from '@/lib/story-tree-db';
import { loadAPIConfig } from '@/components/ai-tools';
import { getActiveProfile } from '@/components/ai-tools/api-profiles';
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { MarkdownLite } from '@/components/MarkdownLite';
import { DiaryView } from '@/components/summary/DiaryView';
import { MoveStoryRecordDialog } from './MoveStoryRecordDialog';
import { CaptureRecordDialog } from '@/components/summary/CaptureRecordDialog';
import { RecordsToWorldbookDialog } from '@/components/summary/RecordsToWorldbookDialog';
import { StoryTreePreview } from './StoryTreePreview';
import { EditRecordDialog } from '@/components/summary/EditRecordDialog';

export type RecordViewKind = 'volume' | 'diary' | 'diy' | 'tree';

const KIND_LABELS: Record<RecordViewKind, string> = {
  get volume() { return tr("总结"); },
  get diary() { return tr("日记"); },
  get diy() { return tr("自定义记录"); },
  get tree() { return tr("故事树"); },
};

interface StoryRecordsViewProps {
  stories: ArchiveStory[];
  kind: RecordViewKind;
  /** 去处理区生成：进入 /story/:id 对应整理子页面 */
  onGoGenerate: (storyId: string, kind: RecordViewKind, branchId: string | null) => void;
  /** 点击记录关联楼层直达大屏故事阅读器对应位置 */
  onJumpToFloor?: (storyId: string, branchId: string | null, floor: number) => void;
}

type RecordBranchFilter = 'all' | 'main' | string;

export function StoryRecordsView({ stories, kind, onGoGenerate, onJumpToFloor }: StoryRecordsViewProps) {
  useI18n();
  const { toast } = useToast();
  const [storyId, setStoryId] = useState<string | null>(stories[0]?.id ?? null);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [trees, setTrees] = useState<StoryTree[]>([]);
  const [branchFilter, setBranchFilter] = useState<RecordBranchFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [diaryNotebookIds, setDiaryNotebookIds] = useState<Set<string>>(new Set());
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<SummaryItem | null>(null);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [recordsError, setRecordsError] = useState('');
  const [moveRecord, setMoveRecord] = useState<SummaryItem | StoryTree | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [worldbookOpen, setWorldbookOpen] = useState(false);
  const activeProfile = getActiveProfile();
  const hasAI = Boolean(loadAPIConfig().apiKey || activeProfile?.apiUrl);

  const story = stories.find((s) => s.id === storyId) ?? null;

  useEffect(() => {
    if (!stories.some((item) => item.id === storyId)) setStoryId(stories[0]?.id ?? null);
  }, [stories, storyId]);

  useEffect(() => {
    setBranchFilter('all');
    setExpandedIds(new Set());
    setDiaryNotebookIds(new Set());
    setMoveRecord(null);
  }, [storyId]);

  useEffect(() => {
    setBatchMode(false);
    setSelected(new Set());
    setWorldbookOpen(false);
    setManualOpen(false);
  }, [storyId, kind, branchFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRecords(true);
    setRecordsError('');
    setSummaries([]);
    setTrees([]);
    (async () => {
      if (!storyId) return;
      if (kind === 'tree') {
        const all = await getAllStoryTrees();
        if (!cancelled) setTrees(all.filter((t) => t.bookId === storyId));
      } else {
        const all = await getAllSummaries();
        if (!cancelled) {
          setSummaries(
            all
              .filter((s) => s.bookId === storyId && s.kind === (kind as SummaryKind))
              .sort(compareSummaryOrder),
          );
        }
      }
    })()
      .catch((error: unknown) => {
        if (!cancelled) setRecordsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingRecords(false);
      });
    return () => { cancelled = true; };
  }, [storyId, kind, manualOpen, revision]);

  const branchNameOf = (branchId?: string) => (
    branchId
      ? story?.branches?.find((b) => b.id === branchId)?.name ?? tr("分支已删除")
      : tr("主线")
  );

  const visibleSummaries = useMemo(
    () => summaries.filter((item) => (
      branchFilter === 'all'
        || (branchFilter === 'main' ? !item.branchId : item.branchId === branchFilter)
    )),
    [branchFilter, summaries],
  );
  const visibleTrees = useMemo(
    () => trees.filter((tree) => (
      branchFilter === 'all'
        || (branchFilter === 'main' ? !tree.branchId : tree.branchId === branchFilter)
    )),
    [branchFilter, trees],
  );
  const items = kind === 'tree' ? visibleTrees : visibleSummaries;
  const selectedBranchId = branchFilter !== 'all' && branchFilter !== 'main' ? branchFilter : null;
  const canBatch = kind !== 'tree' && !!story?.characterId && visibleSummaries.length > 0;

  const toggleExpanded = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const toggleDiaryNotebook = (id: string) => setDiaryNotebookIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const toggleSelected = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exitBatchMode = () => { setBatchMode(false); setSelected(new Set()); };

  useEffect(() => {
    const visibleIds = new Set(visibleSummaries.map((item) => item.id));
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => visibleIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
    if (!canBatch) setBatchMode(false);
  }, [visibleSummaries, canBatch]);

  if (stories.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{tr("还没有故事。先导入聊天记录，再来生成{{v0}}。", { v0: KIND_LABELS[kind].toLowerCase() })}
        </CardContent>
      </Card>
    );
  }

  const allExpanded = visibleSummaries.length > 1 && visibleSummaries.every((item) => expandedIds.has(item.id));

  return (
    <div className="space-y-3 font-sans min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={storyId ?? undefined} onValueChange={setStoryId}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder={tr("选择故事")} />
          </SelectTrigger>
          <SelectContent>
            {stories.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(story?.branches?.length ?? 0) > 0 && (
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder={tr("选择脉络")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("全部脉络")}</SelectItem>
              <SelectItem value="main">{tr("主线")}</SelectItem>
              {(story?.branches ?? []).map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {kind !== 'tree' && visibleSummaries.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1"
            onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(visibleSummaries.map((i) => i.id)))}
          >
            {allExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
            {allExpanded ? tr("全部收起") : tr("全部展开")}
          </Button>
        )}
        <div className="flex-1" />
        {canBatch && (
          <Button
            variant={batchMode ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={batchMode}
            onClick={() => (batchMode ? exitBatchMode() : setBatchMode(true))}
          >
            {batchMode ? tr("完成") : tr("批量管理")}
          </Button>
        )}
        {kind !== 'tree' && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setManualOpen(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />{tr("手动录入")}</Button>
        )}
        {story && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onGoGenerate(story.id, kind, selectedBranchId)}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />{tr("去处理区生成")}</Button>
        )}
      </div>

      {batchMode && canBatch && (
        <div aria-label={tr("记录批量管理")} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs">
          <label className="flex min-h-8 cursor-pointer items-center gap-2">
            <Checkbox
              aria-label={tr("全选当前记录")}
              checked={selected.size === visibleSummaries.length ? true : selected.size > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) => setSelected(checked === true ? new Set(visibleSummaries.map((item) => item.id)) : new Set())}
            />{tr("全选当前记录")}</label>
          <span className="text-muted-foreground">{tr("已选 {{v0}} 条", { v0: selected.size })}</span>
          {selected.size > 0 && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setWorldbookOpen(true)}>{tr("加入世界书（{{v0}}）", { v0: selected.size })}
            </Button>
          )}
        </div>
      )}

      {recordsError ? (
        <p role="alert" className="text-sm text-destructive">{tr("读取记录失败：")}{recordsError}</p>
      ) : loadingRecords ? (
        <p role="status" className="text-sm text-muted-foreground">{tr("正在读取记录…")}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
            <NotebookPen className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{tr("这个故事还没有{{v0}}", { v0: KIND_LABELS[kind].toLowerCase() })}</p>
            <p className="text-xs text-muted-foreground/70">
              {hasAI
                ? (kind !== 'tree' ? tr("点「去处理区生成」用 AI 生成，或「手动录入」直接粘贴") : tr("点「去处理区生成」用 AI 生成"))
                : tr("还没配置模型连接：可先到「设置 → AI 配置」配好接口，再回处理区生成") + (kind !== 'tree' ? tr("；也可以「手动录入」") : '')}
            </p>
          </CardContent>
        </Card>
      ) : kind === 'tree' ? (
        <div className="space-y-2">
          {visibleTrees.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-3 px-4">
                <div className="text-sm font-medium flex items-center gap-2">
                  <span className="truncate" title={t.title}>{t.title}</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{branchNameOf(t.branchId)}</Badge>
                  <span className="text-xs text-muted-foreground font-normal shrink-0">
                    {tr("{{v0}} 个节点 · 更新于 {{v1}}", { v0: t.nodes.length, v1: formatListTime(t.updatedAt) })}
                  </span>
                </div>
                <div className="mt-2">
                  <StoryTreePreview
                    key={t.id}
                    tree={t}
                    onJumpToFloor={
                      onJumpToFloor && story
                        ? (floor) => onJumpToFloor(story.id, t.branchId ?? null, floor)
                        : undefined
                    }
                  />
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setMoveRecord(t)}>{tr("移动到其他故事")}</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleSummaries.map((item) => {
            const manual = !item.genParams;
            const expanded = expandedIds.has(item.id);
            const useDiaryNotebook = kind === 'diary' && diaryNotebookIds.has(item.id);
            return (
              <Card
                key={item.id}
                className={cn('cursor-pointer', batchMode && selected.has(item.id) && 'border-primary/60 bg-primary/5')}
                onClick={() => (batchMode ? toggleSelected(item.id) : toggleExpanded(item.id))}
              >
                <CardContent className="py-3 px-4">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {batchMode && (
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox aria-label={tr("选择记录 {{v0}}", { v0: item.title })} checked={selected.has(item.id)} onCheckedChange={() => toggleSelected(item.id)} />
                      </span>
                    )}
                    <span className="truncate" title={item.title}>{item.title}</span>
                    {(item.diaryOwner || item.genParams?.diaryOwner) && (
                      <Badge variant="secondary">{item.diaryOwner || item.genParams?.diaryOwner}</Badge>
                    )}
                    {summaryVolumeLabel(item) && (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{summaryVolumeLabel(item)}</Badge>
                    )}
                    <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{branchNameOf(item.branchId)}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5" title={formatFullTime(item.updatedAt)}>
                    {manual ? tr("手动录入于 {{v0}}", { v0: formatListTime(item.updatedAt) }) : tr("生成于 {{v0}}", { v0: formatListTime(item.updatedAt) })}
                    {item.source && tr(" · 收录自第 {{v0}} 楼", { v0: item.source.floor })}
                    {item.rangeDetached
                      ? item.provenance ? tr(" · 原故事 {{v0}}-{{v1}} 楼", { v0: item.floorStart, v1: item.floorEnd }) : tr(" · 覆盖范围未指定")
                      : tr(" · 覆盖第 {{v0}}-{{v1}} 楼", { v0: item.floorStart, v1: item.floorEnd })}
                  </p>

                  {useDiaryNotebook ? (
                    <div className="mt-3" onClick={(event) => event.stopPropagation()}>
                      <DiaryView
                        content={item.content}
                        charName={item.diaryOwner || item.genParams?.diaryOwner || story?.session?.character?.name}
                      />
                    </div>
                  ) : (
                    <div className={cn('record-reading mt-3', !expanded && 'max-h-36 overflow-hidden')}>
                      <MarkdownLite text={item.content} />
                    </div>
                  )}

                  {!batchMode && (
                    <div className="mt-3 flex flex-wrap gap-2 [&>button]:min-h-11" onClick={(event) => event.stopPropagation()}>
                      {!useDiaryNotebook && (
                        <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => toggleExpanded(item.id)}>
                          {expanded ? tr("收起全文") : tr("展开全文")}
                        </Button>
                      )}
                      {kind === 'diary' && (
                        <Button variant="outline" size="sm" onClick={() => toggleDiaryNotebook(item.id)}>
                          <BookHeart className="w-3.5 h-3.5 mr-1" />
                          {useDiaryNotebook ? tr("切回列表排版") : tr("手账本翻阅")}
                        </Button>
                      )}
                      {onJumpToFloor && story && (!item.rangeDetached && Number.isSafeInteger(item.floorStart) || Number.isSafeInteger(item.source?.floor)) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const floor = !item.rangeDetached && Number.isSafeInteger(item.floorStart)
                              ? item.floorStart
                              : item.source!.floor;
                            onJumpToFloor(story.id, item.branchId ?? null, floor);
                          }}
                          title={tr("打开大屏故事并直达第 #{{v0}} 楼回味原文", { v0: !item.rangeDetached && Number.isSafeInteger(item.floorStart) ? item.floorStart : item.source!.floor })}
                        >
                          <LocateFixed className="w-3.5 h-3.5 mr-1" />{tr("跳到 #{{v0}} 楼回味", { v0: !item.rangeDetached && Number.isSafeInteger(item.floorStart) ? item.floorStart : item.source!.floor })}</Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setEditing(item)}>{tr("编辑记录")}</Button>
                      <Button variant="outline" size="sm" onClick={() => setMoveRecord(item)}>{tr("移动到其他故事")}</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void navigator.clipboard.writeText(item.content)
                          .then(() => toast({ title: tr("已复制正文") }))
                          .catch((error) => toast({ title: tr("复制失败"), description: String(error), variant: 'destructive' }))}
                      >{tr("复制正文")}</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditRecordDialog
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setRevision((value) => value + 1); toast({ title: tr("记录已更新") }); }}
        />
      )}
      {moveRecord && story?.characterId && (
        <MoveStoryRecordDialog
          record={moveRecord}
          kind={kind === 'tree' ? 'tree' : 'summary'}
          stories={stories}
          characterId={story.characterId}
          onClose={() => setMoveRecord(null)}
          onMoved={() => setRevision((value) => value + 1)}
        />
      )}
      {manualOpen && story && kind !== 'tree' && (
        <CaptureRecordDialog
          storyId={story.id}
          branchId={selectedBranchId}
          initialKind={kind}
          onClose={() => setManualOpen(false)}
          onSaved={() => { setRevision((value) => value + 1); toast({ title: tr("已保存{{v0}}", { v0: KIND_LABELS[kind] }) }); }}
        />
      )}
      {worldbookOpen && story?.characterId && (
        <RecordsToWorldbookDialog
          characterId={story.characterId}
          records={visibleSummaries.filter((item) => selected.has(item.id))}
          onClose={() => setWorldbookOpen(false)}
          onSaved={() => { exitBatchMode(); toast({ title: tr("已加入并保存世界书"), description: tr("新增条目默认禁用，可从角色资产打开世界书启用。") }); }}
        />
      )}
    </div>
  );
}
