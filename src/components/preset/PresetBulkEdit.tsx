import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState } from 'react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { PRESET_MODELS } from '@/lib/preset-catalog';
import { getPresetTags } from '@/lib/preset-tag-values';
import { getPresetPresentation } from '@/lib/preset-presentation';
import type { PresetBulkPatch } from '@/lib/preset-bulk-patch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { displayPresetTag } from './PresetCatalogFields';

export function PresetBulkEdit({ items, allItems, tags, busy, errors, onClose, onApply }: {
  items: AssetIndexEntry[]; allItems: AssetIndexEntry[]; tags: string[]; busy: boolean; errors: string[];
  onClose: () => void; onApply: (patch: PresetBulkPatch) => void;
}) {
  useI18n();
  const [patch, setPatch] = useState<PresetBulkPatch>({ models: {}, tags: {} });
  const [authorEnabled, setAuthorEnabled] = useState(false), [seriesEnabled, setSeriesEnabled] = useState(false);
  const [author, setAuthor] = useState(''), [series, setSeries] = useState('');
  const [rows, setRows] = useState(() => Object.fromEntries(items.map(item => {
    const p = getPresetPresentation(item);
    return [item.id, { name: p.displayName, version: p.version || '' }];
  })));
  const [touchedIds, setTouchedIds] = useState<Set<string>>(() => new Set());
  const authors = [...new Set(allItems.flatMap(item => item.catalog?.author ? [item.catalog.author] : []))];
  const seriesOptions = [...new Set(allItems.flatMap(item => item.catalog?.series ? [item.catalog.series] : []))];
  const models = [...new Set([...PRESET_MODELS, ...items.flatMap(item => getPresetPresentation(item).models)])];
  const markRowChange = (id: string, field: 'name' | 'version', value: string) => {
    setTouchedIds(prev => new Set(prev).add(id));
    setRows(old => ({ ...old, [id]: { ...old[id], [field]: value } }));
  };
  const choices = (key: 'models' | 'tags', values: string[]) => <div className="flex flex-wrap gap-2">{values.map(value => {
    const count = items.filter(item => (key === 'models' ? getPresetPresentation(item).models : getPresetTags(item.catalog)).includes(value)).length;
    const selected = patch[key][value] ?? (count === items.length ? true : count > 0 ? 'indeterminate' : false);
    return <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 flex items-center gap-2 text-sm ${selected ? 'bg-[var(--brand-active-bg)] border-[color:var(--brand)]' : 'border-[color:var(--border-subtle)]'}`}><Checkbox checked={selected} onCheckedChange={checked => setPatch(old => {
      const changes = { ...old[key] };
      const category = value.split('/')[0];
      if (checked && key === 'tags' && ['状态', '评价'].includes(category)) for (const tag of values) if (tag.startsWith(`${category}/`)) changes[tag] = false;
      return { ...old, [key]: { ...changes, [value]: !!checked } };
    })} />{displayPresetTag(value)}</label>;
  })}</div>;
  const hasDirtyChanges = touchedIds.size > 0 || authorEnabled || seriesEnabled || Object.keys(patch.models).length > 0 || Object.keys(patch.tags).length > 0;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto" onInteractOutside={e => { if (hasDirtyChanges || busy) e.preventDefault(); }}>
    <DialogHeader><DialogTitle>{tr("整理 {{v0}} 份预设", { v0: items.length })}</DialogTitle><DialogDescription>{tr("点选模型和标签即可添加或移除。横线表示部分预设拥有；未改动的条目保持原样。")}</DialogDescription></DialogHeader>
    <fieldset disabled={busy} className="space-y-5 min-w-0">
      <section className="space-y-2"><h3 className="text-sm font-medium">{tr("预处理名称与版本")}</h3><p className="text-xs text-muted-foreground">{tr("仅写回实际改过的版本行；填作者不会强制把不同预设并成同一系列。")}</p>
        {items.map(item => <div key={item.id} className="grid grid-cols-2 gap-2 rounded-lg border p-3"><p className="col-span-2 text-xs text-muted-foreground truncate" title={item.title}>{item.title}</p><label className="text-xs space-y-1">{tr("预设名称")}<Input aria-label={tr("名称 {{v0}}", { v0: item.title })} value={rows[item.id]?.name || ''} onChange={e => markRowChange(item.id, 'name', e.target.value)} /></label><label className="text-xs space-y-1">{tr("版本号")}<Input aria-label={tr("版本号 {{v0}}", { v0: item.title })} value={rows[item.id]?.version || ''} onChange={e => markRowChange(item.id, 'version', e.target.value)} /></label></div>)}
      </section>
      <section className="space-y-2"><h3 className="text-sm font-medium">{tr("适配模型")}</h3>{choices('models', models)}</section>
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={authorEnabled} onCheckedChange={v => setAuthorEnabled(!!v)} />{tr("统一作者")}</label><Input aria-label={tr("批量作者")} disabled={!authorEnabled} list="preset-bulk-authors" placeholder={tr("选择已有作者或输入新作者")} value={author} onChange={e => setAuthor(e.target.value)} /><datalist id="preset-bulk-authors">{authors.map(a => <option key={a} value={a} />)}</datalist></div>
        <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={seriesEnabled} onCheckedChange={v => setSeriesEnabled(!!v)} />{tr("统一系列")}</label><Input aria-label={tr("批量系列")} disabled={!seriesEnabled} list="preset-bulk-series" placeholder={tr("如 斯拉预设 / 小猫之神（留空清除）")} value={series} onChange={e => setSeries(e.target.value)} /><datalist id="preset-bulk-series">{seriesOptions.map(a => <option key={a} value={a} />)}</datalist></div>
      </section>
      <section className="space-y-2"><h3 className="text-sm font-medium">{tr("标签")}</h3>{tags.length ? choices('tags', tags) : <p className="text-sm text-muted-foreground">{tr("先在左侧标签管理中添加标签。")}</p>}</section>
    </fieldset>
    {!!errors.length && <div role="alert" className="text-sm text-destructive max-h-32 overflow-auto">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    <Button
      disabled={busy || !items.length || (touchedIds.size === 0 && !authorEnabled && !seriesEnabled && !Object.keys(patch.models).length && !Object.keys(patch.tags).length)}
      onClick={() => onApply({
        ...patch,
        ...(touchedIds.size > 0 ? { items: Object.fromEntries([...touchedIds].map(id => [id, rows[id]])) } : {}),
        ...(authorEnabled ? { author } : {}),
        ...(seriesEnabled ? { series } : {}),
      })}
    >
      {busy ? tr("保存中…") : tr("保存到所选预设")}
    </Button>
  </DialogContent></Dialog>;
}
