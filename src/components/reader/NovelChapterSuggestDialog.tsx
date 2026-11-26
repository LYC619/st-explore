import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Square } from 'lucide-react';
import { CompletionWarning } from '@/components/ai-tools/CompletionWarning';
import { loadAPIConfig } from '@/components/ai-tools';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { callOpenAIMessages, isLLMCancelled, isLLMConfigured } from '@/lib/llm';
import {
  buildChapterSuggestMessages,
  parseChapterSuggestions,
  type ChapterSuggestion,
} from '@/lib/novel-view';
import { getAllSummaries } from '@/lib/summary-db';
import type { SummaryItem } from '@/types/summary';
import type { ArchiveStory } from '@/types/archive';
import type { ChapterMarker, ChatSession } from '@/types/chat';

interface NovelChapterSuggestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
  session: ChatSession;
  markers: ChapterMarker[];
  onMarkersChange?: (next: ChapterMarker[]) => void;
  story?: ArchiveStory;
}

export function NovelChapterSuggestDialog({
  open,
  onOpenChange,
  readOnly,
  session,
  markers,
  onMarkersChange,
  story,
}: NovelChapterSuggestDialogProps) {
  useI18n();
  const { toast } = useToast();
  const [volumeSummaries, setVolumeSummaries] = useState<SummaryItem[]>([]);
  const [summaryLoadFailed, setSummaryLoadFailed] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestTruncated, setSuggestTruncated] = useState(false);
  const [suggestions, setSuggestions] = useState<(ChapterSuggestion & { picked: boolean })[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!open || !story) {
      setSummaryLoadFailed(false);
      return;
    }
    let cancelled = false;
    setSummaryLoadFailed(false);
    getAllSummaries()
      .then((all) => {
        if (cancelled) return;
        setVolumeSummaries(
          all
            .filter((s) => s.bookId === story.id && s.kind === 'volume')
            .sort((a, b) => (a.volumeNumber ?? 0) - (b.volumeNumber ?? 0)),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setVolumeSummaries([]);
        setSummaryLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, story]);

  const handleSuggestChapters = async () => {
    if (readOnly) return;
    const config = loadAPIConfig();
    if (!isLLMConfigured(config)) {
      toast({
        title: tr("还没配好 AI 接口"),
        description: tr("去「设置 → AI 配置」填好接口地址和模型再来试试"),
        variant: 'destructive',
      });
      return;
    }
    setSuggestTruncated(false);
    setSuggesting(true);
    setSuggestions(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const messages = buildChapterSuggestMessages({ session, volumeSummaries });
      const text = await callOpenAIMessages(config, messages, {
        signal: controller.signal,
        onWarning: () => setSuggestTruncated(true),
      });
      const parsed = parseChapterSuggestions(text, session.messages.length);
      if (!parsed || parsed.length === 0) {
        toast({
          title: tr("这次没提取出章节节点"),
          description: tr("可以点「重新生成」再试一次，或在 AI 配置里换个理解力更好的模型"),
          variant: 'destructive',
        });
      } else {
        setSuggestions(parsed.map((s) => ({ ...s, picked: true })));
      }
    } catch (err) {
      if (isLLMCancelled(err)) {
        toast({ title: tr("已停止生成") });
      } else {
        toast({
          title: tr("生成章节建议没成功"),
          description: err instanceof Error ? err.message : tr("请检查 AI 配置里的连接是否可用"),
          variant: 'destructive',
        });
      }
    } finally {
      setSuggesting(false);
      abortRef.current = null;
    }
  };

  const handleApplySuggestions = () => {
    if (readOnly || !suggestions || !onMarkersChange) return;
    const existingFloors = new Set(markers.map((m) => m.messageIndex));
    const additions: ChapterMarker[] = suggestions
      .filter((s) => s.picked && !existingFloors.has(s.floor) && session.messages[s.floor])
      .map((s) => ({
        messageId: session.messages[s.floor].id,
        messageIndex: s.floor,
        title: s.title,
        createdAt: Date.now(),
      }));
    if (additions.length === 0) {
      toast({ title: tr("没有新的章节可添加"), description: tr("勾选的楼层原本已经有章节标记了") });
      return;
    }
    onMarkersChange([...markers, ...additions].sort((a, b) => a.messageIndex - b.messageIndex));
    onOpenChange(false);
    setSuggestions(null);
    toast({ title: tr("已加上 {{v0}} 个章节标记", { v0: additions.length }), description: tr("随时可以在目录里跳转或继续修改标题") });
  };

  return (
    <Dialog
      open={!readOnly && open}
      onOpenChange={(next) => {
        if (!suggesting) {
          onOpenChange(next);
          if (!next) setSuggestions(null);
        }
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <CompletionWarning truncated={suggestTruncated} />
        <DialogHeader>
          <DialogTitle>{tr("AI 帮你划分章节")}</DialogTitle>
          <DialogDescription>{tr("AI 不会硬啃整篇原文：")}{summaryLoadFailed
              ? tr("分卷总结暂时没能读取出来，这次先按抽样楼层来判断")
              : volumeSummaries.length > 0
                ? tr("会结合已有的 {{v0}} 卷总结与抽样楼层来找剧情转折点", { v0: volumeSummaries.length })
                : tr("这篇故事还没有分卷总结，会先按抽样楼层判断（先做分卷总结会更准）")}{tr("。生成结果只是草稿，勾选确认后才会正式标进故事。")}</DialogDescription>
        </DialogHeader>

        {!suggestions && (
          !suggesting ? (
            <Button className="gap-1" onClick={() => void handleSuggestChapters()}>
              <Sparkles className="w-4 h-4" />{tr("生成章节建议")}</Button>
          ) : (
            <Button variant="destructive" className="gap-1" onClick={() => abortRef.current?.abort()}>
              <Square className="w-4 h-4" />{tr("停止")}<Loader2 className="w-4 h-4 animate-spin" />
            </Button>
          )
        )}

        {suggestions && (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={`${s.floor}`} className="flex items-center gap-2">
                <Checkbox
                  aria-label={tr("选择第 {{v0}} 楼章节建议", { v0: s.floor })}
                  checked={s.picked}
                  onCheckedChange={(c) =>
                    setSuggestions((prev) => prev!.map((x, j) => (j === i ? { ...x, picked: !!c } : x)))
                  }
                />
                <span className="text-xs text-muted-foreground w-16 shrink-0">{tr("#{{v0}} 楼", { v0: s.floor })}</span>
                <Input
                  size="sm"
                  aria-label={tr("第 {{v0}} 楼章节标题", { v0: s.floor })}
                  value={s.title}
                  onChange={(e) =>
                    setSuggestions((prev) => prev!.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                  className="text-sm"
                />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => void handleSuggestChapters()}>{tr("重新生成")}</Button>
              <Button size="sm" onClick={handleApplySuggestions}>{tr("应用 ")}{suggestions.filter((s) => s.picked).length}{tr(" 个章节标记")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
