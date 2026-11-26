import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import type { WorldBook } from '@/types/worldbook';
import { useToast } from '@/hooks/use-toast';
import { readWorldBookUpload } from '@/lib/worldbook-file-import';

interface Props {
  onImport: (wb: WorldBook, filename: string, sourceModifiedAt?: number) => void;
  onAppend?: (wb: WorldBook) => void;
  hasExisting?: boolean;
}

export function WorldBookImporter({ onImport, onAppend, hasExisting }: Props) {
  useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [pendingWb, setPendingWb] = useState<{ wb: WorldBook; name: string; sourceModifiedAt?: number } | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const upload = await readWorldBookUpload(file);
      const count = Object.keys(upload.worldbook.entries).length;

      if (hasExisting && onAppend) {
        setPendingWb({ wb: upload.worldbook, name: upload.title, sourceModifiedAt: upload.sourceModifiedAt });
      } else {
        onImport(upload.worldbook, upload.title, upload.sourceModifiedAt);
        toast({ title: tr("导入成功"), description: tr("已加载 {{v0}} 个条目", { v0: count }) });
      }
    } catch {
      toast({ title: tr("导入失败"), description: tr("无法解析 JSON 文件"), variant: 'destructive' });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleReplace = () => {
    if (!pendingWb) return;
    const count = Object.keys(pendingWb.wb.entries).length;
    onImport(pendingWb.wb, pendingWb.name, pendingWb.sourceModifiedAt);
    toast({ title: tr("导入成功"), description: tr("已替换，加载 {{v0}} 个条目", { v0: count }) });
    setPendingWb(null);
  };

  const handleAppend = () => {
    if (!pendingWb || !onAppend) return;
    onAppend(pendingWb.wb);
    setPendingWb(null);
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Download className="w-4 h-4 mr-2" />{tr("导入")}</Button>

      <AlertDialog open={!!pendingWb} onOpenChange={(open) => { if (!open) setPendingWb(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("导入方式")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("当前已有世界书，新文件包含 {{v0}} 个条目。请选择导入方式：", { v0: pendingWb ? Object.keys(pendingWb.wb.entries).length : 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
            <Button variant="outline" onClick={handleReplace}>{tr("替换当前")}</Button>
            <Button onClick={handleAppend}>{tr("追加到当前")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
