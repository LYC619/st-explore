import { useEffect, useMemo, useState, type Ref } from 'react';
import { LocateFixed } from 'lucide-react';
import type { ArchiveCharacter } from '@/types/archive';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import { Button } from '@/components/ui/button';
import { InlineStoryReader, type FloorJumpRequest, type InlineStoryReaderHandle } from '@/components/character/InlineStoryReader';
import { StoryTreePreview } from '@/components/character/StoryTreePreview';
import { getAllStoryTrees } from '@/lib/story-tree-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { ReviewEdits } from './ReviewEdits';
import { ReviewRecords } from './ReviewRecords';
import { ReviewStoryList } from './ReviewStoryList';
import { groupReviewRecords } from './review-model';
import type { ReviewTab } from './review-session';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { MarkdownLite } from '@/components/MarkdownLite';

export function ReviewCharacterContent({
  character,
  stories,
  summaries,
  tab,
  storyId,
  storyBranchId,
  storyJumpRequest = null,
  returnFromJumpTab = null,
  onClearReturnTab,
  loading,
  error,
  onRetry,
  onTabChange,
  onStoryChange,
  onJumpToRecordFloor,
  onCharacterChange,
  onStoriesChange,
  onOpenEditor,
  onOpenChat,
  onBranchChatFromFloor,
  readerRef,
  onReaderReady,
  restoreFloor,
}: {
  character: ArchiveCharacter;
  stories: StoryIndexEntry[];
  summaries: SummaryItem[];
  tab: ReviewTab;
  storyId?: string;
  storyBranchId?: string | null;
  storyJumpRequest?: FloorJumpRequest | null;
  returnFromJumpTab?: ReviewTab | null;
  onClearReturnTab?: () => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onTabChange: (tab: ReviewTab) => void;
  onStoryChange: (id?: string) => void;
  onJumpToRecordFloor?: (storyId: string, branchId: string | null, floor: number) => void;
  onCharacterChange: (character: ArchiveCharacter) => void;
  onStoriesChange: () => Promise<void>;
  onOpenEditor: (id: string) => void;
  onOpenChat?: (id: string, branchId: string | null) => void;
  onBranchChatFromFloor?: (id: string, branchId: string | null, floor: number, messageId?: string | null) => void;
  readerRef: Ref<InlineStoryReaderHandle>;
  onReaderReady: (ready: boolean) => void;
  restoreFloor: boolean;
}) {
  const volumes = useMemo(() => groupReviewRecords(stories, summaries, 'volume'), [stories, summaries]);
  const diaries = useMemo(() => groupReviewRecords(stories, summaries, 'diary'), [stories, summaries]);

  const [trees, setTrees] = useState<StoryTree[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeReload, setTreeReload] = useState(0);

  useEffect(() => {
    if (tab !== 'tree') return;
    let cancelled = false;
    const epoch = getVaultEpoch();
    setTreeError(null);
    getAllStoryTrees()
      .then((all) => {
        if (!cancelled && epoch === getVaultEpoch()) setTrees(all);
      })
      .catch((err) => {
        if (!cancelled && epoch === getVaultEpoch()) {
          setTreeError(err instanceof Error ? err.message : '读取故事树失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, treeReload]);

  if (tab === 'volume' || tab === 'diary') {
    return (
      <ReviewRecords
        groups={tab === 'volume' ? volumes : diaries}
        kind={tab}
        loading={loading}
        error={error}
        onRetry={onRetry}
        onStories={() => onTabChange('stories')}
        onJumpToRecordFloor={onJumpToRecordFloor}
      />
    );
  }
  if (tab === 'tree') {
    if (treeError) {
      return (
        <div role="alert" className="space-y-3 py-8 text-sm">
          <p>读取故事树失败：{treeError}。记录仍保留在库中。</p>
          <Button variant="outline" onClick={() => setTreeReload((n) => n + 1)}>重试读取</Button>
        </div>
      );
    }
    if (trees === null) {
      return <p role="status" className="py-12 text-center text-sm text-muted-foreground">{LOADING_LABEL}</p>;
    }
    const storyIds = new Set(stories.map((s) => s.id));
    const charTrees = trees.filter((t) => t.bookId && storyIds.has(t.bookId));
    if (!charTrees.length) {
      return (
        <div className="space-y-3 py-12 text-center text-sm text-muted-foreground">
          <p>还没有故事树</p>
          <Button variant="outline" onClick={() => onTabChange('stories')}>查看故事</Button>
        </div>
      );
    }
    return (
      <div className="space-y-8">
        {charTrees.map((tree) => {
          const matchedStory = stories.find((s) => s.id === tree.bookId);
          return (
            <section key={tree.id} className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--hairline-inner)] pb-2.5">
                <div>
                  <h3 className="font-serif text-base font-semibold">{tree.title}</h3>
                  {matchedStory && <p className="text-xs text-muted-foreground">{matchedStory.title}</p>}
                </div>
                <span className="text-xs text-muted-foreground">{tree.nodes.length} 个节点</span>
              </div>
              <StoryTreePreview
                tree={tree}
                onJumpToFloor={
                  onJumpToRecordFloor && tree.bookId
                    ? (floor) => onJumpToRecordFloor(tree.bookId!, tree.branchId ?? null, floor)
                    : undefined
                }
              />
            </section>
          );
        })}
      </div>
    );
  }
  if (tab === 'notes') {
    return <ReviewEdits character={character} notesVisible onCharacterChange={onCharacterChange} />;
  }
  if (tab === 'stories') {
    if (storyId && stories.some((story) => story.id === storyId)) {
      const returnLabelMap: Partial<Record<ReviewTab, string>> = {
        volume: '返回总结',
        diary: '返回日记',
        tree: '返回故事树',
        overview: '返回总览',
      };
      const backLabel = (returnFromJumpTab && returnLabelMap[returnFromJumpTab]) || '故事列表';
      return (
        <InlineStoryReader
          key={storyId}
          ref={readerRef}
          storyId={storyId}
          initialBranchId={storyBranchId}
          jumpRequest={storyJumpRequest}
          backLabel={backLabel}
          stories={stories}
          onSwitchStory={(nextId) => {
            onClearReturnTab?.();
            onStoryChange(nextId);
          }}
          onBack={() => {
            if (returnFromJumpTab) {
              const target = returnFromJumpTab;
              onClearReturnTab?.();
              onTabChange(target);
            } else {
              onStoryChange(undefined);
            }
          }}
          onOpenEditor={onOpenEditor}
          onOpenChat={onOpenChat}
          onBranchChatFromFloor={onBranchChatFromFloor}
          onCharacterUpdated={onCharacterChange}
          onReadyChange={onReaderReady}
          restoreFloor={restoreFloor}
        />
      );
    }
    return <ReviewStoryList stories={stories} onRead={onStoryChange} onStoriesChange={onStoriesChange} />;
  }

  const notes = [...(character.notes ?? [])].sort((a, b) => b.at - a.at).slice(0, 3);
  const excerpts = volumes
    .flatMap((group) =>
      group.branches.flatMap((branch) =>
        branch.records.map((record) => ({
          record,
          storyId: group.story.id,
          story: group.story.title,
          branchId: branch.id ?? null,
          branch: branch.name,
        })),
      ),
    )
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">最近备注</h3>
          <Button variant="ghost" onClick={() => onTabChange('notes')}>全部备注</Button>
        </div>
        {notes.length ? (
          notes.map((note) => (
            <article key={note.id} className="rounded-lg border border-border bg-card p-4">
              <div
                role="region"
                aria-label="最近备注正文"
                tabIndex={0}
                data-review-excerpt
                className="max-h-64 overflow-y-auto overscroll-contain rounded-sm pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MarkdownLite text={note.body} className="break-words text-sm leading-7" />
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">还没有备注</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">故事 · {stories.length}</h3>
          <Button variant="ghost" onClick={() => onTabChange('stories')}>查看故事</Button>
        </div>
        {stories.slice(0, 4).map((story) => (
          <button
            key={story.id}
            type="button"
            onClick={() => {
              onStoryChange(story.id);
              onTabChange('stories');
            }}
            className="flex w-full justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className="truncate">{story.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{story.status ?? '未开始'}</span>
          </button>
        ))}
        {!stories.length && <p className="text-sm text-muted-foreground">还没有故事</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">总结片段</h3>
          <Button variant="ghost" onClick={() => onTabChange('volume')}>阅读全部总结</Button>
        </div>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">{LOADING_LABEL}</p>
        ) : error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>读取总结和日记失败：{error}。记录仍保留在库中。</p>
            <Button variant="outline" onClick={onRetry}>重试读取</Button>
          </div>
        ) : excerpts.length ? (
          excerpts.map(({ record, storyId: sid, story, branchId: bid, branch }) => (
            <article key={record.id} className="space-y-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{story} · {branch} · {record.title}</p>
                {onJumpToRecordFloor && !record.rangeDetached && Number.isSafeInteger(record.floorStart) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => onJumpToRecordFloor(sid, bid, record.floorStart)}
                  >
                    <LocateFixed className="h-3 w-3" />
                    #{record.floorStart} 楼
                  </Button>
                )}
              </div>
              <div
                role="region"
                aria-label={`${record.title || '总结'}正文`}
                tabIndex={0}
                data-review-excerpt
                className="max-h-64 overflow-y-auto overscroll-contain rounded-sm pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MarkdownLite text={record.content} className="break-words text-sm leading-7" />
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">还没有总结，可在故事编辑器中整理已有内容。</p>
        )}
      </section>
    </div>
  );
}
