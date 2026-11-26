import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 写回 ST 区块（2.0 阶段7.5，IOPanel 第③区的客户端实现）。
 * 仅 已绑定角色+有 sourcePath 的故事可写回；写回/恢复备份都走确认对话框（不静默覆盖）。
 */
import { useState } from 'react';
import { FileUp, History, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { useToast } from '@/hooks/use-toast';
import { createTauriFs, getVaultRoot, readAbsText, writeAbsText } from '@/lib/vault/tauri-fs';
import {
  applyRestoreOutcome,
  performWriteback,
  restoreBackup,
  writebackSummary,
  RESTORE_KEEP,
  WRITEBACK_KEEP,
} from '@/lib/vault/st-writeback';
import type { ArchiveStory } from '@/types/archive';

interface Props {
  story: ArchiveStory;
  onStoryUpdate: (fn: (cur: ArchiveStory) => ArchiveStory) => void;
}

/** 待确认动作：写回，或恢复某版备份 */
type Pending = { kind: 'write' } | { kind: 'restore'; backupFile: string } | null;

const fmtTime = (t: number) => new Date(t).toLocaleString(getLocale(), { hour12: false });

export function WritebackSection({ story, onStoryUpdate }: Props) {
  useI18n();
  const { toast } = useToast();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  const abs = { readText: readAbsText, writeText: writeAbsText };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const root = await getVaultRoot();
      if (!root) throw new Error(tr("库未配置"));
      const vaultFs = createTauriFs(root);
      if (pending.kind === 'write') {
        const { story: updated, backedUp, warning } = await performWriteback(vaultFs, abs, story);
        onStoryUpdate((cur) => ({ ...cur, writebacks: updated.writebacks }));
        toast({
          title: tr("已写回 ST"),
          description: [
            backedUp ? tr("原文件已备份到库内 .ste/，可从写回历史恢复") : tr("源文件当时不存在，已直接写出（无备份）"),
            warning,
          ].filter(Boolean).join(getLocale() === 'en' ? '; ' : '；'),
        });
      } else {
        const outcome = await restoreBackup(vaultFs, abs, story, pending.backupFile);
        onStoryUpdate((cur) => applyRestoreOutcome(cur, outcome));
        toast({
          title: tr("已恢复该版备份到 ST"),
          description: [
            outcome.protection
              ? tr("恢复前的当前 ST 内容已另存保护备份（保留最近 {{v0}} 版）", { v0: RESTORE_KEEP })
              : tr("恢复前没有可读取的当前 ST 文件"),
            tr("STE 库内数据未变动；需要时可再次写回覆盖"),
            outcome.warning,
          ].filter(Boolean).join(getLocale() === 'en' ? '; ' : '；'),
        });
      }
      setPending(null);
    } catch (err) {
      toast({ title: tr("操作失败"), description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileUp className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">{tr("写回 ST")}</p>
          <Badge variant="outline" className="h-5 text-[11px]">{tr("客户端")}</Badge>
        </div>
        <p className="text-xs text-muted-foreground break-all">{tr("目标：")}{story.sourcePath}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setPending({ kind: 'write' })}>
            <FileUp className="w-4 h-4 mr-1.5" />{tr("写回主线（")}{story.session.messages.length}{tr(" 楼）")}</Button>
          <span className="text-xs text-muted-foreground">{tr("写前自动备份，保留最近 ")}{WRITEBACK_KEEP}{tr(" 版")}</span>
        </div>

        {(story.writebacks?.length ?? 0) > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <History className="w-3.5 h-3.5" />{tr("写回历史")}</p>
            {story.writebacks!.map((w) => (
              <div key={w.at} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{fmtTime(w.at)} · {w.kind === 'restore' ? tr("恢复前备份") : tr("写回")} {w.floors}{tr(" 楼")}</span>
                {w.backupFile ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2 text-xs"
                    onClick={() => setPending({ kind: 'restore', backupFile: w.backupFile! })}
                  >
                    <Undo2 className="w-3 h-3 mr-1" />{tr("恢复此前版本")}</Button>
                ) : (
                  <span>{w.backupPruned ? tr("（备份已按保留策略清理）") : tr("（无备份）")}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <AlertDialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pending?.kind === 'restore' ? tr("恢复备份到 ST？") : tr("确认写回 ST？")}</AlertDialogTitle>
              <AlertDialogDescription className="whitespace-pre-line break-all">
                {pending?.kind === 'restore'
                  ? tr("将用库内备份覆盖：\n{{v0}}\nSTE 库内数据不受影响。", { v0: story.sourcePath })
                  : writebackSummary(story)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{tr("取消")}</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); run(); }} disabled={busy}>
                {busy ? tr("执行中…") : tr("确认")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
