import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { BatchOperations } from '@/components/worldbook/BatchOperations';
import type { BatchSelection } from '@/hooks/use-batch-selection';
import type { WorldBookItem } from '@/types/worldbook';

interface WorldBookBatchBarProps {
  batch: BatchSelection;
  totalFiltered: number;
  savedItems: WorldBookItem[];
  currentItemId: string | null;
  onBatchDelete: () => void;
  onBatchCopyTo: (targetId: string, move: boolean) => void;
}

/**
 * 批量工具条的接线层。四个批量操作骨架相同——快照、按选中集打补丁、给一条可撤销的
 * toast——差别只在补丁本身，所以统一交给 `applyBatch`，这里只声明每种操作改什么。
 */
export function WorldBookBatchBar({
  batch, totalFiltered, savedItems, currentItemId, onBatchDelete, onBatchCopyTo,
}: WorldBookBatchBarProps) {
  useI18n();
  const count = batch.batchSelected.size;
  return (
    <BatchOperations
      selectedKeys={batch.batchSelected}
      totalFiltered={totalFiltered}
      onSelectAll={batch.selectAll}
      onDeselectAll={batch.deselectAll}
      onExitBatch={batch.exitBatchMode}
      onBatchPrefix={(prefix) => batch.applyBatch(
        (e) => (e.comment.startsWith(prefix) ? null : { comment: prefix + e.comment }),
        { title: tr("前缀已添加"), description: tr("已为 {{v0}} 个条目添加前缀", { v0: count }) },
      )}
      onBatchDelete={onBatchDelete}
      onBatchPosition={(position, depth, role) => batch.applyBatch(
        () => ({
          position,
          ...(depth !== undefined ? { depth } : {}),
          ...(role !== undefined ? { role } : {}),
        }),
        { title: tr("位置已修改"), description: tr("已修改 {{v0}} 个条目的插入位置", { v0: count }) },
      )}
      onBatchStrategy={(strategy) => batch.applyBatch(
        () => ({ constant: strategy === 'constant', vectorized: strategy === 'vectorized' }),
        { title: tr("策略已修改"), description: tr("已修改 {{v0}} 个条目的触发策略", { v0: count }) },
      )}
      onBatchEnable={(enabled) => batch.applyBatch(
        () => ({ enabled }),
        {
          title: enabled ? tr("已启用") : tr("已停用"),
          description: enabled ? tr("已启用 {{v0}} 个条目", { v0: count }) : tr("已停用 {{v0}} 个条目", { v0: count }),
        },
      )}
      copyTargets={savedItems.filter((i) => i.id !== currentItemId).map((i) => ({ id: i.id, title: i.title }))}
      onBatchCopyTo={onBatchCopyTo}
    />
  );
}
