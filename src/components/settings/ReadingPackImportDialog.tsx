import { tr, getLocale } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 导入阅读包：选文件 → 看清会写什么/覆盖什么 → 确认后写库。
 *
 * 两段式来自 DataSource 抽象（lib/data-source），云同步和手机端 ST zip 将来走同一套。
 * 不省这一步的理由：导入会覆盖本地条目，而本地条目上攒着用户的阅读进度和评分。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  readingPackSource,
  type ImportPlan, type ImportPlanRow, type ReadingPackInput,
} from '@/lib/data-source';
import { READING_PACK_EXT } from '@/types/reading-pack';
import { RUNTIME_LABEL } from '@/lib/runtime';
import {
  getAllArchiveStories, getAllCharacters, getCharacter, getArchiveStory, saveArchiveStory, saveCharacter,
} from '@/lib/archive-db';
import { getAllSummaries, saveSummary } from '@/lib/summary-db';
import { parseReadingPackFile } from '@/lib/reading-pack/reading-pack-worker-client';
import { isReadingPackError, ReadingPackError } from '@/lib/reading-pack/import';
import { getActiveVault } from '@/lib/vault/active';

interface ReadingPackImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入完成后让调用方刷新列表 */
  onImported?: () => void;
}

const ACTION_LABEL: Record<ImportPlanRow['action'], string> = {
  get add() { return tr("新增"); },
  get overwrite() { return tr("覆盖"); },
  get skip() { return tr("跳过"); },
};

function PlanSection({ title, rows }: { title: string; rows: ImportPlanRow[] }) {
  useI18n();
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{tr("{{v0}}（{{v1}}）", { v0: title, v1: rows.length })}</p>
      <div className="divide-y divide-border rounded-md border border-border">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
            <Badge
              variant="outline"
              className={
                row.action === 'overwrite'
                  ? 'border-[var(--status-warn-bg)] text-[color:var(--status-warn)]'
                  : row.action === 'skip' ? 'text-muted-foreground'
                  : 'border-primary/50 text-primary'
              }
            >
              {ACTION_LABEL[row.action]}
            </Badge>
            <span className="min-w-0 flex-1 truncate" title={row.label}>{row.label}</span>
            {row.reason && <span className="shrink-0 text-muted-foreground">{row.reason}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReadingPackImportDialog({
  open, onOpenChange, onImported,
}: ReadingPackImportDialogProps) {
  useI18n();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  // 留住 inspect 用的那份 input 原样喂给 apply：接口约定「plan 必须来自同一次 inspect
  // 的同一份 input」，现场重造一个（尤其是把 existing 造成空数组）迟早出事。
  const [input, setInput] = useState<ReadingPackInput | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const requestRef = useRef<{
    id: number; controller: AbortController; vault: ReturnType<typeof getActiveVault>; writing: boolean;
  } | null>(null);
  const origin = input?.origin ?? '';

  const cancelRequest = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);
  const reset = useCallback(() => {
    cancelRequest();
    setInput(null);
    setPlan(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [cancelRequest]);

  useEffect(() => {
    if (!open) reset();
    return cancelRequest;
  }, [open, reset, cancelRequest]);

  const changeOpen = (next: boolean) => { if (!next) reset(); onOpenChange(next); };

  const handlePick = async (file: File) => {
    reset();
    const request = { id: ++sequence.current, controller: new AbortController(), vault: getActiveVault(), writing: false };
    requestRef.current = request;
    const isCurrent = () => requestRef.current?.id === request.id && !request.controller.signal.aborted;
    const checkVault = () => {
      if (getActiveVault() !== request.vault) throw new ReadingPackError('cancelled', tr("库已切换，已取消读取阅读包"));
    };
    setBusy(true);
    try {
      const parsed = await parseReadingPackFile(file, request.controller.signal);
      if (!isCurrent()) return;
      checkVault();
      const [characters, stories, summaries] = await Promise.all([
        getAllCharacters(), getAllArchiveStories(), getAllSummaries(),
      ]);
      if (!isCurrent()) return;
      checkVault();
      const nextInput: ReadingPackInput = {
        parsed,
        origin: file.name,
        existing: {
          characters: characters.map((c) => ({ id: c.id, updatedAt: c.updatedAt })),
          stories: stories.map((s) => ({ id: s.id, updatedAt: s.updatedAt })),
          summaries: summaries.map((s) => ({ id: s.id, updatedAt: s.updatedAt })),
        },
      };
      const next = await readingPackSource.inspect(nextInput);
      if (!isCurrent()) return;
      checkVault();
      setInput(nextInput);
      setPlan(next);
    } catch (e) {
      if (!isCurrent()) return;
      reset();
      if (isReadingPackError(e) && e.code === 'cancelled') return;
      toast({
        title: tr("读取阅读包失败"),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      if (isCurrent()) {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    }
  };

  const handleApply = async () => {
    const request = requestRef.current;
    if (!input || !plan || !request || request.writing) return;
    request.writing = true;
    const isCurrent = () => requestRef.current?.id === request.id && !request.controller.signal.aborted;
    const guard = <T,>(operation: () => Promise<T>): Promise<T> => {
      if (!isCurrent() || getActiveVault() !== request.vault) {
        throw new ReadingPackError('cancelled', tr("已取消导入阅读包"));
      }
      return operation();
    };
    setBusy(true);
    try {
      const result = await readingPackSource.apply(input, plan, {
        getCharacter: id => guard(() => getCharacter(id)),
        saveCharacter: item => guard(() => saveCharacter(item)),
        saveStory: item => guard(() => saveArchiveStory(item)),
        saveSummary: item => guard(() => saveSummary(item)),
        getStory: id => guard(() => getArchiveStory(id)),
      });
      if (!isCurrent()) return;
      const { characters, stories, summaries } = result.written;
      toast({
        title: tr("阅读包已导入"),
        description: tr("角色 {{v0}} · 故事 {{v1}} · 总结 {{v2}}", { v0: characters, v1: stories, v2: summaries })
          + (result.skipped > 0 ? tr(" · 跳过 {{v0}}", { v0: result.skipped }) : ''),
      });
      if (result.warnings.length > 0) {
        toast({ title: tr("有几处需要留意"), description: result.warnings.slice(0, 3).join(getLocale() === 'en' ? '; ' : '；') });
      }
      reset();
      onImported?.();
      onOpenChange(false);
    } catch (e) {
      if (!isCurrent()) return;
      reset();
      if (isReadingPackError(e) && e.code === 'cancelled') return;
      toast({
        title: tr("导入失败"),
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      if (isCurrent()) setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("导入阅读包")}</DialogTitle>
          <DialogDescription>{tr("选一个 ")}{READING_PACK_EXT}{tr(" 文件。同一个包重复导入不会重复写入， 也不会覆盖你在这台设备上的阅读进度。")}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept={READING_PACK_EXT + ',application/zip'}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handlePick(file);
          }}
        />

        {!plan ? (
          <div className="py-6 text-center">
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy
                ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{tr("读取中…")}</>
                : <><FileDown className="mr-1.5 h-4 w-4" />{tr("选择阅读包")}</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <p className="truncate font-medium text-foreground" title={origin}>{origin}</p>
              {plan.producedBy && (
                <p>{tr("来自 {{v0}} {{v1}}", { v0: RUNTIME_LABEL[plan.producedBy.runtime as keyof typeof RUNTIME_LABEL] ?? plan.producedBy.runtime, v1: plan.producedBy.appVersion })}
                </p>
              )}
              <p>{tr("新增 ")}{plan.totals.add}{tr(" · 覆盖 ")}{plan.totals.overwrite}{tr(" · 跳过 ")}{plan.totals.skip}
              </p>
            </div>

            {plan.totals.overwrite > 0 && (
              <p className="flex items-start gap-1.5 text-xs text-[color:var(--status-warn)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{tr("有 ")}{plan.totals.overwrite}{tr(" 条会被包里的版本覆盖（包里更新）。 阅读进度不受影响，仍按本机记录。")}</p>
            )}

            <ScrollArea className="max-h-64">
              <div className="space-y-2 pr-2">
                <PlanSection title={tr("角色")} rows={plan.characters} />
                <PlanSection title={tr("故事")} rows={plan.stories} />
                <PlanSection title={tr("总结")} rows={plan.summaries} />
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>{tr("取消")}</Button>
          {plan && (
            <>
              <Button variant="ghost" onClick={reset} disabled={busy}>{tr("换个文件")}</Button>
              <Button
                onClick={() => void handleApply()}
                disabled={busy || plan.totals.add + plan.totals.overwrite === 0}
              >
                {busy
                  ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />{tr("写入中…")}</>
                  : tr("确认导入（{{v0}} 条）", { v0: plan.totals.add + plan.totals.overwrite })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
