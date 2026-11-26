import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { FolderOpen, Globe, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorldBookImporter } from '@/components/worldbook/WorldBookImporter';
import { StagedWorldBookList } from '@/components/worldbook/StagedWorldBookList';
import type { WorldBook, WorldBookItem } from '@/types/worldbook';
import { LOADING_LABEL } from '@/lib/ui-copy';

interface WorldBookEmptyStateProps {
  savedItems: WorldBookItem[];
  /** 资产库列表读完了没有；false 时不能断言用户没有可恢复的世界书 */
  savedLoaded?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onImport: (wb: WorldBook, name: string, sourceModifiedAt?: number) => void;
  onCreateBlank?: () => void;
  onRestore: (item: WorldBookItem) => void;
  onDelete: (item: WorldBookItem) => void;
}

/** 尚未载入世界书时的引导页：新建空白 + 导入入口 + 资产库里已有的世界书 */
export function WorldBookEmptyState({
  savedItems,
  savedLoaded = true,
  loadError,
  onRetry,
  onImport,
  onCreateBlank,
  onRestore,
  onDelete,
}: WorldBookEmptyStateProps) {
  useI18n();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4 px-4 max-w-lg w-full">
        <Globe className="w-16 h-16 mx-auto text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">{tr("开始使用世界书编辑器")}</h2>
        <p className="text-muted-foreground max-w-md mx-auto">{tr("可直接从零新建一本空白世界书编写设定，或导入 SillyTavern 的世界书 JSON 文件。")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onCreateBlank && (
            <Button type="button" onClick={onCreateBlank}>
              <Plus className="w-4 h-4 mr-1.5" />{tr("新建空白世界书")}</Button>
          )}
          <WorldBookImporter onImport={onImport} />
        </div>

        {loadError ? (
          <div className="mt-8 space-y-2 text-sm text-destructive" data-worldbook-load-error>
            <p>{tr("读取世界书库失败：{{v0}}", { v0: loadError })}</p>
            {onRetry && <button type="button" className="underline" onClick={onRetry}>{tr("重试")}</button>}
          </div>
        ) : !savedLoaded ? (
          <p className="mt-8 text-sm text-muted-foreground" data-staged-loading>{tr(LOADING_LABEL)}</p>
        ) : savedItems.length > 0 && (
          <div className="mt-8 text-left space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderOpen className="w-4 h-4" />{tr("资产库里的世界书")}</div>
            <StagedWorldBookList items={savedItems} variant="card" onSelect={onRestore} onDelete={onDelete} />
          </div>
        )}
      </div>
    </div>
  );
}
