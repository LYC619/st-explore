import { useEffect, useMemo, useState } from 'react';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { presetOptionLabel } from '@/lib/preset-catalog';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { catalogSelectClass } from './PresetCatalogFields';

/** The selected ID stays visible when filters change, including retired/missing presets. */
export function PresetSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [items, setItems] = useState<AssetIndexEntry[]>([]), [query, setQuery] = useState(''), [model, setModel] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [showRetired, setShowRetired] = useState(false);
  useEffect(() => {
    let active = true, ticket = 0;
    const load = async () => {
      const current = ++ticket, epoch = getVaultEpoch();
      try {
        const result = await listAssetIndex('presets');
        if (active && current === ticket && epoch === getVaultEpoch()) { setItems(result); setError(''); }
      } catch (e) { if (active && current === ticket) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (active && current === ticket) setLoading(false); }
    };
    void load();
    const offChange = subscribeRecordChanges(change => { if (change.store === 'presets') void load(); });
    const offVault = subscribeActiveVault(() => { setItems([]); setQuery(''); setModel(''); setLoading(true); void load(); });
    return () => { active = false; offChange(); offVault(); };
  }, [retry]);
  const models = useMemo(() => [...new Set(items.flatMap(item => item.catalog?.models ?? []))].sort(), [items]);
  const visible = items.filter(item => item.id === value || ((showRetired || item.catalog?.status !== 'retired') && (!model || item.catalog?.models?.includes(model)) && [presetOptionLabel(item), ...(item.catalog?.tags ?? [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <div className="space-y-2">
    <div className="flex gap-2"><Input aria-label="查找挂载预设" placeholder="搜索作者、版本或模型" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="按适配模型筛选预设" className={`${catalogSelectClass} max-w-36`} value={model} onChange={e => setModel(e.target.value)}><option value="">全部模型</option>{models.map(model => <option key={model}>{model}</option>)}</select></div>
    <Select value={value ?? '__none__'} onValueChange={id => onChange(id === '__none__' ? null : id)}>
      <SelectTrigger aria-label="挂载预设"><SelectValue placeholder={loading ? '正在读取预设…' : '不挂预设（用内置骨架）'} /></SelectTrigger>
      <SelectContent><SelectItem value="__none__">不挂预设（用内置骨架）</SelectItem>
        {value && !items.some(item => item.id === value) && <SelectItem value={value} disabled>{loading ? '正在读取所选预设…' : error ? '所选预设读取失败' : '所选预设已不存在'}</SelectItem>}
        {visible.map(item => <SelectItem key={item.id} value={item.id}>{presetOptionLabel(item)}</SelectItem>)}
      </SelectContent>
    </Select>
    {items.some(item => item.catalog?.status === 'retired') && <label className="flex items-center gap-2 text-xs min-h-8"><input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />包含已停用（{items.filter(item => item.catalog?.status === 'retired').length}）</label>}
    {error && <p role="alert" className="text-xs text-destructive">预设列表读取失败 <button type="button" className="underline min-h-8" onClick={() => setRetry(n => n + 1)}>重试</button></p>}
  </div>;
}
