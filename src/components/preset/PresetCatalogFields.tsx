import type { PresetCatalog } from '@/types/preset';
import { useEffect, useState } from 'react';
import { defaultPresetTags, getPresetTagOptions, loadPresetTags } from '@/lib/preset-tags';
import { catalogWithTags, getPresetTags } from '@/lib/preset-tag-values';
import { PRESET_MODELS } from '@/lib/preset-catalog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export const catalogSelectClass = 'ste-select h-8 min-w-0 text-xs';

/** Common values are chosen with one click; uncommon fields stay folded. */
export function PresetCatalogFields({ value, onChange, compact = false, multiple = false }: {
  value: PresetCatalog; onChange: (value: PresetCatalog) => void; compact?: boolean; multiple?: boolean;
}) {
  const set = (patch: Partial<PresetCatalog>) => onChange({ ...value, ...patch });
  const [preferences, setPreferences] = useState(defaultPresetTags);
  const tags = getPresetTagOptions(preferences, getPresetTags(value));
  useEffect(() => { let live = true; void loadPresetTags().then(prefs => { if (live) setPreferences(prefs); }); return () => { live = false; }; }, []);
  const choose = (key: 'models', label: string) => {
    const previous = value[key] ?? [];
    set({ [key]: previous.includes(label) ? previous.filter(item => item !== label) : [...previous, label], modelsConfirmed: true });
  };
  return <div className="space-y-4">
    {!multiple && <label className="block space-y-1 text-xs">名称<Input aria-label="名称" value={value.name ?? ''} placeholder="预设名称" onChange={e => set({ name: e.target.value })} /></label>}
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-xs min-w-0"><span>作者</span><Input aria-label="作者" value={value.author ?? ''} placeholder="选填，作者姓名" onChange={e => set({ author: e.target.value, ...(!value.series || value.series === value.author ? { series: e.target.value } : {}) })} /></label>
      <label className="space-y-1 text-xs min-w-0"><span>系列</span><Input aria-label="系列" value={value.series ?? ''} placeholder={value.author || "默认与作者相同，可自定义"} onChange={e => set({ series: e.target.value })} /></label>
      <label className="space-y-1 text-xs min-w-0"><span>版本号</span><Input aria-label="版本号" value={value.version ?? ''} placeholder="如 v2.1" onChange={e => set({ version: e.target.value })} /></label>
    </div>
    <section className="space-y-2"><p className="text-xs text-muted-foreground">同系列共享标签；过期系列不显示在内置 SillyTavern。</p>{preferences.categories.map(category => <div key={category} className="flex gap-1.5 flex-wrap items-center"><span className="text-xs mr-1">{category}</span>{tags.filter(tag => tag.startsWith(`${category}/`)).map(tag => <Button key={tag} size="sm" variant={getPresetTags(value).includes(tag) ? 'secondary' : 'outline'} aria-pressed={getPresetTags(value).includes(tag)} onClick={() => {
      const current = getPresetTags(value), selected = current.includes(tag);
      onChange(catalogWithTags(value, selected ? current.filter(t => t !== tag) : [...current.filter(t => !['状态', '评价'].includes(category) || !t.startsWith(`${category}/`)), tag]));
    }}>{tag.split('/').slice(1).join('/')}</Button>)}</div>)}</section>
    <div className="space-y-2"><p className="text-xs">适配模型</p><div className="flex gap-1.5 flex-wrap">{PRESET_MODELS.map(model => <Button key={model} size="sm" variant={value.models?.includes(model) ? 'secondary' : 'outline'} aria-pressed={!!value.models?.includes(model)} onClick={() => choose('models', model)}>{model}</Button>)}</div>
      <Input aria-label="适配模型" className="text-xs" value={(value.models ?? []).join('，')} placeholder="如 gemini3.1，gemini3.8；可填写任意型号" onChange={e => set({ models: e.target.value.split(/[,，、;；\n]/), modelsConfirmed: true })} /></div>
    <label className="block space-y-1.5 text-xs">作者发布说明<Textarea aria-label="作者发布说明" className="min-h-32 leading-relaxed" value={value.releaseNotes ?? ''} placeholder="粘贴作者说明，也可以补充 MD / TXT 附件自动读取" onChange={e => set({ releaseNotes: e.target.value })} /></label>
    {!compact && <label className="block space-y-1.5 text-xs">我的使用笔记<Textarea aria-label="我的使用笔记" className="min-h-24" value={value.notes ?? ''} onChange={e => set({ notes: e.target.value })} placeholder="自己的用法、感受和待办" /></label>}
    <details className="border-t border-[color:var(--border-subtle)] pt-2 text-xs"><summary className="min-h-8 cursor-pointer text-muted-foreground">更多资料（选填）</summary><div className="space-y-3 pt-2">
      <label className="block space-y-1">标签<Input value={(value.tags ?? []).join('，')} placeholder="自定义标签，以逗号分隔" onChange={e => set({ tags: e.target.value.split(/[,，\n]/) })} /></label>
      <label className="block space-y-1">来源链接<Input value={value.sourceUrl ?? ''} placeholder="作者发布页地址" onChange={e => set({ sourceUrl: e.target.value })} /></label>
    </div></details>
  </div>;
}
