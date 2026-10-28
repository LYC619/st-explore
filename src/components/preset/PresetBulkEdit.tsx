import { useState } from 'react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import type { PresetCatalog } from '@/types/preset';
import { PRESET_MODELS } from '@/lib/preset-catalog';
import { cleanPresetTags, getPresetTags, catalogWithTags } from '@/lib/preset-tag-values';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface PresetBulkPatch {
  author?: string; series?: string;
  items?: Record<string, { name: string; version: string }>;
  models: Record<string, boolean>; tags: Record<string, boolean>;
}
export function applyPresetBulkPatch(catalog: PresetCatalog = {}, patch: PresetBulkPatch): PresetCatalog {
  const next = { ...catalog };
  if (patch.author !== undefined) {
    next.author = patch.author.trim();
    if (!catalog.series || catalog.series === catalog.author) next.series = next.author;
  }
  if (patch.series !== undefined) next.series = patch.series.trim() || next.author;
  for (const key of ['models', 'tags'] as const) {
    if (!Object.keys(patch[key]).length) continue;
    const values = new Set(next[key] ?? []);
    for (const [value, included] of Object.entries(patch[key])) { if (included) values.add(value); else values.delete(value); }
    next[key] = key === 'tags' ? cleanPresetTags([...values]) : [...values];
    if (key === 'models') next.modelsConfirmed = true;
  }
  return Object.keys(patch.tags).length ? catalogWithTags(next, next.tags ?? []) : next;
}

export function PresetBulkEdit({ items, allItems, tags, busy, errors, onClose, onApply }: {
  items: AssetIndexEntry[]; allItems: AssetIndexEntry[]; tags: string[]; busy: boolean; errors: string[];
  onClose: () => void; onApply: (patch: PresetBulkPatch) => void;
}) {
  const [patch, setPatch] = useState<PresetBulkPatch>({ models: {}, tags: {} });
  const [authorEnabled, setAuthorEnabled] = useState(false), [seriesEnabled, setSeriesEnabled] = useState(false);
  const [author, setAuthor] = useState(''), [series, setSeries] = useState('');
  const [rows, setRows] = useState(() => Object.fromEntries(items.map(item => { const p = getPresetPresentation(item); return [item.id, { name: p.displayName, version: p.version || '' }]; })));
  const [rowsTouched, setRowsTouched] = useState(false);
  const authors = [...new Set(allItems.flatMap(item => item.catalog?.author ? [item.catalog.author] : []))];
  const seriesOptions = [...new Set(allItems.flatMap(item => item.catalog?.series ? [item.catalog.series] : []))];
  const models = [...new Set([...PRESET_MODELS, ...items.flatMap(item => getPresetPresentation(item).models)])];
  const choices = (key: 'models' | 'tags', values: string[]) => <div className="flex flex-wrap gap-2">{values.map(value => {
    const count = items.filter(item => (key === 'models' ? getPresetPresentation(item).models : getPresetTags(item.catalog)).includes(value)).length;
    const selected = patch[key][value] ?? (count === items.length ? true : count > 0 ? 'indeterminate' : false);
    return <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 flex items-center gap-2 text-sm ${selected ? 'bg-[var(--brand-active-bg)] border-[color:var(--brand)]' : 'border-[color:var(--border-subtle)]'}`}><Checkbox checked={selected} onCheckedChange={checked => setPatch(old => {
      const changes = { ...old[key] };
      const category = value.split('/')[0];
      if (checked && key === 'tags' && ['状态', '评价'].includes(category)) for (const tag of values) if (tag.startsWith(`${category}/`)) changes[tag] = false;
      return { ...old, [key]: { ...changes, [value]: !!checked } };
    })} />{value}</label>;
  })}</div>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>整理 {items.length} 份预设</DialogTitle><DialogDescription>点选模型和标签即可添加或移除。横线表示部分预设拥有；未操作的内容保持原样。</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="space-y-5 min-w-0">
      <section className="space-y-2"><h3 className="text-sm font-medium">预处理名称与版本</h3><p className="text-xs text-muted-foreground">确认各版本的名称，再选择统一系列。标签会同步到同系列的其他版本。</p>
        {items.map(item => <div key={item.id} className="grid grid-cols-2 gap-2 rounded-lg border p-3"><p className="col-span-2 text-xs text-muted-foreground truncate" title={item.title}>{item.title}</p><label className="text-xs space-y-1">预设名称<Input aria-label={`名称 ${item.title}`} value={rows[item.id]?.name || ''} onChange={e => { setRowsTouched(true); setRows(old => ({ ...old, [item.id]: { ...old[item.id], name: e.target.value } })); }} /></label><label className="text-xs space-y-1">版本号<Input aria-label={`版本号 ${item.title}`} value={rows[item.id]?.version || ''} onChange={e => { setRowsTouched(true); setRows(old => ({ ...old, [item.id]: { ...old[item.id], version: e.target.value } })); }} /></label></div>)}
      </section>
      <section className="space-y-2"><h3 className="text-sm font-medium">适配模型</h3>{choices('models', models)}</section>
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={authorEnabled} onCheckedChange={v => setAuthorEnabled(!!v)} />统一作者</label><Input aria-label="批量作者" disabled={!authorEnabled} list="preset-bulk-authors" placeholder="选择已有作者或输入新作者" value={author} onChange={e => setAuthor(e.target.value)} /><datalist id="preset-bulk-authors">{authors.map(a => <option key={a} value={a} />)}</datalist></div>
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={seriesEnabled} onCheckedChange={v => setSeriesEnabled(!!v)} />统一系列</label><Input aria-label="批量系列" disabled={!seriesEnabled} list="preset-bulk-series" placeholder="默认跟随作者，也可自定义" value={series} onChange={e => setSeries(e.target.value)} /><datalist id="preset-bulk-series">{seriesOptions.map(a => <option key={a} value={a} />)}</datalist></div>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-medium">标签</h3>{tags.length ? choices('tags', tags) : <p className="text-sm text-muted-foreground">先在左侧标签管理中添加标签。</p>}</section>
    </fieldset>
    {!!errors.length && <div role="alert" className="text-sm text-destructive max-h-32 overflow-auto">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    <Button disabled={busy || !items.length || (!rowsTouched && !authorEnabled && !seriesEnabled && !Object.keys(patch.models).length && !Object.keys(patch.tags).length)} onClick={() => onApply({ ...patch, ...(rowsTouched ? { items: rows } : {}), ...(authorEnabled ? { author } : {}), ...(seriesEnabled ? { series } : {}) })}>{busy ? '保存中…' : '保存到所选预设'}</Button>
  </DialogContent></Dialog>;
}
