import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { ChevronDown, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HiddenRangeControls } from './HiddenRangeControls';

export function FloorProcessingMenu({ count, hiddenCount, oocCount, showHidden, showOOC, onShowHidden, onShowOOC, onApply }: {
  count: number; hiddenCount: number; oocCount: number; showHidden: boolean; showOOC: boolean;
  onShowHidden: (value: boolean) => void; onShowOOC: (value: boolean) => void;
  onApply?: (start: number, end: number, hidden: boolean) => void;
}) {
  useI18n();
  return <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="shrink-0 gap-1.5"><Layers className="w-4 h-4" />{tr("楼层处理")}<ChevronDown className="w-3.5 h-3.5" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] space-y-3">
      <p className="text-sm font-medium">{tr("楼层显示与隐藏")}<span className="ml-2 text-xs text-muted-foreground">{tr("共 {{v0}} 楼", { v0: count })}</span></p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showHidden} onChange={e => onShowHidden(e.target.checked)} />{tr("显示已隐藏楼层（{{v0}}）", { v0: hiddenCount })}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOOC} onChange={e => onShowOOC(e.target.checked)} />{tr("显示 OOC／注释楼（{{v0}}）", { v0: oocCount })}</label>
      {onApply && <HiddenRangeControls count={count} onApply={onApply} embedded />}
      <p className="text-xs text-muted-foreground">{tr("显示开关只影响当前阅读；范围隐藏会保存到故事。")}</p>
    </PopoverContent>
  </Popover>;
}
