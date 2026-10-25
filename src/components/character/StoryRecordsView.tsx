/**
 * 角色页故事子视图：总结 / 日记 / 故事树 的查看视图（10.3b，C2）。
 * - 故事切换下拉 + 「去处理区生成」（工作区左上角已有返回按钮）+ 手动录入入口
 * - 条目展示「生成于 X · 覆盖 A-B 楼」（不做"已过期"判断——分卷增量总结会被误判，
 *   过没过期用户自己看）；手动录入的条目显示「手动录入」
 * - 未配 AI 时空态提示去 AI 工具页配置
 */
import { useState, useEffect, useMemo } from 'react';
import { ExternalLink, NotebookPen, Plus } from 'lucide-react';
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
import { formatFullTime, formatListTime } from '@/lib/time-display';
import { MarkdownLite } from '@/components/MarkdownLite';
import { MoveStoryRecordDialog } from './MoveStoryRecordDialog';
import { CaptureRecordDialog } from '@/components/summary/CaptureRecordDialog';
import { RecordsToWorldbookDialog } from '@/components/summary/RecordsToWorldbookDialog';
import { StoryTreePreview } from './StoryTreePreview';

export type RecordViewKind = 'volume' | 'diary' | 'tree';

const KIND_LABELS: Record<RecordViewKind, string> = { volume: '总结', diary: '日记', tree: '故事树' };

interface StoryRecordsViewProps {
  stories: ArchiveStory[];
  kind: RecordViewKind;
  /** 去处理区生成：进入 /story/:id 对应整理子页面 */
  onGoGenerate: (storyId: string, kind: RecordViewKind, branchId: string | null) => void;
}

type RecordBranchFilter = 'all' | 'main' | string;

export function StoryRecordsView({ stories, kind, onGoGenerate }: StoryRecordsViewProps) {
  const { toast } = useToast();
  const [storyId, setStoryId] = useState<string | null>(stories[0]?.id ?? null);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [trees, setTrees] = useState<StoryTree[]>([]);
  const [branchFilter, setBranchFilter] = useState<RecordBranchFilter>('main');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [recordsError, setRecordsError] = useState('');
  const [moveRecord, setMoveRecord] = useState<SummaryItem | StoryTree | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [worldbookOpen, setWorldbookOpen] = useState(false);
  const hasAI = !!loadAPIConfig().apiKey;

  const story = stories.find((s) => s.id === storyId) ?? null;

  useEffect(() => {
    if (!stories.some(item => item.id === storyId)) setStoryId(stories[0]?.id ?? null);
  }, [stories, storyId]);

  useEffect(() => {
    setBranchFilter('main');
    setExpandedId(null);
    setMoveRecord(null);
  }, [storyId]);
  useEffect(() => { setSelected(new Set()); setWorldbookOpen(false); setManualOpen(false); }, [storyId, kind, branchFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoadingRecords(true); setRecordsError(''); setSummaries([]); setTrees([]);
    (async () => {
      if (!storyId) return;
      if (kind === 'tree') {
        const all = await getAllStoryTrees();
        if (!cancelled) setTrees(all.filter((t) => t.bookId === storyId));
      } else {
        const all = await getAllSummaries();
        if (!cancelled) {
          setSummaries(all
            .filter((s) => s.bookId === storyId && s.kind === (kind as SummaryKind))
            .sort(compareSummaryOrder));
        }
      }
    })().catch((error: unknown) => { if (!cancelled) setRecordsError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoadingRecords(false); });
    return () => { cancelled = true; };
  }, [storyId, kind, manualOpen, revision]);

  const branchNameOf = (branchId?: string) => (
    branchId
      ? story?.branches?.find((b) => b.id === branchId)?.name ?? '分支已删除'
      : '主线'
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
  const branchSelectionReady = branchFilter !== 'all';

  if (stories.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          还没有故事。先导入聊天记录，再来生成{KIND_LABELS[kind]}。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* 工具行：故事切换 + 去处理区生成 + 手动录入 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={storyId ?? undefined} onValueChange={setStoryId}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="选择故事" />
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
              <SelectValue placeholder="选择脉络" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部脉络</SelectItem>
              <SelectItem value="main">主线</SelectItem>
              {(story?.branches ?? []).map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        {kind !== 'tree' && story?.characterId && <Button variant="outline" size="sm" disabled={!selected.size} onClick={() => setWorldbookOpen(true)}>加入世界书（{selected.size}）</Button>}
        {kind !== 'tree' && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setManualOpen(true)}
            disabled={!branchSelectionReady}
            title={branchSelectionReady ? undefined : '请先选择主线或具体分支'}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            手动录入
          </Button>
        )}
        {story && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onGoGenerate(story.id, kind, selectedBranchId)}
            disabled={!branchSelectionReady}
            title={branchSelectionReady ? undefined : '请先选择主线或具体分支'}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            去处理区生成
          </Button>
        )}
      </div>

      {recordsError ? <p role="alert" className="text-sm text-destructive">读取记录失败：{recordsError}</p>
        : loadingRecords ? <p role="status" className="text-sm text-muted-foreground">正在读取记录…</p>
        : items.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
            <NotebookPen className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">这个故事还没有{KIND_LABELS[kind]}</p>
            <p className="text-xs text-muted-foreground/70">
              {hasAI
                ? `点「去处理区生成」用 AI 生成${kind !== 'tree' ? '，或「手动录入」直接粘贴' : ''}`
                : '还没配置 AI：可先到「AI 工具」页配好 API，再回处理区生成' + (kind !== 'tree' ? '；也可以「手动录入」' : '')}
            </p>
          </CardContent>
        </Card>
      ) : kind === 'tree' ? (
        <div className="space-y-2">
          {visibleTrees.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-3 px-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <span className="truncate" title={t.title}>{t.title}</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{branchNameOf(t.branchId)}</Badge>
                  <span className="text-xs text-muted-foreground font-normal shrink-0">
                    {t.nodes.length} 个节点 · 更新于{formatListTime(t.updatedAt)}
                  </span>
                </p>
                <div className="mt-2">
                  <StoryTreePreview key={t.id} tree={t} />
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setMoveRecord(t)}>移动到其他故事</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleSummaries.map((item) => {
            const manual = !item.genParams;
            const expanded = expandedId === item.id;
            return (
              <Card key={item.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : item.id)}>
                <CardContent className="py-3 px-4">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    <span onClick={event => event.stopPropagation()}><Checkbox aria-label={`选择记录 ${item.title}`} checked={selected.has(item.id)} onCheckedChange={checked => setSelected(previous => {
                      const next = new Set(previous); if (checked === true) next.add(item.id); else next.delete(item.id); return next;
                    })} /></span>
                    <span className="truncate" title={item.title}>{item.title}</span>
                    {(item.diaryOwner || item.genParams?.diaryOwner) && <Badge variant="secondary">{item.diaryOwner || item.genParams?.diaryOwner}</Badge>}
                    {summaryVolumeLabel(item) && (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{summaryVolumeLabel(item)}</Badge>
                    )}
                    <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal shrink-0">{branchNameOf(item.branchId)}</Badge>
                  </div>
                  {/* 生成于 X · 覆盖 A-B 楼（不判断过期）；手动录入单独标 */}
                  <p className="text-xs text-muted-foreground mt-0.5" title={formatFullTime(item.updatedAt)}>
                    {manual ? '手动录入' : '生成'}于{formatListTime(item.updatedAt)}
                    {item.source && ` · 收录自第 ${item.source.floor} 楼`}
                    {item.rangeDetached ? item.provenance ? ` · 原故事 ${item.floorStart}-${item.floorEnd} 楼` : ' · 覆盖范围未指定'
                      : ` · 覆盖第 ${item.floorStart}-${item.floorEnd} 楼`}
                  </p>
                  <div className={cn('break-words text-sm text-foreground/85 mt-2', !expanded && 'line-clamp-4')}>
                    <MarkdownLite text={item.content} />
                  </div>
                  {!expanded && item.content.length > 160 && (
                    <p className="text-xs text-primary/80 mt-1">点击展开全文</p>
                  )}
                  <div className="mt-2 flex gap-2" onClick={event => event.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => setMoveRecord(item)}>移动到其他故事</Button>
                    <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(item.content).then(() => toast({ title: '已复制正文' })).catch(error => toast({ title: '复制失败', description: String(error), variant: 'destructive' }))}>复制正文</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {moveRecord && story?.characterId && <MoveStoryRecordDialog record={moveRecord} kind={kind === 'tree' ? 'tree' : 'summary'} stories={stories}
        characterId={story.characterId} onClose={() => setMoveRecord(null)} onMoved={() => setRevision(value => value + 1)} />}
      {manualOpen && story && kind !== 'tree' && <CaptureRecordDialog storyId={story.id} branchId={selectedBranchId} initialKind={kind}
        onClose={() => setManualOpen(false)} onSaved={() => { setRevision(value => value + 1); toast({ title: `已保存${KIND_LABELS[kind]}` }); }} />}
      {worldbookOpen && story?.characterId && <RecordsToWorldbookDialog characterId={story.characterId} records={visibleSummaries.filter(item => selected.has(item.id))}
        onClose={() => setWorldbookOpen(false)} onSaved={() => { setSelected(new Set()); toast({ title: '已加入并保存世界书', description: '新增条目默认禁用，可从角色资产打开世界书启用。' }); }} />}
    </div>
  );
}
