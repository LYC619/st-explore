import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { libraryListColumns } from './library-list-columns';

export function LibraryListHeader({ batchMode }: { batchMode: boolean }) {
  useI18n();
  return (
    <div
      role="row"
      data-library-list-header
      className="sticky top-0 z-20 grid items-center gap-3.5 rounded-t-xl border-b border-[color:var(--hairline-inner)] bg-[var(--bg-elevated)] px-3.5 py-2 text-[11px] font-semibold tracking-wide text-[color:var(--text-muted)] shadow-sm"
      style={{ gridTemplateColumns: libraryListColumns(batchMode) }}
    >
      {batchMode && (
        <span role="columnheader" aria-label={tr("选择")} className="text-center">
          <span className="sr-only">{tr("选择")}</span>
          ✓
        </span>
      )}
      <span role="columnheader" className="col-span-2">{tr("角色卡")}</span>
      <span role="columnheader" className="text-right">{tr("评分")}</span>
      <span role="columnheader" className="text-right">{tr("故事数")}</span>
      <span role="columnheader" className="text-right">{tr("最近活动")}</span>
      <span role="columnheader" className="text-right">{tr("操作")}</span>
    </div>
  );
}
