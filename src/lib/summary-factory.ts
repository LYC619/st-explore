import type { ArchiveStory } from '@/types/archive';
import { getBranchLine } from '@/lib/archive-db';
import type { SummaryItem, SummaryKind } from '@/types/summary';
import { generateSummaryId } from '@/types/summary';

export interface ManualSummaryInput {
  story: ArchiveStory;
  kind: SummaryKind;
  branchId: string | null;
  content: string;
  title?: string;
  volumeNumber?: number;
  volumeCategory?: SummaryItem['volumeCategory'];
  existingVolumes?: Pick<SummaryItem, 'volumeNumber'>[];
  now?: number;
  diaryOwner?: string;
  range?: { start: number; end: number };
  source?: SummaryItem['source'];
}

/** Build a manual record with the same branch/range semantics as the generation workbench. */
export function buildManualSummaryItem(input: ManualSummaryInput): SummaryItem {
  const now = input.now ?? Date.now();
  const line = getBranchLine(input.story, input.branchId) ?? getBranchLine(input.story, null)!;
  const volumes = input.existingVolumes ?? [];
  const nextVolume = volumes.length
    ? Math.max(...volumes.map((item) => item.volumeNumber ?? 0)) + 1
    : 1;
  const volume = input.volumeCategory === 'other' || input.kind === 'diy' ? undefined
    : input.volumeNumber ?? (input.kind === 'volume' ? nextVolume : undefined);
  return {
    id: generateSummaryId(),
    bookId: input.story.id,
    bookTitle: input.story.title,
    kind: input.kind,
    title: input.title?.trim() || `手动录入 · ${new Date(now).toLocaleString('zh-CN')}`,
    branchId: input.branchId ?? undefined,
    floorStart: input.range?.start ?? 0,
    floorEnd: input.range?.end ?? (input.source ? 0 : Math.max(line.session.messages.length - 1, 0)),
    ...(input.source && !input.range ? { rangeDetached: true } : {}),
    source: input.source,
    diaryOwner: input.kind === 'diary' ? input.diaryOwner?.trim() || undefined : undefined,
    content: input.content.trim(),
    volumeNumber: volume,
    volumeCategory: input.volumeCategory,
    createdAt: now,
    updatedAt: now,
  };
}
