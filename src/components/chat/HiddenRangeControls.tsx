import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function HiddenRangeControls({ count, onApply }: { count: number; onApply: (start: number, end: number, hidden: boolean) => void }) {
  const [start, setStart] = useState('0'), [end, setEnd] = useState(String(Math.max(0, count - 1)));
  const a = Number(start), b = Number(end);
  const valid = /^\d+$/.test(start) && /^\d+$/.test(end) && Number.isSafeInteger(a) && Number.isSafeInteger(b) && a <= b && b < count;
  return <details className="mb-3 rounded-md border border-border p-2 text-sm">
    <summary className="cursor-pointer">批量隐藏操作</summary>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input className="w-24" aria-label="隐藏范围起始楼" inputMode="numeric" value={start} onChange={event => setStart(event.target.value)} />
      <span>至</span><Input className="w-24" aria-label="隐藏范围结束楼" inputMode="numeric" value={end} onChange={event => setEnd(event.target.value)} />
      <Button variant="outline" size="sm" disabled={!valid} onClick={() => onApply(a, b, true)}>范围设为隐藏</Button>
      <Button variant="outline" size="sm" disabled={!valid} onClick={() => onApply(a, b, false)}>范围取消隐藏</Button>
      <Button variant="outline" size="sm" disabled={!count} onClick={() => onApply(0, count - 1, false)}>取消全部手动隐藏</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">楼层号从 0 开始，含两端。保留系统、OOC 和记忆插件管理的隐藏；插件隐藏请在对应记忆设置中处理。</p>
  </details>;
}
