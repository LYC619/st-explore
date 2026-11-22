import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { ArrowLeft, BookOpen, LocateFixed, NotebookText, Wrench } from 'lucide-react';
import { ApiStatusLine } from '@/components/ai-tools/ApiStatusLine';
import { HelpCard } from '@/components/HelpCard';
import { RecordWorkbench, type RecordWorkbenchHandle } from '@/components/organize/RecordWorkbench';
import { MiniSummaryPanel } from '@/components/summary/MiniSummaryPanel';
import { SavedSummaryList } from '@/components/summary/SavedSummaryList';
import { SummaryGallery } from '@/components/summary/SummaryGallery';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getBranchLine } from '@/lib/archive-db';
import { getAllSummaries } from '@/lib/summary-db';
import type { ArchiveStory } from '@/types/archive';
import { SUMMARY_KIND_LABELS, type SummaryItem, type SummarySurfaceKind } from '@/types/summary';

interface SummaryWorkspaceProps {
  story: ArchiveStory;
  characterName?: string;
  currentBranchId: string | null;
  kind: SummarySurfaceKind;
  initialTarget?: { type: 'record' | 'tree'; id: string };
  onKindChange: (kind: SummarySurfaceKind) => void;
  onJumpToFloor?: (floor: number, branchId?: string | null) => void;
}

const KINDS: SummarySurfaceKind[] = ['volume', 'diary', 'diy', 'mini'];

function SummaryRouteBlocker({
  hasDraft,
  skipRef,
}: {
  hasDraft: () => boolean;
  skipRef: React.MutableRefObject<boolean>;
}) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (skipRef.current) {
      skipRef.current = false;
      return false;
    }
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) {
      return false;
    }
    return hasDraft();
  });

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDraft()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasDraft]);

  if (blocker.state !== 'blocked') return null;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) blocker.reset(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>放弃未保存的总结草稿？</AlertDialogTitle>
          <AlertDialogDescription>当前记录尚有未保存的修改，离开后无法恢复这些修改。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus onClick={() => blocker.reset()}>继续编辑</AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed()}>放弃草稿并离开</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SafeSummaryRouteBlocker(props: {
  hasDraft: () => boolean;
  skipRef: React.MutableRefObject<boolean>;
}) {
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? <SummaryRouteBlocker {...props} /> : null;
}

export function SummaryWorkspace({
  story,
  characterName,
  currentBranchId,
  kind,
  initialTarget,
  onKindChange,
  onJumpToFloor,
}: SummaryWorkspaceProps) {
  const [view, setView] = useState<'workshop' | 'gallery'>('workshop');
  const [selectedRecord, setSelectedRecord] = useState<SummaryItem | null>(null);
  const [truncatedRecords, setTruncatedRecords] = useState<Set<string>>(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [draftNonce, setDraftNonce] = useState(0);
  const [pendingAction, setPendingAction] = useState<'manual' | 'regenerate' | null>(null);
  const [detailMode, setDetailMode] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const workbenchRef = useRef<RecordWorkbenchHandle>(null);
  const skipRouteBlockRef = useRef(false);
  const checkHasDraft = useCallback(() => Boolean(workbenchRef.current?.hasUnsavedDraft()), []);

  const currentLine = getBranchLine(story, currentBranchId) ?? getBranchLine(story, null)!;

  const loadInitialTarget = useCallback(async () => {
    if (initialTarget?.type !== 'record') return;
    try {
      const item = (await getAllSummaries()).find((summary) => summary.id === initialTarget.id && summary.bookId === story.id);
      if (!item) return;
      setSelectedRecord(item);
      setDetailMode(true);
      onKindChange(item.kind);
    } catch {
      // 列表面板本身已有读取失败告警，此处避免未捕获 Promise 拒绝
    }
  }, [initialTarget, onKindChange, story.id]);

  useEffect(() => { void loadInitialTarget(); }, [loadInitialTarget]);

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction === 'manual') workbenchRef.current?.startManual();
    else workbenchRef.current?.regenerate();
    setPendingAction(null);
  }, [kind, pendingAction, selectedRecord, draftNonce]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  const handleSaved = useCallback((item: SummaryItem, truncated = false) => {
    setTruncatedRecords((previous) => {
      const next = new Set(previous);
      if (truncated) next.add(item.id); else next.delete(item.id);
      return next;
    });
    setSelectedRecord(item);
    setDetailMode(true);
    setRefreshKey((value) => value + 1);
  }, []);

  const handleDiscarded = useCallback(() => {
    setSelectedRecord(null);
    setDetailMode(false);
    setDraftNonce((value) => value + 1);
    setRefreshKey((value) => value + 1);
  }, []);

  const openRecord = useCallback((item: SummaryItem) => {
    setView('workshop');
    onKindChange(item.kind);
    setSelectedRecord(item);
    setDetailMode(true);
  }, [onKindChange]);

  const regenerateRecord = useCallback((item: SummaryItem) => {
    setView('workshop');
    onKindChange(item.kind);
    setSelectedRecord(item);
    setDetailMode(true);
    setPendingAction('regenerate');
  }, [onKindChange]);

  const startManual = () => {
    setView('workshop');
    setSelectedRecord(null);
    setDetailMode(true);
    setDraftNonce((value) => value + 1);
    setPendingAction('manual');
  };

  const resetEditor = () => {
    setSelectedRecord(null);
    setDetailMode(false);
    setDraftNonce((value) => value + 1);
  };

  const runAfterDraftCheck = (action: () => void) => {
    if (workbenchRef.current?.hasUnsavedDraft()) {
      setPendingDiscard(() => action);
      return;
    }
    action();
  };

  const changeKind = (next: SummarySurfaceKind) => {
    if (next === kind) return;
    runAfterDraftCheck(() => {
      skipRouteBlockRef.current = true;
      resetEditor();
      onKindChange(next);
    });
  };

  const changeView = (next: 'workshop' | 'gallery') => {
    if (next === view) return;
    runAfterDraftCheck(() => setView(next));
  };

  const backToList = () => {
    runAfterDraftCheck(resetEditor);
  };

  return (
    <div data-summary-workspace className="h-full min-h-0 overflow-hidden px-4 py-3">
      <div className="mx-auto flex h-full min-h-0 max-w-7xl flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-[color:var(--border-subtle)] pb-3 flex-wrap">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md gold-gradient shadow-card">
              <NotebookText className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="flex items-center gap-1">
              <h1 className="font-display text-lg font-semibold">总结与手账</h1>
              <HelpCard>左侧选择楼层范围与提示词模板生成，右侧查看已保存记录；点击楼层号可一键跳回故事原文核对。</HelpCard>
            </div>
          </div>

          <Tabs value={view} onValueChange={(value) => changeView(value as 'workshop' | 'gallery')}>
            <TabsList className="flex h-8 w-fit">
              <TabsTrigger value="workshop" className="h-7 gap-1.5 whitespace-nowrap px-3"><Wrench className="h-3.5 w-3.5" />生成工作台</TabsTrigger>
              <TabsTrigger value="gallery" className="h-7 gap-1.5 whitespace-nowrap px-3"><BookOpen className="h-3.5 w-3.5" />展示页</TabsTrigger>
            </TabsList>
          </Tabs>

          <span className="h-6 w-px shrink-0 bg-[color:var(--border-subtle)]" />
          <Tabs value={kind} onValueChange={(value) => changeKind(value as SummarySurfaceKind)}>
            <TabsList className="flex h-8 w-fit">
              {KINDS.map((item) => (
                <TabsTrigger key={item} value={item} className="h-7 whitespace-nowrap px-3 text-xs">
                  {item === 'mini' ? '小总结' : SUMMARY_KIND_LABELS[item]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="ml-auto hidden min-w-0 items-center gap-3 xl:flex">
            <div className="max-w-72 truncate text-xs text-muted-foreground" title={story.title}>
              <span className="font-medium text-foreground">{story.title}</span>
              <span> · {currentLine.session.messages.length} 楼</span>
            </div>
            <ApiStatusLine />
          </div>
        </header>

        <div className="mt-3 min-h-0 flex-1">
          {kind === 'mini' ? (
            <div className="h-full min-h-0 overflow-y-auto rounded-md border border-[color:var(--border-subtle)] bg-elevated p-4 scrollbar-thin">
              <MiniSummaryPanel session={currentLine.session} />
            </div>
          ) : view === 'gallery' ? (
            <SummaryGallery
              currentBookId={story.id}
              refreshKey={refreshKey}
              kind={kind}
              charName={characterName ?? currentLine.session.character?.name}
              onEdit={openRecord}
              onJumpToFloor={onJumpToFloor}
            />
          ) : (
            <RecordWorkbench
              key={`${kind}:${selectedRecord?.id ?? `draft-${draftNonce}`}`}
              ref={workbenchRef}
              story={story}
              kind={kind}
              record={selectedRecord?.kind === kind ? selectedRecord : null}
              defaultBranchId={currentBranchId}
              onSaved={handleSaved}
              initialTruncated={!!selectedRecord && truncatedRecords.has(selectedRecord.id)}
              onDiscarded={handleDiscarded}
              showEmptyEditor={false}
              showApiStatus={false}
              recordsRefreshKey={refreshKey}
              sidePanel={
                detailMode ? (
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--border-subtle)] pb-2 flex-wrap">
                    <Button variant="ghost" size="sm" className="gap-1.5" onClick={backToList}>
                      <ArrowLeft className="h-3.5 w-3.5" />返回已生成总结
                    </Button>
                    <div className="flex items-center gap-2 min-w-0">
                      {selectedRecord && !selectedRecord.rangeDetached && Number.isSafeInteger(selectedRecord.floorStart) && onJumpToFloor && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => runAfterDraftCheck(() => {
                            skipRouteBlockRef.current = true;
                            onJumpToFloor(selectedRecord.floorStart, selectedRecord.branchId ?? null);
                          })}
                        >
                          <LocateFixed className="h-3.5 w-3.5" />
                          跳回 #{selectedRecord.floorStart} 楼原文
                        </Button>
                      )}
                      <span className="truncate text-xs text-muted-foreground">{selectedRecord?.title || '新建记录'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col">
                    <SavedSummaryList
                      currentBookId={story.id}
                      refreshKey={refreshKey}
                      kind={kind}
                      onAdd={startManual}
                      onView={openRecord}
                      onRegenerate={regenerateRecord}
                      onChanged={refresh}
                      onJumpToFloor={onJumpToFloor}
                    />
                  </div>
                )
              }
            />
          )}
        </div>
      </div>

      <SafeSummaryRouteBlocker hasDraft={checkHasDraft} skipRef={skipRouteBlockRef} />

      <AlertDialog open={pendingDiscard !== null} onOpenChange={(open) => { if (!open) setPendingDiscard(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的总结草稿？</AlertDialogTitle>
            <AlertDialogDescription>当前记录尚有未保存的修改，继续后无法恢复这些修改。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const action = pendingDiscard;
              setPendingDiscard(null);
              action?.();
            }}>
              放弃草稿并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
