import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { LocateFixed } from 'lucide-react';
import { MarkdownLite } from '@/components/MarkdownLite';
import { Button } from '@/components/ui/button';
import { formatFullTime } from '@/lib/time-display';
import { LOADING_LABEL } from '@/lib/ui-copy';
import type { ReviewStoryGroup } from './review-model';

export function ReviewRecords({
  groups,
  kind,
  loading,
  error,
  onRetry,
  onStories,
  onJumpToRecordFloor,
}: {
  groups: ReviewStoryGroup[];
  kind: 'volume' | 'diary';
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onStories: () => void;
  onJumpToRecordFloor?: (storyId: string, branchId: string | null, floor: number) => void;
}) {
  useI18n();
  if (loading) return <p role="status" className="py-12 text-center text-sm text-muted-foreground">{tr(LOADING_LABEL)}</p>;
  if (error) {
    return (
      <div role="alert" className="space-y-3 py-8 text-sm">
        <p>{tr("读取总结和日记失败：{{v0}}。记录仍保留在库中。", { v0: error })}</p>
        <Button variant="outline" onClick={onRetry}>{tr("重试读取")}</Button>
      </div>
    );
  }
  if (!groups.length) {
    return (
      <div className="space-y-3 py-12 text-center text-sm text-muted-foreground">
        <p>{kind === 'volume' ? tr("还没有总结") : tr("还没有日记")}</p>
        <Button variant="outline" onClick={onStories}>{tr("查看故事")}</Button>
      </div>
    );
  }
  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.story.id} aria-label={group.story.title} className="space-y-5">
          <h3 className="border-b border-border pb-3 font-display text-lg font-semibold">{group.story.title}</h3>
          {group.branches.map((branch) => (
            <section key={branch.id ?? 'main'} className="space-y-5">
              <h4 className="text-xs font-medium text-muted-foreground">{branch.name}</h4>
              {branch.records.map((record) => (
                <article
                  key={record.id}
                  id={`review-record-${record.id}`}
                  data-story-id={group.story.id}
                  data-branch-id={branch.id ?? 'main'}
                  className="space-y-3 rounded-lg border border-border bg-card p-4 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h5 className="font-medium">{record.title || (kind === 'volume' ? tr("总结") : tr("日记"))}</h5>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {group.story.title} · {branch.name}
                        {record.volumeNumber !== undefined ? ` · ${tr("第 {{v0}} 卷", { v0: record.volumeNumber })}` : ''}
                        {' · '}
                        {tr("覆盖第 {{v0}}–{{v1}} 楼", { v0: record.floorStart, v1: record.floorEnd })}
                        {' · '}
                        {record.genParams
                          ? tr("生成于 {{v0}}", { v0: formatFullTime(record.createdAt) })
                          : tr("手动录入于 {{v0}}", { v0: formatFullTime(record.createdAt) })}
                      </p>
                    </div>
                    {onJumpToRecordFloor && !record.rangeDetached && Number.isSafeInteger(record.floorStart) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1 text-xs"
                        onClick={() => onJumpToRecordFloor(group.story.id, branch.id ?? null, record.floorStart)}
                      >
                        <LocateFixed className="h-3.5 w-3.5" />{tr("回味 #{{v0}} 楼", { v0: record.floorStart })}</Button>
                    )}
                  </div>
                  <MarkdownLite text={record.content} className="text-sm leading-7" />
                </article>
              ))}
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}
