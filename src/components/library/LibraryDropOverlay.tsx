import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LibraryDropOverlayProps {
  disabled?: boolean;
  onDropFiles: (files: FileList) => void;
  children: ReactNode;
}

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes('Files'));
}

export function LibraryDropOverlay({
  disabled = false,
  onDropFiles,
  children,
}: LibraryDropOverlayProps) {
  useI18n();
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);

  useEffect(() => {
    if (disabled) {
      depthRef.current = 0;
      setDragging(false);
    }
  }, [disabled]);

  useEffect(() => {
    const reset = () => {
      depthRef.current = 0;
      setDragging(false);
    };
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (disabled) return;
    depthRef.current += 1;
    setDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    // 即使导入弹窗已打开也必须拦截浏览器默认打开图片行为，防止页面被导航冲掉
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    if (!disabled && !dragging) setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (disabled) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    depthRef.current = 0;
    setDragging(false);
    if (disabled) {
      toast({
        title: tr("请先确认当前导入窗口"),
        description: tr("完成或关闭当前角色卡导入窗口后，即可继续拖入新卡片。"),
      });
      return;
    }
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      onDropFiles(event.dataTransfer.files);
    }
  };

  return (
    <div
      className="relative h-full flex flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && !disabled && (
        <div
          data-library-drop-overlay
          className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-[var(--reader-scrim)] backdrop-blur-sm text-center shadow-xl"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-active-bg)] text-brand">
            <Upload className="h-6 w-6" />
          </div>
          <p className="font-serif text-lg font-semibold text-[color:var(--text-primary)]">{tr("松手即可收入角色库")}</p>
          <p className="text-xs text-[color:var(--text-muted)]">{tr("支持多选 SillyTavern 角色卡（.png / .json）或普通立绘图（自动建空白卡）")}</p>
        </div>
      )}
    </div>
  );
}
