import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';

export interface ReviewBranchGroup {
  id: string | null;
  name: string;
  deleted: boolean;
  records: SummaryItem[];
}
export interface ReviewStoryGroup { story: StoryIndexEntry; branches: ReviewBranchGroup[] }

export function reviewStories(index: StoryIndexEntry[], characterId: string): StoryIndexEntry[] {
  return index.filter(s => s.characterId === characterId).sort((a, b) => {
    if (a.lastViewedAt !== undefined || b.lastViewedAt !== undefined) {
      if (a.lastViewedAt === undefined) return 1;
      if (b.lastViewedAt === undefined) return -1;
      return b.lastViewedAt - a.lastViewedAt;
    }
    return a.createdAt - b.createdAt;
  });
}

export function groupReviewRecords(stories: StoryIndexEntry[], records: SummaryItem[], kind: 'volume' | 'diary'): ReviewStoryGroup[] {
  const byStory = new Map<string, SummaryItem[]>();
  for (const record of records) {
    if (!record.bookId || record.kind !== kind) continue;
    const items = byStory.get(record.bookId) ?? [];
    items.push(record); byStory.set(record.bookId, items);
  }
  return stories.flatMap(story => {
    const items = byStory.get(story.id);
    if (!items?.length) return [];
    const known = story.branchIndex ?? [];
    const ids = [...new Set(items.map(item => item.branchId || null))];
    const ordered = [null, ...known.map(b => b.id), ...ids.filter(id => id !== null && !known.some(b => b.id === id)).sort()];
    return [{ story, branches: ordered.filter(id => ids.includes(id)).map(id => ({
      id,
      name: id === null ? '主线' : known.find(b => b.id === id)?.name ?? `已删除分支 · ${id}`,
      deleted: id !== null && !known.some(b => b.id === id),
      records: items.filter(item => (item.branchId || null) === id).sort((a, b) => {
        if (kind === 'volume') {
          const volume = (a.volumeNumber ?? Infinity) - (b.volumeNumber ?? Infinity);
          if (volume) return volume;
          const floor = a.floorStart - b.floorStart || a.floorEnd - b.floorEnd;
          if (floor) return floor;
        }
        return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
      }),
    })) }];
  });
}
