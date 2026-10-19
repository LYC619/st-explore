import { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, Square, Loader2, Check, Pencil, RotateCcw, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { loadAPIConfig } from '@/components/ai-tools';
import { ApiStatusLine } from '@/components/ai-tools/ApiStatusLine';
import { callOpenAIMessages } from '@/components/ai-tools/useOpenAI';
import { FloorRangePicker } from '@/components/summary/FloorRangePicker';
import { getAllSummaries } from '@/lib/summary-db';
import { getAllPresets } from '@/lib/preset-db';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import { getArchiveStory, getBranchLine } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import { AttachPanel, type AttachState } from '@/components/summary/AttachPanel';
import { buildScopedTreeRequest } from '@/lib/story-tree-context';
import type { SummaryItem } from '@/types/summary';
import type { PresetItem } from '@/types/preset';
import type { WorldBookItem } from '@/types/worldbook';
import type { ChatSession, RegexRule } from '@/types/chat';
import type { StoryNode, StoryTree } from '@/types/story-tree';
import { NODE_TYPE_LABELS, isStoryNodeType } from '@/types/story-tree';
import {
  parseTreeOpsResult, applyTreeOps,
  DEFAULT_TREE_FILL_PROMPT, floorsToText, type TreeOp,
} from '@/lib/story-tree-ai';

const PROMPT_LS_KEY = 'st-story-tree-fill-prompt';

interface AIFillDialogProps {
  storyId?: string | null;
  branchId?: string | null;
  treeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ChatSession;
  nodes: StoryNode[];
  /** 确认后回传应用了 ops 的新 nodes */
  onApply: (nodes: StoryNode[]) => void;
}

/** 单条待应用操作：included=是否应用；expanded=是否展开预览/编辑 */
interface OpItem {
  op: TreeOp;
  included: boolean;
  expanded: boolean;
}

const OP_BADGE: Record<TreeOp['op'], { text: string; cls: string }> = {
  insert: { text: '+ 新增', cls: 'text-[color:var(--status-ok)]' },
  update: { text: '~ 更新', cls: 'text-[color:var(--status-warn)]' },
  archive: { text: '⊘ 归档', cls: 'text-muted-foreground' },
};

/**
 * AI 从选定楼层生成事实节点：选楼层 → 生成 ops → 逐条预览/编辑/取舍 → 确认 apply。
 * API 配置在「AI 配置」页统一维护（此处只显示状态）；提示词可查看/编辑（localStorage 记忆）。
 */
export function AIFillDialog({ open, onOpenChange, session, nodes, onApply, storyId = null, branchId = null, treeId }: AIFillDialogProps) {
  const { toast } = useToast();
  const [floorStart, setFloorStart] = useState(0);
  const [floorEnd, setFloorEnd] = useState(Math.max(0, session.messages.length - 1));
  const [instruction, setInstruction] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [rawOutput, setRawOutput] = useState('');
  const [opItems, setOpItems] = useState<OpItem[] | null>(null);
  const [references, setReferences] = useState<SummaryItem[]>([]), [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [presets, setPresets] = useState<PresetItem[]>([]), [books, setBooks] = useState<WorldBookItem[]>([]);
  const [rules, setRules] = useState<RegexRule[]>([]), [processed, setProcessed] = useState(false), [crossBranch, setCrossBranch] = useState(false);
  const [attach, setAttach] = useState<AttachState>({ presetId: null, worldbookId: null, worldbookMode: 'constant', worldbookUids: [] });
  const [contextError, setContextError] = useState(''), [contextLoading, setContextLoading] = useState(false), [outputError, setOutputError] = useState('');
  const generation = useRef(0), generatedNodes = useRef('');
  const generatedRequest = useRef('');
  const requestEpoch = useRef(getVaultEpoch());

  // 可编辑提示词（改后记忆；空=用默认）
  const [promptOpen, setPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(DEFAULT_TREE_FILL_PROMPT);
  const request = useMemo(() => buildScopedTreeRequest({ storyId, branchId, session, nodes, floorStart, floorEnd,
    references: references.filter(record => selectedRefs.has(record.id)), allowCrossBranch: crossBranch,
    preset: presets.find(preset => preset.id === attach.presetId)?.preset,
    worldbook: books.find(book => book.id === attach.worldbookId)?.worldbook, worldbookMode: attach.worldbookMode, worldbookUids: attach.worldbookUids,
    processed, regexRules: rules, instruction, systemPrompt: customPrompt }),
  [storyId, branchId, session, nodes, floorStart, floorEnd, references, selectedRefs, crossBranch, presets, books, attach, processed, rules, instruction, customPrompt]);

  useEffect(() => {
    const saved = localStorage.getItem(PROMPT_LS_KEY);
    if (saved) setCustomPrompt(saved);
  }, []);

  const handlePromptChange = (v: string) => {
    setCustomPrompt(v);
    localStorage.setItem(PROMPT_LS_KEY, v);
  };

  const handlePromptReset = () => {
    setCustomPrompt(DEFAULT_TREE_FILL_PROMPT);
    localStorage.removeItem(PROMPT_LS_KEY);
    toast({ title: '已恢复默认提示词' });
  };

  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef('');
  useEffect(() => {
    if (!open) return;
    let active = true; requestEpoch.current = getVaultEpoch();
    setContextLoading(true); setContextError(''); setSelectedRefs(new Set()); setReferences([]);
    setOpItems(null); setRawOutput(''); setOutputError(''); setStreaming(false);
    void Promise.all([getAllSummaries(), getAllPresets(), getAllWorldBooks(), storyId ? getArchiveStory(storyId) : Promise.resolve(undefined)]).then(([records, presets, books, story]) => {
      if (!active || requestEpoch.current !== getVaultEpoch()) return;
      if (storyId && (!story || !getBranchLine(story, branchId))) throw new Error('来源故事或分支不存在');
      setReferences(records.filter(record => record.bookId === storyId && (record.kind === 'volume' || record.kind === 'diary')));
      setPresets(presets); setBooks(books); setRules(story?.settings?.regexRules ?? []);
    }).catch(error => { if (active) setContextError(String(error)); }).finally(() => { if (active) setContextLoading(false); });
    // This is a sequence counter, deliberately invalidated at cleanup, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { active = false; generation.current++; abortRef.current?.abort(); };
  }, [open, storyId, branchId, treeId]);

  const handleGenerate = async () => {
    if (streaming || contextLoading || contextError) return;
    if (requestEpoch.current !== getVaultEpoch()) { setOutputError('资料库已切换，请重新打开。'); return; }
    const config = loadAPIConfig(); // 即时读取全局配置
    if (!config.apiKey) {
      toast({ title: '请先配置 API Key', description: '前往「AI 配置」页配置后回来生成', variant: 'destructive' });
      return;
    }
    const floorText = floorsToText(session, floorStart, floorEnd);
    if (!floorText.trim()) {
      toast({ title: '选中的楼层没有内容', variant: 'destructive' });
      return;
    }
    if ((attach.presetId && !presets.some(preset => preset.id === attach.presetId)) || (attach.worldbookId && !books.some(book => book.id === attach.worldbookId))) {
      setOutputError('所选预设或世界书已不存在，请重新选择'); return;
    }
    const messages = request.messages;
    const sequence = ++generation.current;
    generatedNodes.current = JSON.stringify(nodes); setOutputError('');
    generatedRequest.current = JSON.stringify({ floorStart, floorEnd, messages });
    setStreaming(true);
    setRawOutput('');
    setOpItems(null);
    outputRef.current = '';
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await callOpenAIMessages(config, messages, {
        onChunk: (c) => { if (generation.current === sequence && requestEpoch.current === getVaultEpoch()) { outputRef.current += c; setRawOutput(outputRef.current); } },
        signal: controller.signal,
        params: { ...request.params, temperature: 0.2 },
      });
      if (generation.current !== sequence || requestEpoch.current !== getVaultEpoch()) return;
      const parsed = parseTreeOpsResult(outputRef.current);
      if (parsed.status !== 'ok') { setOutputError(parsed.status === 'refused' ? '模型拒绝了本次请求，原始输出已保留。' : parsed.status === 'invalid-json' ? '模型输出不是有效 JSON，原始输出已保留。' : '没有有效树操作，原始输出已保留。'); return; }
      setOpItems(parsed.ops.map((op) => ({ op, included: true, expanded: false })));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') toast({ title: '已停止' });
      else toast({ title: '生成失败', description: err instanceof Error ? err.message : '未知错误', variant: 'destructive' });
    } finally {
      if (generation.current === sequence) { setStreaming(false); abortRef.current = null; }
    }
  };

  const patchItem = (idx: number, patch: Partial<OpItem>) =>
    setOpItems((items) => items?.map((it, i) => (i === idx ? { ...it, ...patch } : it)) ?? null);
  const patchOp = (idx: number, patch: Partial<TreeOp>) =>
    setOpItems((items) => items?.map((it, i) => (i === idx ? { ...it, op: { ...it.op, ...patch } } : it)) ?? null);
  const removeItem = (idx: number) =>
    setOpItems((items) => items?.filter((_, i) => i !== idx) ?? null);

  const includedCount = opItems?.filter((it) => it.included).length ?? 0;

  const handleConfirm = async () => {
    const sequence = generation.current;
    if (requestEpoch.current !== getVaultEpoch() || generatedNodes.current !== JSON.stringify(nodes)
      || generatedRequest.current !== JSON.stringify({ floorStart, floorEnd, messages: request.messages })) { setOutputError('目标、输入或树内容已变化，请重新生成。'); return; }
    const activeOps = opItems?.filter((it) => it.included).map((it) => it.op) ?? [];
    if (activeOps.length === 0) return;
    // 本批事实的卷/楼层标记（仅角色节点会按它分卷归档，见 applyTreeOps）。
    // 选中范围完整落在某个已存分卷内时用「第N卷」，否则用楼层区间。
    const lo = Math.min(floorStart, floorEnd);
    const hi = Math.max(floorStart, floorEnd);
    let sectionLabel = `楼层 ${lo}~${hi}`;
    try {
      const vol = (await getAllSummaries()).find((s) =>
        s.kind === 'volume' && s.volumeNumber != null && s.bookId === storyId && (s.branchId ?? null) === branchId && !s.rangeDetached
        && lo >= s.floorStart && hi <= s.floorEnd
      );
      if (vol) sectionLabel = `第${vol.volumeNumber}卷 · 楼层 ${lo}~${hi}`;
    } catch { /* 查不到分卷就用楼层区间 */ }
    if (treeId) {
      try {
        const current = await getCurrentRepo<StoryTree>('stories').get(treeId);
        if (!current || current.bookId !== storyId || (current.branchId ?? null) !== branchId) { setOutputError('故事树已移动或删除，请重新打开。'); return; }
      } catch (error) { setOutputError(`读取目标故事树失败：${String(error)}`); return; }
    }
    if (sequence !== generation.current || requestEpoch.current !== getVaultEpoch()) return;
    const result = applyTreeOps(nodes, activeOps, { sectionLabel });
    onApply(result.nodes);
    toast({
      title: '已应用到故事树',
      description: `新增 ${result.inserted}·更新 ${result.updated}·归档 ${result.archived}${result.skipped ? `·跳过 ${result.skipped}` : ''}`,
    });
    onOpenChange(false);
    setOpItems(null);
    setRawOutput('');
  };

  /** 行首摘要：op 徽章 + 目标路径 */
  const opTarget = (op: TreeOp) =>
    op.op === 'insert' ? `${op.parent ? `${op.parent}/` : ''}${op.title ?? '?'}` : (op.path ?? '?');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 宽度加行内样式兜底：个别环境下 !max-w 类规则不生效（见 v0.16.1 世界书弹窗同款教训） */}
      <DialogContent className="!max-w-[min(64rem,94vw)] max-h-[88vh] overflow-y-auto" style={{ maxWidth: 'min(64rem, 94vw)' }}>
        <DialogHeader>
          <DialogTitle>AI 从楼层生成事实节点</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <ApiStatusLine />

          <p className="text-xs text-muted-foreground">
            累加式生成：当前树的结构（含之前各卷生成的节点）会随请求一并发给 AI，AI 只输出增量更新——
            按第二卷楼层生成时无需重选第一卷。角色的新事实会按卷归档进该角色名下；事件按发生顺序独立成节点。
          </p>

          <FloorRangePicker
            total={session.messages.length}
            start={floorStart}
            end={floorEnd}
            onChange={(s, e) => { setFloorStart(s); setFloorEnd(e); }}
          />
          {contextError && <p role="alert" className="text-sm text-destructive">读取上下文失败：{contextError}</p>}
          <fieldset disabled={streaming} className="space-y-2">
            <AttachPanel value={attach} onChange={setAttach} tokenEstimate={request.tokenEstimate} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={processed} onCheckedChange={value => setProcessed(value === true)} />使用本故事正则处理后的正文（不修改原文）</label>
            <p className="text-xs text-muted-foreground">实际规则：{processed ? rules.filter(rule => !rule.disabled).map(rule => rule.name).join('、') || '无启用规则' : '原文'}；楼层 {floorStart}–{floorEnd}</p>
            <details><summary className="cursor-pointer text-sm">参考总结/日记</summary>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={crossBranch} onCheckedChange={value => { setCrossBranch(value === true); setSelectedRefs(new Set()); }} />显示本故事其他脉络，供显式引用</label>
              {references.filter(record => crossBranch || (record.branchId ?? null) === branchId).map(record => <label key={record.id} className="flex items-center gap-2 py-1 text-sm">
                <Checkbox checked={selectedRefs.has(record.id)} onCheckedChange={value => setSelectedRefs(previous => { const next = new Set(previous); if (value === true) next.add(record.id); else next.delete(record.id); return next; })} />
                {record.title} · {record.kind === 'diary' ? `日记/${record.diaryOwner || record.genParams?.diaryOwner || '未指定人物'}` : '总结'} · {record.branchId ? '分支' : '主线'}
              </label>)}
            </details>
          </fieldset>
          <details><summary className="cursor-pointer text-sm">最终请求预览（约 {request.tokenEstimate.toLocaleString()} tokens）</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border p-2 text-xs">{request.messages.map(message => `[${message.role}]\n${message.content}`).join('\n\n')}</pre></details>
          {outputError && <p role="alert" className="text-sm text-destructive">{outputError}</p>}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">额外要求（可选）</Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例如：只关注角色关系变化；或：重点整理地点设定"
              className="min-h-[60px] text-sm"
            />
          </div>

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
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    修改会自动记住。注意保留 JSON ops 输出格式约定，否则无法解析。
                  </p>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={handlePromptReset}>
                    <RotateCcw className="w-3 h-3" />恢复默认
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!streaming ? (
              <Button className="gap-2" disabled={contextLoading || !!contextError} onClick={handleGenerate}>
                <Sparkles className="w-4 h-4" />生成
              </Button>
            ) : (
              <Button variant="destructive" className="gap-2" onClick={() => abortRef.current?.abort()}>
                <Square className="w-4 h-4" />停止
              </Button>
            )}
            {streaming && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>

          {/* 预览：每条操作可展开查看/编辑内容、勾选取舍、删除 */}
          {(streaming || rawOutput) && (
            <div className="space-y-2">
              {opItems ? (
                <>
                  <Label className="text-xs text-muted-foreground">
                    将应用的操作（{includedCount} / {opItems.length}）—— 点行展开预览与编辑
                  </Label>
                  <ScrollArea className="h-[48vh] border rounded-md">
                    <div className="p-1.5 space-y-1">
                      {opItems.map((item, i) => {
                        const badge = OP_BADGE[item.op.op] ?? OP_BADGE.archive;
                        const typeLabel = isStoryNodeType(item.op.type) ? NODE_TYPE_LABELS[item.op.type] : null;
                        return (
                          <div
                            key={i}
                            className={`rounded border ${item.included ? 'border-border' : 'border-border/50 opacity-50'}`}
                          >
                            <div className="flex items-center gap-1.5 px-1.5 py-1">
                              <Checkbox
                                checked={item.included}
                                onCheckedChange={(v) => patchItem(i, { included: v === true })}
                                aria-label="是否应用此操作"
                                className="shrink-0"
                              />
                              <button
                                className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                                onClick={() => patchItem(i, { expanded: !item.expanded })}
                              >
                                {item.expanded
                                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                                  : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                                <span className={`text-xs font-mono shrink-0 ${badge.cls}`}>{badge.text}</span>
                                <span className="text-sm truncate" title={opTarget(item.op)}>{opTarget(item.op)}</span>
                                {typeLabel && (
                                  <span className="text-[11px] px-1 rounded bg-muted text-muted-foreground shrink-0">{typeLabel}</span>
                                )}
                                {!item.expanded && item.op.content && (
                                  <span className="text-xs text-muted-foreground truncate" title={item.op.content}>
                                    {item.op.content.slice(0, 60)}
                                  </span>
                                )}
                              </button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeItem(i)}
                                title="删除此操作"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            {item.expanded && (
                              <div className="px-2 pb-2 pl-8 space-y-1.5">
                                {item.op.op === 'insert' && (
                                  <div className="flex items-center gap-1.5">
                                    <Label className="text-[11px] text-muted-foreground shrink-0">标题</Label>
                                    <Input size="sm"
                                      value={item.op.title ?? ''}
                                      onChange={(e) => patchOp(i, { title: e.target.value })}
                                      className="text-sm"
                                    />
                                  </div>
                                )}
                                {item.op.op !== 'archive' && (
                                  <div className="space-y-0.5">
                                    <Label className="text-[11px] text-muted-foreground">
                                      {item.op.op === 'insert' ? '正文' : '追加内容'}
                                    </Label>
                                    <Textarea
                                      value={item.op.content ?? ''}
                                      onChange={(e) => patchOp(i, { content: e.target.value })}
                                      className="min-h-[110px] text-sm"
                                    />
                                  </div>
                                )}
                                {(item.op.hint || item.op.keywords) && (
                                  <p className="text-[11px] text-muted-foreground">
                                    {item.op.hint ? `提示：${item.op.hint}` : ''}
                                    {item.op.hint && item.op.keywords ? ' · ' : ''}
                                    {item.op.keywords
                                      ? `标签：${Array.isArray(item.op.keywords) ? item.op.keywords.join(', ') : item.op.keywords}`
                                      : ''}
                                  </p>
                                )}
                                {item.op.op === 'archive' && (
                                  <p className="text-xs text-muted-foreground">将把「{item.op.path}」标记为已归档（可在树中恢复）。</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {opItems.length === 0 && <p className="text-sm text-muted-foreground p-2">无有效操作</p>}
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <ScrollArea className="h-32 border rounded-md p-2">
                  <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{rawOutput}</pre>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button className="gap-1" onClick={handleConfirm} disabled={includedCount === 0}>
            <Check className="w-4 h-4" />应用到故事树（{includedCount}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
