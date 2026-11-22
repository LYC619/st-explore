import { useRef, useState } from 'react';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { StoryStatus } from '@/types/archive';
import { updateArchiveStory } from '@/lib/archive-db';
import { getVaultEpoch } from '@/lib/vault/active';
import { Button } from '@/components/ui/button';

function StoryRow({ story, onRead, onStoriesChange }: { story: StoryIndexEntry; onRead: (id: string) => void; onStoriesChange: () => Promise<void> }) {
  const [status, setStatus] = useState<StoryStatus>(story.status ?? '未开始');
  const [savedStatus, setSavedStatus] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    const epoch = getVaultEpoch();
    try {
      const saved = await updateArchiveStory(story.id, () => ({ status, updatedAt: Date.now() }));
      if (!saved) throw new Error('故事档案不存在');
      if (epoch !== getVaultEpoch()) return;
      setSavedStatus(status);
      await onStoriesChange();
    } catch (e) { if (epoch === getVaultEpoch()) setError(e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <article className="space-y-3 rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{story.title}</h3><p className="mt-1 text-xs text-muted-foreground">{story.floorCount} 楼 · {savedStatus}</p></div><Button variant="outline" aria-label={`阅读 ${story.title}`} onClick={() => onRead(story.id)}>阅读</Button></div>
    <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-xs text-muted-foreground">故事状态<select aria-label={`${story.title}状态`} className="ste-select min-h-8 text-base md:text-sm" value={status} disabled={busy} onChange={e => setStatus(e.target.value as StoryStatus)}>{(['未开始', '进行中', '已完结', '已搁置'] as const).map(value => <option key={value}>{value}</option>)}</select></label>{(status !== savedStatus || error) && <Button variant="outline" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存状态'}</Button>}</div>
    {error && <p role="alert" className="text-sm text-[color:var(--status-danger)]">{error}</p>}
  </article>;
}
export function ReviewStoryList({ stories, onRead, onStoriesChange }: { stories: StoryIndexEntry[]; onRead: (id: string) => void; onStoriesChange: () => Promise<void> }) {
  if (!stories.length) return <p className="py-12 text-center text-sm text-muted-foreground">还没有故事</p>;
  return <div className="space-y-3">{stories.map(story => <StoryRow key={`${story.id}:${story.status}`} story={story} onRead={onRead} onStoriesChange={onStoriesChange} />)}</div>;
}
