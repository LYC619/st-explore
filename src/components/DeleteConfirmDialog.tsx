import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { StoreName } from '@/lib/idb';
import type { RemoveOptions } from '@/lib/repo';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { prepareFileRemovals } from '@/lib/vault/file-maintenance';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FileTarget { store: StoreName; id: string }

interface DeleteConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: RemoveOptions) => void | boolean | Promise<void | boolean>;
  confirmLabel?: string;
  fileTarget?: FileTarget;
  fileTargets?: FileTarget[];
}

export function DeleteConfirmDialog({
  open,
  title,
  description,
  onOpenChange,
  onConfirm,
  confirmLabel = tr("确认删除"),
  fileTarget,
  fileTargets,
}: DeleteConfirmDialogProps) {
  useI18n();
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const openedEpoch = useRef<number | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ count: number; bytes: number; usesTrash: boolean } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const targetsKey = JSON.stringify(fileTargets ?? (fileTarget ? [fileTarget] : []));
  const hasFiles = !!getActiveVault() && targetsKey !== '[]';
  const scopeChanged = open && openedEpoch.current !== null && openedEpoch.current !== epoch;

  useEffect(() => {
    if (!open) { openedEpoch.current = null; return; }
    if (openedEpoch.current !== null && openedEpoch.current !== epoch) return;
    openedEpoch.current = epoch;
    setDeleteFiles(false); setError(''); setPreview(null); setPreviewError('');
    const vault = getActiveVault();
    if (!vault || targetsKey === '[]') return;
    let cancelled = false;
    const targets = JSON.parse(targetsKey) as FileTarget[];
    void prepareFileRemovals(vault, targets)
      .then(results => {
        if (!cancelled) setPreview({ count: results.reduce((n, r) => n + r.count, 0), bytes: results.reduce((n, r) => n + r.bytes, 0), usesTrash: results.every(r => r.usesTrash) });
      }).catch(e => { if (!cancelled) setPreviewError(tr("暂未读取到文件信息：{{v0}}。确认时将重新读取目标。", { v0: e instanceof Error ? e.message : String(e) })); });
    return () => { cancelled = true; };
  }, [open, epoch, targetsKey]);

  const confirm = async () => {
    if (pendingRef.current || scopeChanged) return;
    pendingRef.current = true; setPending(true); setError('');
    try {
      const result = await onConfirm({ deleteFiles: hasFiles && deleteFiles });
      if (result !== false) onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pendingRef.current = false; setPending(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={value => { if (!pendingRef.current) onOpenChange(value); }}>
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {hasFiles && <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deleteFiles} disabled={pending || scopeChanged} onChange={e => setDeleteFiles(e.target.checked)} />{tr("同时删除 STE 库内文件")}</label>
          <p className="text-xs text-muted-foreground">
            {preview ? tr("预计涉及 {{v0}} 个文件 · {{v1}} KB。", { v0: preview.count, v1: (preview.bytes / 1024).toFixed(1) }) : tr("正在读取目标文件信息，可直接确认删除。")}
            {deleteFiles
              ? tr("文件先移入库内回收站，每个文件保留满 30 天后移入系统回收站；不支持或失败时继续保留。")
              : tr("文件会长期保留，可在「设置 → 数据与备份 → 库内回收站」查看和恢复，不参与 30 天自动回收。")}
          </p>
        </div>}
        {previewError && <p className="text-xs text-muted-foreground">{previewError}</p>}
        {(error || scopeChanged) && <div role="alert" className="text-sm text-destructive">
          {scopeChanged ? tr("文件库已切换，请关闭后重新选择删除目标。") : error.length > 300 ? <>
            <p>{tr("删除未完成，请查看具体原因。")}</p><details className="mt-2"><summary className="cursor-pointer">{tr("查看问题详情")}</summary><p className="mt-2 max-h-40 overflow-y-auto break-all text-xs">{error}</p></details>
          </> : <p className="break-words">{error}</p>}
        </div>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tr("取消")}</AlertDialogCancel>
          <Button variant="destructive" disabled={pending || scopeChanged} onClick={() => void confirm()}>{pending ? tr("正在删除…") : confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
