import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StoryCardView } from '@/components/story-tree/StoryCardView';
import { StoryTimeline } from '@/components/story-tree/StoryTimeline';
import { StoryTreeView } from '@/components/story-tree/StoryTreeView';
import { MarkdownLite } from '@/components/MarkdownLite';
import { toForest } from '@/lib/story-tree-model';
import type { StoryTree } from '@/types/story-tree';

export function StoryTreePreview({ tree }: { tree: StoryTree }) {
  const [mode, setMode] = useState<'cards' | 'timeline' | 'tree'>('cards');
  const [selected, setSelected] = useState<string | null>(null), [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const node = tree.nodes.find(node => node.id === selected);
  return <div className="space-y-2">
    <div className="flex gap-2">{([['cards', '卡片'], ['timeline', '时间线'], ['tree', '大纲']] as const).map(([key, label]) => <Button key={key} variant={mode === key ? 'default' : 'outline'} size="sm" onClick={() => setMode(key)}>{label}</Button>)}</div>
    {mode === 'cards' ? <StoryCardView nodes={tree.nodes} selectedId={selected} hitIds={null} onSelect={setSelected} />
      : mode === 'timeline' ? <StoryTimeline nodes={tree.nodes} selectedId={selected} hitIds={null} onSelect={setSelected} />
      : <StoryTreeView forest={toForest(tree.nodes, false)} selectedId={selected} hitIds={null} showArchived={false} collapsed={collapsed}
        onSelect={setSelected} onToggleCollapse={id => setCollapsed(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
        onAddChild={() => {}} onMove={() => {}} readOnly />}
    {node && <article className="rounded border border-border p-3"><h4 className="font-medium">{node.title}</h4><MarkdownLite text={node.content} /></article>}
  </div>;
}
