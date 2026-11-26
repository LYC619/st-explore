import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Feather, Loader2, Square, Trash2 } from 'lucide-react';
import { CompletionWarning } from '@/components/ai-tools/CompletionWarning';
import { loadAPIConfig } from '@/components/ai-tools';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { MarkdownLite } from '@/components/MarkdownLite';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { callOpenAIMessages, isLLMCancelled, isLLMConfigured } from '@/lib/llm';
import type { NovelChapter } from '@/lib/novel-view';
import type { RemoveOptions } from '@/lib/repo';
import { deleteSummary, saveSummary } from '@/lib/summary-db';
import { buildSummaryMessages } from '@/lib/summary-engine';
import { listTemplatesForKind, type AnySummaryTemplate } from '@/lib/summary-templates';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { generateSummaryId, type SummaryItem } from '@/types/summary';

interface NovelPolishDialogProps {
  chapter: NovelChapter | null;
  onClose: () => void;
  readOnly: boolean;
  session: ChatSession;
  polish?: { story: ArchiveStory; branchId: string | null };
}

export function NovelPolishDialog({
  chapter,
  onClose,
  readOnly,
  session,
  polish,
}: NovelPolishDialogProps) {
  useI18n();
  const { toast } = useToast();
  const [polishTemplates, setPolishTemplates] = useState<AnySummaryTemplate[]>([]);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [polishTemplateId, setPolishTemplateId] = useState('builtin-novelize');
  const [polishStreaming, setPolishStreaming] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [polishResult, setPolishResult] = useState('');
  const [polishSavedId, setPolishSavedId] = useState<string | null>(null);
  const [polishPermanent, setPolishPermanent] = useState(false);
  const [polishDiscardAsk, setPolishDiscardAsk] = useState(false);
  const polishOutputRef = useRef('');
  const polishAbortRef = useRef<AbortController | null>(null);
  const lastUsedTemplateRef = useRef<AnySummaryTemplate | undefined>(undefined);

  const loadTemplates = useCallback(async () => {
    setTemplateLoadError(null);
    try {
      const list = await listTemplatesForKind('diy');
      setPolishTemplates(list);
      setPolishTemplateId((prev) => (
        list.length > 0 && !list.some((t) => t.id === prev) ? list[0].id : prev
      ));
    } catch (error) {
      setTemplateLoadError(error instanceof Error ? error.message : tr("润色模板读取失败"));
    }
  }, []);

  useEffect(() => {
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
    if (!chapter) return;
    setTruncated(false);
    setPolishStreaming(false);
    setPolishResult('');
    setPolishSavedId(null);
    setPolishPermanent(false);
    polishOutputRef.current = '';
    void loadTemplates();
    return () => {
      polishAbortRef.current?.abort();
      polishAbortRef.current = null;
    };
  }, [chapter, loadTemplates]);

  useEffect(() => {
    if (readOnly) {
      polishAbortRef.current?.abort();
      polishAbortRef.current = null;
    }
  }, [readOnly]);

  const polishTemplate = polishTemplates.find((t) => t.id === polishTemplateId);

  const buildPolishItem = (
    content: string,
    autoSaved: boolean,
    id: string,
    targetChapter: NovelChapter,
    usedTemplate: AnySummaryTemplate | undefined,
  ): SummaryItem => ({
    id,
    bookId: polish!.story.id,
    bookTitle: polish!.story.title,
    kind: 'diy',
    title: tr("小说化 · {{v0}}", { v0: targetChapter.title ?? tr("第 {{v0}}~{{v1}} 楼", { v0: targetChapter.startFloor, v1: targetChapter.endFloor }) }),
    branchId: polish!.branchId ?? undefined,
    floorStart: targetChapter.startFloor,
    floorEnd: targetChapter.endFloor,
    content,
    genParams: {
      model: loadAPIConfig().model,
      templateId: usedTemplate?.id ?? polishTemplateId,
      templateTitle: usedTemplate?.title,
      templateSnapshot: usedTemplate?.content,
      speakerPrefix: true,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoSaved,
  });

  const handlePolish = async () => {
    if (readOnly || !polish || !chapter || !polishTemplate) return;
    const config = loadAPIConfig();
    if (!isLLMConfigured(config)) {
      toast({
        title: tr("还没配好 AI 接口"),
        description: tr("去「设置 → AI 配置」填好接口地址和模型再来试试"),
        variant: 'destructive',
      });
      return;
    }
    const targetChapter = chapter;
    const activeTemplate = polishTemplate;
    lastUsedTemplateRef.current = activeTemplate;
    const { messages } = buildSummaryMessages({
      session,
      floorStart: targetChapter.startFloor,
      floorEnd: targetChapter.endFloor,
      template: activeTemplate.content,
    });
    setTruncated(false);
    setPolishStreaming(true);
    setPolishResult('');
    setPolishSavedId(null);
    setPolishPermanent(false);
    polishOutputRef.current = '';
    const controller = new AbortController();
    polishAbortRef.current = controller;
    let generated = false;
    try {
      await callOpenAIMessages(config, messages, {
        onChunk: (chunk) => {
          if (controller.signal.aborted) return;
          polishOutputRef.current += chunk;
          setPolishResult(polishOutputRef.current);
        },
        signal: controller.signal,
        onWarning: () => setTruncated(true),
      });
      generated = !controller.signal.aborted && polishOutputRef.current.length > 0;
    } catch (err) {
      if (isLLMCancelled(err)) {
        toast({ title: tr("已停止生成") });
      } else {
        toast({
          title: tr("润色生成没成功"),
          description: err instanceof Error ? err.message : tr("请检查 AI 接口连接或换个模型试试"),
          variant: 'destructive',
        });
      }
    } finally {
      setPolishStreaming(false);
      if (polishAbortRef.current === controller) polishAbortRef.current = null;
    }

    if (!generated || controller.signal.aborted) return;

    const id = generateSummaryId();
    try {
      await saveSummary(buildPolishItem(polishOutputRef.current, false, id, targetChapter, activeTemplate));
      setPolishSavedId(id);
      toast({ title: tr("已保存润色正文"), description: tr("去「整理与记录」可随时翻阅或继续编辑") });
    } catch (error) {
      toast({
        title: tr("正文已生成，但自动暂存没成功"),
        description: error instanceof Error ? error.message : tr("请点右下角「永久保存」重试，或先复制正文以防丢失"),
        variant: 'destructive',
      });
    }
  };

  const handlePolishPermanent = async () => {
    if (readOnly || !polishResult || !polish || !chapter) return;
    try {
      const id = polishSavedId ?? generateSummaryId();
      await saveSummary(buildPolishItem(
        polishResult,
        false,
        id,
        chapter,
        lastUsedTemplateRef.current ?? polishTemplate,
      ));
      setPolishSavedId(id);
      setPolishPermanent(true);
      toast({ title: tr("已正式收进故事记录") });
    } catch (error) {
      toast({
        title: tr("保存失败"),
        description: error instanceof Error ? error.message : tr("请检查文件库目录是否可写后重试"),
        variant: 'destructive',
      });
    }
  };

  const handlePolishDiscard = async (options: RemoveOptions) => {
    if (polishSavedId) await deleteSummary(polishSavedId, options);
    setPolishResult('');
    setPolishSavedId(null);
    setPolishPermanent(false);
    polishOutputRef.current = '';
    toast({ title: tr("已丢弃这份草稿"), description: tr("对应的润色记录已从库里清理") });
  };

  return (
    <>
      <Dialog
        open={!readOnly && !!chapter}
        onOpenChange={(v) => {
          if (!polishStreaming && !v) onClose();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <CompletionWarning truncated={truncated} />
          <DialogHeader>
            <DialogTitle>{tr("AI 润色本章（{{v0}}）", { v0: chapter?.title ?? tr("#{{v0}}–{{v1}} 楼", { v0: chapter?.startFloor, v1: chapter?.endFloor }) })}
            </DialogTitle>
            <DialogDescription>{tr("按所选文风模板把这一章改写成连贯小说正文；结果会收进这篇故事的「整理与记录」，随时能改能导出。")}</DialogDescription>
          </DialogHeader>

          {templateLoadError && (
            <div role="alert" className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{tr("读取润色模板失败：")}{templateLoadError}</span>
              <Button variant="ghost" size="sm" onClick={() => void loadTemplates()}>{tr("重试")}</Button>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs text-muted-foreground shrink-0">{tr("文风模板")}</Label>
            <Select value={polishTemplateId} onValueChange={setPolishTemplateId} disabled={polishStreaming}>
              <SelectTrigger aria-label={tr("选择润色文风模板")} className="h-8 text-sm flex-1 min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {polishTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!polishStreaming ? (
              <Button size="sm" className="gap-1" onClick={() => void handlePolish()} disabled={!polishTemplate}>
                <Feather className="w-3.5 h-3.5" />{polishResult ? tr("重新生成") : tr("生成")}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" className="gap-1" onClick={() => polishAbortRef.current?.abort()}>
                <Square className="w-3.5 h-3.5" />{tr("停止")}<Loader2 className="w-3.5 h-3.5 animate-spin" />
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-32 overflow-y-auto rounded-md border border-border bg-card p-3 text-sm">
            {polishResult ? (
              <MarkdownLite text={polishResult} />
            ) : (
              <span className="text-xs text-muted-foreground">{tr("润色好的小说正文会实时浮现在这里。点上方「生成」才会调用模型接口。")}</span>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={polishStreaming} onClick={onClose}>{tr("关闭")}</Button>
            <Button
              variant="ghost"
              className="gap-1 text-muted-foreground hover:text-destructive"
              disabled={polishStreaming || !polishResult}
              onClick={() => setPolishDiscardAsk(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />{tr("不要了")}</Button>
            <Button disabled={polishStreaming || !polishResult || polishPermanent} onClick={() => void handlePolishPermanent()}>
              {polishPermanent ? tr("已永久保存") : tr("永久保存为自定义记录")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={polishDiscardAsk}
        onOpenChange={setPolishDiscardAsk}
        title={tr("丢弃这份润色结果？")}
        description={
          polishPermanent
            ? tr("这份正文已经正式保存，丢弃后将从记录列表里移除。")
            : tr("这份草稿已自动暂存，丢弃后将从记录列表里移除。")
        }
        fileTarget={polishSavedId ? { store: 'summaries', id: polishSavedId } : undefined}
        onConfirm={handlePolishDiscard}
        confirmLabel={tr("丢弃")}
      />
    </>
  );
}
