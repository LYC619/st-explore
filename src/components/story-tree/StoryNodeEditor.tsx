import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useMemo, useEffect, useState  } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pin, Archive, Trash2, Layers, LocateFixed, Pencil, X } from 'lucide-react';
import type { StoryNode, StoryNodeType } from '@/types/story-tree';
import { STORY_NODE_TYPES, NODE_TYPE_LABELS, NODE_TYPE_DOT } from '@/types/story-tree';
import { splitContentSections } from '@/lib/story-tree-ai';

interface StoryNodeEditorProps {
  node: StoryNode;
  onChange: (patch: Partial<Omit<StoryNode, 'id' | 'parentId' | 'order'>>) => void;
  onDelete: () => void;
  onClose?: () => void;
  onJumpToFloor?: (floor: number) => void;
}

function extractFloorRefs(text: string): number[] {
  const found = new Set<number>();
  const re = /(?:#|第\s*)(\d+)(?:\s*[-~～至]\s*\d+)?(?:\s*楼)?|(\d+)\s*[-~～]\s*\d+\s*楼/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isSafeInteger(n) && n >= 0) found.add(n);
    if (found.size >= 8) break;
  }
  return [...found].sort((a, b) => a - b);
}

/** 右栏节点编辑表单：标题/提示/正文/标签 + 置顶/归档开关 + 提及楼层直跳 + 删除。 */
export function StoryNodeEditor({ node, onChange, onDelete, onClose, onJumpToFloor }: StoryNodeEditorProps) {
  useI18n();
  const sections = splitContentSections(node.content);
  const hasSections = sections.some((s) => s.label != null);
  const [byVolume, setByVolume] = useState(hasSections);
  useEffect(() => setByVolume(hasSections), [node.id, hasSections]);

  const floorRefs = useMemo(
    () => extractFloorRefs(`${node.hint}\n${node.content}`),
    [node.hint, node.content],
  );

  return (
    <div className="space-y-3">
      {onClose && (
        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <span className="text-xs font-medium text-muted-foreground">{tr("节点详情")}</span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={tr("收起节点详情")} title={tr("收起右侧面板")}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <Label htmlFor="node-title" className="text-xs text-muted-foreground">{tr("标题")}</Label>
          <Input
            id="node-title"
            value={node.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </div>
        <div className="space-y-1 w-28 shrink-0">
          <Label className="text-xs text-muted-foreground">{tr("类型")}</Label>
          <Select
            value={node.type ?? 'none'}
            onValueChange={(v) => onChange({ type: v === 'none' ? undefined : (v as StoryNodeType) })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tr("未分类")}</SelectItem>
              {STORY_NODE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${NODE_TYPE_DOT[t]}`} />
                    {NODE_TYPE_LABELS[t]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {onJumpToFloor && floorRefs.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{tr("跳回原文：")}</span>
          {floorRefs.map((floor) => (
            <button
              key={floor}
              type="button"
              onClick={() => onJumpToFloor(floor)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-primary hover:bg-primary/10 transition-colors tabular-nums"
            >
              <LocateFixed className="w-3 h-3" />
              {tr("#{{v0}} 楼", { v0: floor })}</button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="node-hint" className="text-xs text-muted-foreground">{tr("提示 / 别名（大纲里跟在标题后）")}</Label>
        <Input
          id="node-hint"
          value={node.hint}
          onChange={(e) => onChange({ hint: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="node-content" className="text-xs text-muted-foreground">{tr("正文（事实描述）")}</Label>
          {hasSections && (
            <div className="flex items-center gap-1">
              <Button
                variant={byVolume ? 'default' : 'ghost'} size="sm" className="px-2 gap-1 text-xs"
                aria-pressed={byVolume} title={tr("按已有小节分段阅读，不会自动划卷")}
                onClick={() => setByVolume(true)}
              >
                <Layers className="w-3 h-3" />{tr("分段阅读")}</Button>
              <Button
                variant={!byVolume ? 'default' : 'ghost'} size="sm" className="px-2 gap-1 text-xs"
                onClick={() => setByVolume(false)}
              >
                <Pencil className="w-3 h-3" />{tr("编辑")}</Button>
            </div>
          )}
        </div>
        {hasSections && byVolume ? (
          <div className="space-y-2 max-h-[42vh] overflow-y-auto overscroll-contain pr-0.5">
            {sections.map((s, i) => (
              <div key={i} className="rounded-md border bg-muted/30 p-2.5">
                {s.label && (
                  <div className="text-xs font-medium text-primary mb-1">{s.label}</div>
                )}
                <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {s.body || <span className="text-muted-foreground">{tr("（空）")}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Textarea
            id="node-content"
            value={node.content}
            onChange={(e) => onChange({ content: e.target.value })}
            className="min-h-[30vh] text-sm leading-relaxed"
            placeholder={tr("记录这个节点的事实信息……（如写下 #12 楼 可自动生成原文跳转按钮）")}
          />
        )}
        {hasSections && byVolume && (
          <p className="text-xs text-muted-foreground">{tr("按卷/楼层分段展示（角色节点由 AI 生成时自动归档），点「编辑」可改原文（含 ## 小节标题）。")}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="node-tags" className="text-xs text-muted-foreground">{tr("标签（逗号分隔）")}</Label>
        <Input
          id="node-tags"
          value={node.tags.join(', ')}
          onChange={(e) => onChange({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
          placeholder={tr("人物, 关系, 地点…")}
        />
      </div>
      <div className="flex items-center gap-4 flex-wrap pt-1">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <Checkbox checked={node.pinned} onCheckedChange={(v) => onChange({ pinned: v === true })} />
          <Pin className="w-3.5 h-3.5" />{tr("置顶")}</label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <Checkbox checked={node.archived} onCheckedChange={(v) => onChange({ archived: v === true })} />
          <Archive className="w-3.5 h-3.5" />{tr("归档")}</label>
        <Button variant="ghost" size="sm" className="gap-1 text-destructive ml-auto" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />{tr("删除节点（含子节点）")}</Button>
      </div>
    </div>
  );
}
