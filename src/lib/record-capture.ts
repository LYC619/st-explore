import { withArchiveStoryLock, getBranchLine, updateCharacter } from '@/lib/archive-db';
import { withSummaryLock } from '@/lib/summary-db';
import { buildManualSummaryItem } from '@/lib/summary-factory';
import { getCurrentRepo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem, SummaryKind } from '@/types/summary';

export interface CaptureRecordInput {
  recordId: string; storyId: string; branchId: string | null; messageId?: string; kind: SummaryKind;
  content: string; title?: string; diaryOwner?: string; volumeNumber?: number; range?: { start: number; end: number };
  expectedSource?: string;
  volumeCategory?: SummaryItem['volumeCategory'];
}

export async function captureRecord(input: CaptureRecordInput): Promise<SummaryItem> {
  const stories = getCurrentRepo<ArchiveStory>('archiveStories'), records = getCurrentRepo<SummaryItem>('summaries'), epoch = getVaultEpoch();
  const check = () => { if (getVaultEpoch() !== epoch) throw new Error('资料库已切换，收录已停止'); };
  if (!input.content.trim()) throw new Error('请填写正文');
  return withArchiveStoryLock(input.storyId, () => withSummaryLock(input.recordId, async () => {
    check(); const story = await stories.get(input.storyId);
    if (!story) throw new Error('来源故事不存在');
    const line = getBranchLine(story, input.branchId);
    if (!line) throw new Error('来源分支不存在');
    const floor = input.messageId ? line.session.messages.findIndex(message => message.id === input.messageId) : -1;
    if (input.messageId && floor < 0) throw new Error('来源消息不存在，请重新选择');
    if (floor >= 0 && input.expectedSource !== undefined && line.session.messages[floor].content !== input.expectedSource) throw new Error('来源消息已修改，请重新选择');
    const range = input.range;
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end >= line.session.messages.length)) throw new Error('覆盖范围无效');
    if (input.volumeNumber !== undefined && (!Number.isSafeInteger(input.volumeNumber) || input.volumeNumber < 1)) throw new Error('卷号无效');
    const previous = await records.get(input.recordId);
    if (previous) {
      if (previous.bookId !== story.id || previous.branchId !== (input.branchId ?? undefined) || previous.source?.messageId !== input.messageId) throw new Error('收录目标已变化');
      return previous;
    }
    const volumes = (await records.list()).filter(item => item.bookId === story.id && item.branchId === (input.branchId ?? undefined) && item.kind === 'volume');
    const item = { ...buildManualSummaryItem({ ...input, story, existingVolumes: volumes,
      source: floor >= 0 ? { messageId: input.messageId!, floor, capturedAt: Date.now() } : undefined }), id: input.recordId, rangeDetached: floor >= 0 && !input.range };
    check(); await records.put(item); return item;
  }));
}

/** Only notes are written. Re-read the source inside the character updater without
 * holding both queues: story-package export may already hold the story queue. */
export async function captureCharacterNote(input: Omit<CaptureRecordInput, 'kind'>): Promise<void> {
  const epoch = getVaultEpoch(), stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const check = () => { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，收录已停止'); };
  if (!input.content.trim()) throw new Error('请填写正文');
  check();
  const initial = await stories.get(input.storyId);
  if (!initial?.characterId) throw new Error('请先为故事绑定角色，再收录到角色备注');
  check();
  const saved = await updateCharacter(initial.characterId, async current => {
    check();
    const story = await stories.get(input.storyId);
    if (!story || story.characterId !== current.id) throw new Error('故事的绑定角色已变化，请重新打开收录');
    const line = getBranchLine(story, input.branchId);
    if (!line) throw new Error('来源分支不存在');
    const message = input.messageId ? line.session.messages.find(message => message.id === input.messageId) : undefined;
    if (input.messageId && !message) throw new Error('来源消息不存在，请重新选择');
    if (message && input.expectedSource !== undefined && message.content !== input.expectedSource) throw new Error('来源消息已修改，请重新选择');
    if (current.notes?.some(note => note.id === input.recordId)) return undefined;
    const body = [input.title?.trim() ? `## ${input.title.trim()}` : '', input.content.trim()].filter(Boolean).join('\n\n');
    check();
    return { notes: [...(current.notes ?? []), { id: input.recordId, body, at: Date.now() }], updatedAt: Date.now() };
  });
  if (!saved) throw new Error('绑定角色已不存在');
}
