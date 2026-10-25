import { getBuiltinPromptDefault, getBuiltinPrompt, formatBuiltinPrompt, saveBuiltinPrompt, resetBuiltinPrompt } from '@/lib/builtin-prompts';
import { useBuiltinPrompt } from '@/hooks/use-builtin-prompt';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Sparkles, Loader2, StopCircle, Wand2, FileWarning, Pencil, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { loadAPIConfig } from '@/components/ai-tools';
import { callOpenAIMessages } from '@/components/ai-tools/useOpenAI';
import { ApiStatusLine } from '@/components/ai-tools/ApiStatusLine';
import { FloorRangePicker } from '@/components/summary/FloorRangePicker';
import { floorsToText } from '@/lib/story-tree-ai';
import { loadActiveSession } from '@/lib/session-storage';
import { parseWorldBook } from '@/types/worldbook';
import type { WorldBook, WorldBookEntry } from '@/types/worldbook';
import type { ChatSession } from '@/types/chat';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingEntries: WorldBookEntry[];
  onAppend: (wb: WorldBook) => void;
}

/** 增量更新默认提示词：在"提取世界书"基础上强调"只输出新设定、不重复已有条目"。可在弹窗内查看编辑。 */
export const DEFAULT_WB_UPDATE_PROMPT = getBuiltinPromptDefault('worldbook.update');


export function AIUpdateDialog({ open, onOpenChange, existingEntries, onAppend }: Props) {
  const { toast } = useToast();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [floorStart, setFloorStart] = useState(0);
  const [floorEnd, setFloorEnd] = useState(0);
  const savedPrompt = useBuiltinPrompt('worldbook.update');
  const [customPrompt, setCustomPrompt] = useState(() => getBuiltinPrompt('worldbook.update'));
  const [promptOpen, setPromptOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // 与设置页共用已保存的提示词，重新打开时读取最新版本
  useEffect(() => {
    if (open) setCustomPrompt(savedPrompt);
  }, [open, savedPrompt]);

  const handlePromptChange = (v: string) => {
    setCustomPrompt(v);
  };

  const handlePromptSave = () => {
    try { saveBuiltinPrompt('worldbook.update', customPrompt); toast({ title: '提示词已保存到设置' }); }
    catch (err) { toast({ title: '保存失败', description: String(err), variant: 'destructive' }); }
  };

  const handlePromptReset = () => {
    try {
      resetBuiltinPrompt('worldbook.update');
      setCustomPrompt(getBuiltinPrompt('worldbook.update'));
      toast({ title: '已恢复默认提示词' });
    } catch (err) { toast({ title: '恢复失败', description: String(err), variant: 'destructive' }); }
  };

  // 打开时载入活跃聊天（API 配置统一在 AI 工具页维护，生成时即时读取）
  useEffect(() => {
    if (!open) return;
    setOutput('');
    loadActiveSession().then((s) => {
      setSession(s);
      setSessionLoaded(true);
      if (s) {
        setFloorStart(0);
        setFloorEnd(Math.max(0, s.messages.length - 1));
      }
    }).catch(() => setSessionLoaded(true));
  }, [open]);

  const floorCount = useMemo(
    () => (session ? Math.max(0, Math.min(floorEnd, session.messages.length - 1) - Math.max(0, floorStart) + 1) : 0),
    [session, floorStart, floorEnd]
  );

  // 已有条目摘要（标题 + 关键词），喂给 AI 防重复
  const existingSummary = useMemo(() => {
    if (existingEntries.length === 0) return '（当前世界书为空）';
    return existingEntries
      .map((e) => `- ${e.comment || '(无标题)'}${e.key.length ? `（关键词：${e.key.join('、')}）` : ''}`)
      .join('\n');
  }, [existingEntries]);

  const handleGenerate = useCallback(async () => {
    const config = loadAPIConfig(); // 生成时即时读取（配置在 AI 工具页维护）
    if (!config.apiKey) {
      toast({ title: '请先配置 API Key', description: '前往「AI 配置」页配置后回来生成', variant: 'destructive' });
      return;
    }
    if (!session || floorCount === 0) {
      toast({ title: '请先选择要分析的楼层', variant: 'destructive' });
      return;
    }

    const userContent = formatBuiltinPrompt('worldbook.update.input', { existing: existingSummary, chat: floorsToText(session, floorStart, floorEnd) });
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setOutput('');
    try {
      await callOpenAIMessages(config, [
        { role: 'system', content: customPrompt.trim() || getBuiltinPrompt('worldbook.update') },
        { role: 'user', content: userContent },
      ], {
        onChunk: (chunk) => setOutput((p) => p + chunk),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        toast({ title: '已停止生成' });
      } else {
        toast({ title: '生成失败', description: e instanceof Error ? e.message : '请检查 API 配置', variant: 'destructive' });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [session, floorStart, floorEnd, floorCount, customPrompt, existingSummary, toast]);

  const handleStop = () => abortRef.current?.abort();

  // 解析 AI 输出为 WorldBook
  const parsed = useMemo(() => {
    if (!output) return null;
    try {
      const jsonStr = output.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
      const json = JSON.parse(jsonStr);
      if (!json || typeof json !== 'object' || !json.entries) return null;
      const wb = parseWorldBook(json);
      return { wb, count: Object.keys(wb.entries).length };
    } catch {
      return null;
    }
  }, [output]);

  const handleAppend = () => {
    if (!parsed) return;
    if (parsed.count === 0) {
      toast({ title: 'AI 未提炼出新设定', description: '对话中没有可新增的世界观条目' });
      return;
    }
    onAppend(parsed.wb);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            AI 按聊天内容追加世界书条目
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            根据聊天记录提炼<strong>新</strong>设定，<strong>追加</strong>为新条目（不改动现有条目）。想修改某一条，请在该条目编辑区用「AI 改写」。
          </p>

          <ApiStatusLine />

          {/* 无活跃聊天 */}
          {sessionLoaded && !session && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <FileWarning className="w-8 h-8" />
              <p className="text-sm">没有正在编辑的聊天记录。</p>
              <p className="text-xs">请先到「聊天处理」导入或从书架打开一份聊天记录，再回来使用此功能。</p>
            </div>
          )}

          {/* 楼层范围 + 提示词 + 生成 */}
          {session && (
            <>
              <FloorRangePicker
                total={session.messages.length}
                start={floorStart}
                end={floorEnd}
                onChange={(s, e) => { setFloorStart(s); setFloorEnd(e); }}
              />

              {/* 提示词查看/编辑 */}
              <div className="space-y-1">
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setPromptOpen((o) => !o)}
                >
                  <Pencil className="w-3 h-3" />
                  {promptOpen ? '收起提示词' : '查看/编辑提示词'}
                </button>
                {promptOpen && (
                  <div className="space-y-1.5">
                    <Textarea
                      value={customPrompt}
                      onChange={(e) => handlePromptChange(e.target.value)}
                      className="min-h-[30vh] font-mono text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <p className="text-xs text-muted-foreground">
                        本次生成使用当前输入；保存后供所有入口使用。注意保留 {'{ "entries": ... }'} 的 JSON 输出约定，否则无法解析并入。
                      </p>
                      <Button variant="outline" size="sm" disabled={customPrompt === savedPrompt} onClick={handlePromptSave}>保存提示词</Button>
                      <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={handlePromptReset}>
                        <RotateCcw className="w-3 h-3" />恢复默认
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!loading ? (
                  <Button onClick={handleGenerate} className="gap-1.5" disabled={floorCount === 0}>
                    <Wand2 className="w-4 h-4" /> 生成新条目（{floorCount} 楼）
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={handleStop} className="gap-1.5">
                    <StopCircle className="w-4 h-4" /> 停止
                  </Button>
                )}
                {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">
                  已有 {existingEntries.length} 条 · AI 只提炼新设定、避免重复
                </span>
              </div>

              {/* 输出 */}
              {output && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">AI 输出：</div>
                  <pre className="text-xs whitespace-pre-wrap rounded-md border border-border bg-secondary/30 p-3 max-h-60 overflow-auto">{output}</pre>
                  {!loading && (
                    parsed ? (
                      <Button onClick={handleAppend} className="gap-1.5">
                        <Sparkles className="w-4 h-4" /> 并入世界书（{parsed.count} 条新条目）
                      </Button>
                    ) : (
                      <p className="text-xs text-[color:var(--status-warn)]">AI 返回的内容不是有效的世界书 JSON，可点「停止」后重试或调整选择范围。</p>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
