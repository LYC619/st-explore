import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { SummaryItem } from '@/types/summary';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface PriorVolumesPanelProps {
  /** 当前书已有的分卷总结（按卷号升序） */
  volumes: SummaryItem[];
  /** 勾选带入上下文的卷 id */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/**
 * 分卷连贯性面板：列出当前书已有分卷，勾选的卷会作为「前情存档」带进生成上下文，
 * 让 AI 生成新一卷时知道之前发生了什么、角色卷末状态。默认全选（连贯性关键）。
 */
export function PriorVolumesPanel({ volumes, selectedIds, onChange }: PriorVolumesPanelProps) {
  useI18n();
  if (volumes.length === 0) return null;

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  return (
    <Collapsible defaultOpen>
      <Card>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/30">
          <span className="text-sm font-medium">{tr("前情连贯（带入已有分卷）")}</span>
          <span className="text-xs text-muted-foreground">{tr("已选 ")}{selectedIds.length}/{volumes.length}</span>
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
      <CardContent className="space-y-2 border-t p-4">
        <div className="flex items-center justify-end">
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(selectedIds.length === volumes.length ? [] : volumes.map((v) => v.id))}
          >
            {selectedIds.length === volumes.length ? tr("全不选") : tr("全选")}
          </button>
        </div>
        <div className="space-y-1">
          {volumes.map((v) => (
            <label key={v.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer text-sm">
              <Checkbox checked={selectedIds.includes(v.id)} onCheckedChange={() => toggle(v.id)} />
              {v.volumeNumber != null && (
                <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0">{tr("第{{v0}}卷", { v0: v.volumeNumber })}</Badge>
              )}
              <span className="truncate" title={v.title}>{v.title}</span>
              <span className="text-xs text-muted-foreground shrink-0 ml-auto">{tr("楼层 ")}{v.floorStart}~{v.floorEnd}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{tr("勾选的分卷会作为「前情」带进上下文，帮助 AI 保持跨卷连贯。")}</p>
      </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
