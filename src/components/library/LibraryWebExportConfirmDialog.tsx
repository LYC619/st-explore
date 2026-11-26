import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { WEB_BATCH_DOWNLOAD_LIMIT } from '@/lib/character-web-download';
import type { ArchiveCharacter } from '@/types/archive';

interface LibraryWebExportConfirmDialogProps {
  targets: ArchiveCharacter[] | null;
  onClose: () => void;
  onConfirmBatch: (batch: ArchiveCharacter[]) => void;
}

export function LibraryWebExportConfirmDialog({
  targets,
  onClose,
  onConfirmBatch,
}: LibraryWebExportConfirmDialogProps) {
  useI18n();
  return (
    <AlertDialog open={!!targets} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("网页版单次最多连下 {{v0}} 张", { v0: WEB_BATCH_DOWNLOAD_LIMIT })}</AlertDialogTitle>
          <AlertDialogDescription>{tr("你当前选了 {{v0}} 张。浏览器连续弹出太多下载任务时会自动拦截，点继续会先帮你下载前 {{v1}} 张，剩下的分批再来一次就行。", { v0: targets?.length ?? 0, v1: WEB_BATCH_DOWNLOAD_LIMIT })}<span className="block mt-2">{tr("如果想一次性整库导出到文件夹，推荐用桌面客户端，直接写入本地目录不受浏览器限制。")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const batch = (targets ?? []).slice(0, WEB_BATCH_DOWNLOAD_LIMIT);
              onClose();
              onConfirmBatch(batch);
            }}
          >{tr("先下前 {{v0}} 张", { v0: WEB_BATCH_DOWNLOAD_LIMIT })}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
