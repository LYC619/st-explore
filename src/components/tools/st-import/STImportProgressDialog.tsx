import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 解压/扫描阶段的进度弹窗。
 *
 * 只在选择弹窗出现之前的两个阶段用；入库阶段的进度直接长在选择弹窗底部
 * （那时候用户已经在看勾选列表了，再盖一层弹窗会把上下文冲掉）。
 */
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ST_IMPORT_PHASE_LABEL, type STImportProgress } from '@/lib/vault/st-import-progress';

interface STImportProgressDialogProps {
  /** null = 不显示。第一条进度到达才弹，避免盖在系统文件对话框上面。 */
  progress: STImportProgress | null;
  /** 已经点过取消，正在等当前条目收尾 */
  canceling: boolean;
  onCancel: () => void;
}

export function STImportProgressDialog({ progress, canceling, onCancel }: STImportProgressDialogProps) {
  useI18n();
  if (!progress) return null;
  const { phase, done, total, label } = progress;
  // 扫描阶段事先不知道总量（要走多少层目录取决于包的内容），这时不画进度条，
  // 画一条永远填不满的条比只报数字更误导。
  const determinate = typeof total === 'number' && total > 0;
  const percent = determinate ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    // 关闭 = 取消：右上角 X 和 Esc 都不该把弹窗关掉却留解压在后台裸跑。
    <Dialog open onOpenChange={(next) => { if (!next && !canceling) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ST_IMPORT_PHASE_LABEL[phase]}
          </DialogTitle>
          <DialogDescription>
            {determinate ? `${done} / ${total} · ${percent}%` : tr("已发现 {{v0}} 个条目", { v0: done })}
          </DialogDescription>
        </DialogHeader>

        {determinate && <Progress value={percent ?? 0} className="h-2" />}

        <p className="min-h-5 truncate text-xs text-muted-foreground" title={label}>{label ?? ''}</p>

        <p className="text-xs text-muted-foreground">{tr("还没有向库里写入任何东西，现在取消不会留下痕迹。")}</p>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={canceling}>
            <X className="mr-1 h-4 w-4" />
            {canceling ? tr("正在停止…") : tr("取消")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
