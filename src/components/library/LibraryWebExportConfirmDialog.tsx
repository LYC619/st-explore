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
  return (
    <AlertDialog open={!!targets} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>网页版单次最多连下 {WEB_BATCH_DOWNLOAD_LIMIT} 张</AlertDialogTitle>
          <AlertDialogDescription>
            你当前选了 {targets?.length ?? 0} 张。浏览器连续弹出太多下载任务时会自动拦截，
            点继续会先帮你下载前 {WEB_BATCH_DOWNLOAD_LIMIT} 张，剩下的分批再来一次就行。
            <span className="block mt-2">如果想一次性整库导出到文件夹，推荐用桌面客户端，直接写入本地目录不受浏览器限制。</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const batch = (targets ?? []).slice(0, WEB_BATCH_DOWNLOAD_LIMIT);
              onClose();
              onConfirmBatch(batch);
            }}
          >
            先下前 {WEB_BATCH_DOWNLOAD_LIMIT} 张
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
