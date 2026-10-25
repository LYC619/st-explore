import type { SummaryItem } from '@/types/summary';

/** 卷号升序，未编号记录按关联楼层/创建时间，其他最后；修改正文不会挪动位置。 */
export function compareSummaryOrder(a: SummaryItem, b: SummaryItem): number {
  if (a.kind === 'diy' && b.kind === 'diy') return b.updatedAt - a.updatedAt;
  const group = (item: SummaryItem) => item.volumeCategory === 'other' ? 2
    : Number.isSafeInteger(item.volumeNumber) && item.volumeNumber! > 0 ? 0 : 1;
  const groupDiff = group(a) - group(b);
  if (groupDiff) return groupDiff;
  if (group(a) === 0 && a.volumeNumber !== b.volumeNumber) return a.volumeNumber! - b.volumeNumber!;
  const floor = (item: SummaryItem) => item.rangeDetached ? Number.MAX_SAFE_INTEGER : item.floorStart;
  return floor(a) - floor(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function summaryVolumeLabel(item: Pick<SummaryItem, 'volumeNumber' | 'volumeCategory'>): string {
  return item.volumeCategory === 'other' ? '其他' : item.volumeNumber != null ? `第${item.volumeNumber}卷` : '';
}
