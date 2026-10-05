import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { getRegexDepthRange } from '@/lib/regex-processor';
import type { RegexRule } from '@/types/chat';

type Mode = 'all' | 'recent' | 'older' | 'custom';
type DepthPatch = Pick<RegexRule, 'minDepth' | 'maxDepth'>;

export function RegexDepthEditor({ rule, onChange, readOnly = false }: { rule: RegexRule; onChange: (patch: DepthPatch) => void; readOnly?: boolean }) {
  const { minDepth, maxDepth } = getRegexDepthRange(rule);
  const inferred: Mode = (minDepth === null || minDepth < 0) ? (maxDepth === null ? 'all' : 'recent') : (maxDepth === null && minDepth > 0 ? 'older' : 'custom');
  // 保留用户选中的自定义模式，清空某个边界时不突然折叠输入框。
  const [custom, setCustom] = useState(inferred === 'custom');
  const mode = custom ? 'custom' : inferred;
  const count = mode === 'older' ? minDepth! : maxDepth !== null ? maxDepth + 1 : Math.max(minDepth ?? 1, 1);
  const changeMode = (next: Mode) => {
    setCustom(next === 'custom');
    if (next === 'all') onChange({ minDepth: null, maxDepth: null });
    if (next === 'recent') onChange({ minDepth: null, maxDepth: Math.max(count, 1) - 1 });
    if (next === 'older') onChange({ minDepth: Math.max(count, 1), maxDepth: null });
  };
  const changeBound = (field: 'minDepth' | 'maxDepth', value: string) => {
    if (value === '') { onChange({ [field]: null }); return; }
    const number = Number(value);
    if (Number.isInteger(number) && number >= (field === 'minDepth' ? -1 : 0)) onChange({ [field]: number });
  };
  return <div className="space-y-2">
    <label className="block space-y-1 text-xs"><span>楼层范围</span><select aria-label="楼层范围" className="min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={mode} disabled={readOnly} onChange={event => changeMode(event.target.value as Mode)}>
      <option value="all">全部楼层</option><option value="recent">最近 N 楼</option><option value="older">最近 N 楼以外</option><option value="custom">自定义深度</option>
    </select></label>
    {(mode === 'recent' || mode === 'older') && <label className="flex items-center gap-2 text-xs"><span className="shrink-0">最近楼层数</span><Input aria-label="最近楼层数" type="number" min={1} step={1} value={count} disabled={readOnly} onChange={event => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= 1) onChange(mode === 'recent' ? { minDepth: null, maxDepth: n - 1 } : { minDepth: n, maxDepth: null }); }} /></label>}
    {mode === 'custom' && <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs"><span>最小深度</span><Input aria-label="最小深度" type="number" min={-1} step={1} placeholder="不限" value={minDepth ?? ''} disabled={readOnly} onChange={event => changeBound('minDepth', event.target.value)} /></label>
      <label className="space-y-1 text-xs"><span>最大深度</span><Input aria-label="最大深度" type="number" min={0} step={1} placeholder="不限" value={maxDepth ?? ''} disabled={readOnly} onChange={event => changeBound('maxDepth', event.target.value)} /></label>
    </div>}
    <p className="text-xs leading-relaxed text-muted-foreground">从完整会话末尾计数，最后一楼深度为 0。最近 3 楼对应深度 0–2，不受隐藏或导出范围影响。</p>
    {minDepth !== null && maxDepth !== null && minDepth > maxDepth && <p role="alert" className="text-xs text-destructive">最小深度大于最大深度，此范围不会匹配楼层。</p>}
  </div>;
}
