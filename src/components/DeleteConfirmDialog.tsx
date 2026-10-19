import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { StoreName } from '@/lib/idb';
import type { RemoveOptions } from '@/lib/repo';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { prepareFileRemoval } from '@/lib/vault/file-maintenance';
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
  confirmLabel = '确认删除',
  fileTarget,
  fileTargets,
}: DeleteConfirmDialogProps) {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const openedEpoch = useRef<number | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ count: number; bytes: number; usesTrash: boolean } | null>(null);
  const targetsKey = JSON.stringify(fileTargets ?? (fileTarget ? [fileTarget] : []));
  const hasFiles = !!getActiveVault() && targetsKey !== '[]';
  const scopeChanged = open && openedEpoch.current !== null && openedEpoch.current !== epoch;

  useEffect(() => {
    if (!open) { openedEpoch.current = null; return; }
    if (openedEpoch.current !== null && openedEpoch.current !== epoch) return;
    openedEpoch.current = epoch;
    setDeleteFiles(false); setError(''); setPreview(null);
    const vault = getActiveVault();
    if (!vault || targetsKey === '[]') return;
    let cancelled = false;
    const targets = JSON.parse(targetsKey) as FileTarget[];
    void Promise.all(targets.map(({ store, id }) => prepareFileRemoval(vault, store, id)))
      .then(results => {
        if (!cancelled) setPreview({ count: results.reduce((n, r) => n + r.count, 0), bytes: results.reduce((n, r) => n + r.bytes, 0), usesTrash: results.every(r => r.usesTrash) });
      }).catch(e => { if (!cancelled) setError(`无法检查文件，已停止删除：${e instanceof Error ? e.message : String(e)}`); });
    return () => { cancelled = true; };
  }, [open, epoch, targetsKey]);

  const confirm = async () => {
    if (pendingRef.current || scopeChanged || (hasFiles && !preview)) return;
    pendingRef.current = true; setPending(true); setError('');
    try {
      const result = await onConfirm({ deleteFiles: hasFiles && deleteFiles });
      if (result !== false) onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pendingRef.current = false; setPending(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={value => { if (!pendingRef.current) onOpenChange(value); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {hasFiles && <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={deleteFiles} disabled={pending || scopeChanged} onChange={e => setDeleteFiles(e.target.checked)} />
            同时删除 STE 库内文件
          </label>
          <p className="text-xs text-muted-foreground">
            {preview ? `涉及 ${preview.count} 个文件 · ${(preview.bytes / 1024).toFixed(1)} KB。` : '正在检查文件…'}
            {deleteFiles
              ? preview?.usesTrash ? '文件将移入系统回收站。' : '此平台不支持回收站，文件将永久删除。'
              : '文件会保留在库内保留区，可在设置的文件检查中查看和清理。'}
          </p>
        </div>}
        {(error || scopeChanged) && <p role="alert" className="text-sm text-destructive">{scopeChanged ? '文件库已切换，请关闭后重新选择删除目标。' : error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button variant="destructive" disabled={pending || scopeChanged || (hasFiles && !preview)} onClick={() => void confirm()}>{pending ? '正在删除…' : confirmLabel}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
