import { useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StoryCardView } from '@/components/story-tree/StoryCardView';
import { StoryTimeline } from '@/components/story-tree/StoryTimeline';
import { StoryTreeView } from '@/components/story-tree/StoryTreeView';
import { MarkdownLite } from '@/components/MarkdownLite';
import { toForest } from '@/lib/story-tree-model';
import type { StoryNode, StoryTree } from '@/types/story-tree';

function extractNodeFloorHint(node: StoryNode): number | null {
  const source = `${node.title}\n${node.hint ?? ''}\n${node.content ?? ''}`;
  const match =
    source.match(/(?:#|第\s*)?(\d{1,5})\s*(?:[-\u2013~～]\s*\d+\s*)?楼/) ??
    source.match(/(?:#|第\s*)(\d{1,5})\b/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function StoryTreePreview({
  tree,
  onJumpToFloor,
}: {
  tree: StoryTree;
  onJumpToFloor?: (floor: number) => void;
}) {
  const [mode, setMode] = useState<'cards' | 'timeline' | 'tree'>('cards');
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const node = tree.nodes.find((n) => n.id === selected);
  const floorHint = node ? extractNodeFloorHint(node) : null;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {([['cards', '卡片'], ['timeline', '时间线'], ['tree', '大纲']] as const).map(([key, label]) => (
          <Button
            key={key}
            variant={mode === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {mode === 'cards' ? (
        <StoryCardView nodes={tree.nodes} selectedId={selected} hitIds={null} onSelect={setSelected} />
      ) : mode === 'timeline' ? (
        <StoryTimeline nodes={tree.nodes} selectedId={selected} hitIds={null} onSelect={setSelected} />
      ) : (
        <StoryTreeView
          forest={toForest(tree.nodes, false)}
          selectedId={selected}
          hitIds={null}
          showArchived={false}
          collapsed={collapsed}
          onSelect={setSelected}
          onToggleCollapse={(id) =>
            setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onAddChild={() => {}}
          onMove={() => {}}
          readOnly
        />
      )}
      {node && (
        <article className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm">{node.title}</h4>
            {onJumpToFloor && floorHint !== null && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => onJumpToFloor(floorHint)}
              >
                <LocateFixed className="h-3 w-3" />
                跳到 #{floorHint} 楼
              </Button>
            )}
          </div>
          <MarkdownLite text={node.content} />
        </article>
      )}
    </div>
  );
}
