import { useMemo, type Ref } from 'react';
import type { ArchiveCharacter } from '@/types/archive';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';
import { Button } from '@/components/ui/button';
import { InlineStoryReader, type InlineStoryReaderHandle } from '@/components/character/InlineStoryReader';
import { ReviewEdits } from './ReviewEdits';
import { ReviewRecords } from './ReviewRecords';
import { ReviewStoryList } from './ReviewStoryList';
import { groupReviewRecords } from './review-model';
import type { ReviewTab } from './review-session';
import { LOADING_LABEL } from '@/lib/ui-copy';
import { MarkdownLite } from '@/components/MarkdownLite';

export function ReviewCharacterContent({ character, stories, summaries, tab, storyId, loading, error, onRetry, onTabChange, onStoryChange, onCharacterChange, onStoriesChange, onOpenEditor, readerRef, onReaderReady, restoreFloor }: {
  character: ArchiveCharacter; stories: StoryIndexEntry[]; summaries: SummaryItem[]; tab: ReviewTab; storyId?: string;
  loading: boolean; error: string | null; onRetry: () => void; onTabChange: (tab: ReviewTab) => void;
  onStoryChange: (id?: string) => void; onCharacterChange: (character: ArchiveCharacter) => void; onStoriesChange: () => Promise<void>;
  onOpenEditor: (id: string) => void; readerRef: Ref<InlineStoryReaderHandle>;
  onReaderReady: (ready: boolean) => void; restoreFloor: boolean;
}) {
  const volumes = useMemo(() => groupReviewRecords(stories, summaries, 'volume'), [stories, summaries]);
  const diaries = useMemo(() => groupReviewRecords(stories, summaries, 'diary'), [stories, summaries]);
  if (tab === 'volume' || tab === 'diary') return <ReviewRecords groups={tab === 'volume' ? volumes : diaries} kind={tab} loading={loading} error={error} onRetry={onRetry} onStories={() => onTabChange('stories')} />;
  if (tab === 'notes') return <ReviewEdits character={character} notesVisible onCharacterChange={onCharacterChange} />;
  if (tab === 'stories') {
    if (storyId && stories.some(story => story.id === storyId)) return <InlineStoryReader key={storyId} ref={readerRef} storyId={storyId} stories={stories} onSwitchStory={onStoryChange} onBack={() => onStoryChange(undefined)} onOpenEditor={onOpenEditor} onReadyChange={onReaderReady} restoreFloor={restoreFloor} />;
    return <ReviewStoryList stories={stories} onRead={onStoryChange} onStoriesChange={onStoriesChange} />;
  }
  const notes = [...(character.notes ?? [])].sort((a, b) => b.at - a.at).slice(0, 3);
  const excerpts = volumes.flatMap(group => group.branches.flatMap(branch => branch.records.map(record => ({ record, story: group.story.title, branch: branch.name })))).slice(0, 3);
  return <div className="space-y-8">
    <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">最近备注</h3><Button variant="ghost" onClick={() => onTabChange('notes')}>全部备注</Button></div>{notes.length ? notes.map(note => <article key={note.id} className="rounded-lg border border-border bg-card p-4"><div role="region" aria-label="最近备注正文" tabIndex={0} data-review-excerpt className="max-h-64 overflow-y-auto overscroll-contain rounded-sm pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MarkdownLite text={note.body} className="break-words text-sm leading-7" /></div></article>) : <p className="text-sm text-muted-foreground">还没有备注</p>}</section>
    <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">故事 · {stories.length}</h3><Button variant="ghost" onClick={() => onTabChange('stories')}>查看故事</Button></div>{stories.slice(0, 4).map(story => <div key={story.id} className="flex justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm"><span className="truncate">{story.title}</span><span className="shrink-0 text-xs text-muted-foreground">{story.status ?? '未开始'}</span></div>)}{!stories.length && <p className="text-sm text-muted-foreground">还没有故事</p>}</section>
    <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">总结片段</h3><Button variant="ghost" onClick={() => onTabChange('volume')}>阅读全部总结</Button></div>{loading ? <p role="status" className="text-sm text-muted-foreground">{LOADING_LABEL}</p> : error ? <div role="alert" className="space-y-2 text-sm"><p>读取总结和日记失败：{error}。记录仍保留在库中。</p><Button variant="outline" onClick={onRetry}>重试读取</Button></div> : excerpts.length ? excerpts.map(({ record, story, branch }) => <article key={record.id} className="space-y-2 rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{story} · {branch} · {record.title}</p><div role="region" aria-label={`${record.title || '总结'}正文`} tabIndex={0} data-review-excerpt className="max-h-64 overflow-y-auto overscroll-contain rounded-sm pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MarkdownLite text={record.content} className="break-words text-sm leading-7" /></div></article>) : <p className="text-sm text-muted-foreground">还没有总结，可在故事编辑器中整理已有内容。</p>}</section>
  </div>;
}
