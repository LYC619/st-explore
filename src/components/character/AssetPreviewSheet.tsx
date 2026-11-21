import { useEffect, useState } from 'react';
import { ExternalLink, FolderOpen, Wrench } from 'lucide-react';
import { AttachmentPreview } from '@/components/character/AttachmentPreview';
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
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AttachmentView } from '@/lib/attachment-store';
import { formatFullTime } from '@/lib/time-display';
import { getActiveVault } from '@/lib/vault/active';
import { formatArchiveBytes } from '@/lib/vault/other-assets';
import type { AssetKind, DerivedAssetMeta, QuoteAsset, STAssetRelation } from '@/types/archive';

export interface AssetEntry {
  title?: string;
  keys?: string;
  body?: string;
}

export interface AssetView {
  kind: AssetKind | 'quote' | 'file';
  id: string;
  title: string;
  updatedAt: number;
  derived?: DerivedAssetMeta;
  entries: AssetEntry[];
  count: number;
  relations?: STAssetRelation[];
  file?: AttachmentView;
}

interface AssetPreviewSheetProps {
  preview: AssetView | null;
  onClosePreview: () => void;
  kindLabels: Record<AssetView['kind'], { label: string; unit: string }>;
  canOpenExternally: boolean;
  onOpenEditor: (asset: AssetView) => void;
  onOpenExternally: (file: AttachmentView, reveal: boolean) => void;
  quoteToDelete: QuoteAsset | null;
  onCloseQuoteDelete: () => void;
  onConfirmQuoteDelete: (quote: QuoteAsset) => void;
  fileToDelete: AttachmentView | null;
  deletingFile: boolean;
  onCloseFileDelete: () => void;
  onConfirmFileDelete: (file: AttachmentView, deletePhysicalFile: boolean) => void;
}

export function AssetPreviewSheet({
  preview,
  onClosePreview,
  kindLabels,
  canOpenExternally,
  onOpenEditor,
  onOpenExternally,
  quoteToDelete,
  onCloseQuoteDelete,
  onConfirmQuoteDelete,
  fileToDelete,
  deletingFile,
  onCloseFileDelete,
  onConfirmFileDelete,
}: AssetPreviewSheetProps) {
  const [deleteAttachmentFile, setDeleteAttachmentFile] = useState(false);
  useEffect(() => {
    setDeleteAttachmentFile(false);
  }, [fileToDelete?.id]);

  const isLibraryAsset = preview ? preview.kind !== 'quote' && preview.kind !== 'file' : false;

  return (
    <>
      <Sheet open={!!preview} onOpenChange={(v) => { if (!v) onClosePreview(); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col">
          {preview && (
            <>
              <SheetHeader>
                <SheetDescription>
                  {kindLabels[preview.kind].label}
                  {preview.derived && ' · 派生副本'}
                  {' · '}
                  {formatFullTime(preview.updatedAt)}
                </SheetDescription>
                <SheetTitle>{preview.title}</SheetTitle>
                <SheetDescription>
                  {preview.file
                    ? `${preview.file.path} · ${formatArchiveBytes(preview.file.actualSize)}`
                    : `共 ${preview.count} 个${kindLabels[preview.kind].unit}`}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-2.5 mt-2">
                {preview.file ? (
                  <AttachmentPreview file={preview.file} />
                ) : (
                  <>
                    {preview.entries.map((e, i) => (
                      <div key={i} className="rounded-lg border border-border bg-card px-3 py-2.5">
                        {e.title && <p className="text-sm font-medium mb-1">{e.title}</p>}
                        {e.keys && <p className="text-xs text-muted-foreground font-mono mb-1.5 break-all">{e.keys}</p>}
                        {e.body && <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{e.body}</p>}
                      </div>
                    ))}
                    {preview.count > preview.entries.length && (
                      <p className="text-xs text-muted-foreground/70 text-center pb-2">
                        …还有 {preview.count - preview.entries.length} 个{kindLabels[preview.kind].unit}，在编辑器中查看全部
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <Button variant="outline" onClick={onClosePreview}>关闭</Button>
                {isLibraryAsset && (
                  <Button onClick={() => onOpenEditor(preview)}>
                    <Wrench className="w-4 h-4 mr-1.5" />
                    在编辑器中打开
                  </Button>
                )}
                {preview.file && !preview.file.missing && canOpenExternally && (
                  <>
                    <Button variant="outline" onClick={() => onOpenExternally(preview.file!, true)}>
                      <FolderOpen className="w-4 h-4 mr-1.5" />
                      在文件管理器中显示
                    </Button>
                    <Button onClick={() => onOpenExternally(preview.file!, false)}>
                      <ExternalLink className="w-4 h-4 mr-1.5" />
                      用外部程序打开
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!quoteToDelete} onOpenChange={(v) => !v && onCloseQuoteDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除引用「{quoteToDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>引用是这张卡自己的摘录数据，删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (quoteToDelete) onConfirmQuoteDelete(quoteToDelete);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!fileToDelete} onOpenChange={(v) => !v && !deletingFile && onCloseFileDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除关联文件「{fileToDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {fileToDelete?.missing
                ? '文件已缺失，仅移除这张卡上的附件记录。'
                : '记录会从这张卡上移除。不勾选时，附件文件保留在原位置，可在设置的文件检查中查看。'}
              <br />
              <span className="font-mono text-[11px] break-all">{fileToDelete?.resolvedPath ?? fileToDelete?.path}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!fileToDelete?.missing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deleteAttachmentFile}
                disabled={deletingFile}
                onChange={(event) => setDeleteAttachmentFile(event.target.checked)}
              />
              同时删除 STE 库内文件
            </label>
          )}
          {deleteAttachmentFile && (
            <p className="text-xs text-muted-foreground">
              {getActiveVault()?.fs.trashFile ? '文件将移入系统回收站。' : '当前平台不支持系统回收站，文件将永久删除。'}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingFile}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingFile}
              onClick={(event) => {
                event.preventDefault();
                if (fileToDelete) onConfirmFileDelete(fileToDelete, !fileToDelete.missing && deleteAttachmentFile);
              }}
            >
              {fileToDelete?.missing ? '仅移除失效记录' : '移除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
