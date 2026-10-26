import { useState } from 'react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import type { PresetCatalog } from '@/types/preset';
import { PRESET_MODELS } from '@/lib/preset-catalog';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface PresetBulkPatch {
  author?: string; series?: string;
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
    next[key] = [...values];
    if (key === 'models') next.modelsConfirmed = true;
  }
  return next;
}

export function PresetBulkEdit({ items, allItems, tags, busy, errors, onClose, onApply }: {
  items: AssetIndexEntry[]; allItems: AssetIndexEntry[]; tags: string[]; busy: boolean; errors: string[];
  onClose: () => void; onApply: (patch: PresetBulkPatch) => void;
}) {
  const [patch, setPatch] = useState<PresetBulkPatch>({ models: {}, tags: {} });
  const [authorEnabled, setAuthorEnabled] = useState(false), [seriesEnabled, setSeriesEnabled] = useState(false);
  const [author, setAuthor] = useState(''), [series, setSeries] = useState('');
  const authors = [...new Set(allItems.flatMap(item => item.catalog?.author ? [item.catalog.author] : []))];
  const seriesOptions = [...new Set(allItems.flatMap(item => item.catalog?.series ? [item.catalog.series] : []))];
  const models = [...new Set([...PRESET_MODELS, ...items.flatMap(item => getPresetPresentation(item).models)])];
  const choices = (key: 'models' | 'tags', values: string[]) => <div className="flex flex-wrap gap-2">{values.map(value => {
    const count = items.filter(item => (key === 'models' ? getPresetPresentation(item).models : item.catalog?.tags)?.includes(value)).length;
    const selected = patch[key][value] ?? (count === items.length ? true : count > 0 ? 'indeterminate' : false);
    return <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 flex items-center gap-2 text-sm ${selected ? 'bg-[var(--brand-active-bg)] border-[color:var(--brand)]' : 'border-[color:var(--border-subtle)]'}`}><Checkbox checked={selected} onCheckedChange={checked => setPatch(old => ({ ...old, [key]: { ...old[key], [value]: !!checked } }))} />{value}</label>;
  })}</div>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
    <DialogHeader><DialogTitle>整理 {items.length} 份预设</DialogTitle><DialogDescription>点选模型和标签即可添加或移除。横线表示部分预设拥有；未操作的内容保持原样。</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="space-y-5 min-w-0">
      <section className="space-y-2"><h3 className="text-sm font-medium">适配模型</h3>{choices('models', models)}</section>
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={authorEnabled} onCheckedChange={v => setAuthorEnabled(!!v)} />统一作者</label><Input aria-label="批量作者" disabled={!authorEnabled} list="preset-bulk-authors" placeholder="选择已有作者或输入新作者" value={author} onChange={e => setAuthor(e.target.value)} /><datalist id="preset-bulk-authors">{authors.map(a => <option key={a} value={a} />)}</datalist></div>
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={seriesEnabled} onCheckedChange={v => setSeriesEnabled(!!v)} />统一系列</label><Input aria-label="批量系列" disabled={!seriesEnabled} list="preset-bulk-series" placeholder="默认跟随作者，也可自定义" value={series} onChange={e => setSeries(e.target.value)} /><datalist id="preset-bulk-series">{seriesOptions.map(a => <option key={a} value={a} />)}</datalist></div>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-medium">标签</h3>{tags.length ? choices('tags', tags) : <p className="text-sm text-muted-foreground">先在左侧标签管理中添加标签。</p>}</section>
    </fieldset>
    {!!errors.length && <div role="alert" className="text-sm text-destructive max-h-32 overflow-auto">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    <Button disabled={busy || !items.length || (!authorEnabled && !seriesEnabled && !Object.keys(patch.models).length && !Object.keys(patch.tags).length)} onClick={() => onApply({ ...patch, ...(authorEnabled ? { author } : {}), ...(seriesEnabled ? { series } : {}) })}>{busy ? '保存中…' : '保存到所选预设'}</Button>
  </DialogContent></Dialog>;
}
