import { getArchiveStory, getBranchLine } from '@/lib/archive-db';
import { getAllSummaries } from '@/lib/summary-db';
import { extractMiniSummaries } from '@/lib/mini-summary';
import { getVaultEpoch } from '@/lib/vault/active';
import type { WorldFact } from '../agents/types';
export interface StoryTimelineRow { id: string; title: string; text: string; source: NonNullable<WorldFact['source']> }
/** Read only the chosen story. Existing summaries remain authoritative and are never auto-injected. */
export async function loadStoryTimeline(storyId: string, branchId?: string): Promise<StoryTimelineRow[]> {
  const epoch = getVaultEpoch();
  const [story, summaries] = await Promise.all([getArchiveStory(storyId), getAllSummaries()]);
  if (epoch !== getVaultEpoch()) throw new Error('资料库已切换');
  const line = story && getBranchLine(story, branchId ?? null);
  if (!line) throw new Error('来源故事或分支已不存在');
  const pattern = localStorage.getItem('st-mini-summary-regex') || '/<summary>([\\s\\S]*?)<\\/summary>/g';
  const mini = extractMiniSummaries(line.session, pattern).map(pair => ({ id: `mini:${pair.floor}`, title: '正则小总结', text: pair.summary,
    source: { storyId, branchId, floor: pair.floor } }));
  const rows = summaries.filter(s => s.bookId === storyId && s.branchId === branchId).map(s => ({ id: s.id,
    title: s.title || (s.kind === 'diary' ? '楼层日记' : '章节总结'), text: s.content,
    source: { storyId, branchId, summaryId: s.id, floor: s.rangeDetached ? s.source?.floor : s.floorStart } }));
  return [...mini, ...rows].sort((a, b) => (a.source.floor ?? Infinity) - (b.source.floor ?? Infinity));
}
