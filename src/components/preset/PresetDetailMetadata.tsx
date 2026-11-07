import { useEffect, useState } from 'react';
import { defaultPresetTags, getPresetTagOptions, loadPresetTags } from '@/lib/preset-tags';
import { Plus, X, ExternalLink } from 'lucide-react';
import type { PresetCatalog } from '@/types/preset';
import { PRESET_RATING_TAGS, catalogWithTags, getPresetTags } from '@/lib/preset-tag-values';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { catalogSelectClass } from './PresetCatalogFields';

export function PresetDetailMetadata({ value, onChange, modelDraft, onModelDraft, addModels, tagDraft, onTagDraft, addTags, onOpenSource, inferredModels }: {
  value: PresetCatalog; onChange: (value: PresetCatalog) => void;
  modelDraft: string; onModelDraft: (text: string) => void; addModels: () => void;
  tagDraft: string; onTagDraft: (text: string) => void; addTags: () => void; onOpenSource: () => void; inferredModels?: boolean;
}) {
  const [preferences, setPreferences] = useState(defaultPresetTags);
  useEffect(() => { let active = true; void loadPresetTags().then(value => { if (active) setPreferences(value); }).catch(() => {}); return () => { active = false; }; }, []);
  const available = getPresetTagOptions(preferences, getPresetTags(value));
  const set = (patch: Partial<PresetCatalog>) => onChange({ ...value, ...patch });
  const tags = getPresetTags(value), ordinaryTags = tags.filter(tag => !/^(评价|状态)\//.test(tag));
  const section = 'space-y-2 border-t border-[color:var(--border-subtle)] pt-4';
  const inputClass = 'text-base md:text-xs bg-[var(--hover-overlay)] border-[color:var(--border-subtle)]';
  return <div className="space-y-4 text-xs" data-preset-metadata>
    <label className="block space-y-2">名称<Input size="sm" aria-label="名称" className={inputClass} value={value.name ?? ''} onChange={event => set({ name: event.target.value })} placeholder="预设名称" /></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="block space-y-2 min-w-0">作者<Input size="sm" aria-label="作者" className={inputClass} value={value.author ?? ''} placeholder="选填" onChange={event => set({ author: event.target.value, ...(!value.series || value.series === value.author ? { series: event.target.value } : {}) })} /></label>
      <label className="block space-y-2 min-w-0">系列<Input size="sm" aria-label="系列" className={inputClass} value={value.series ?? ''} placeholder="默认同作者" onChange={event => set({ series: event.target.value })} /></label>
    </div>
    <section className={section} aria-label="预设评价"><p>评价</p><div className="grid grid-cols-3 gap-1">{PRESET_RATING_TAGS.filter(tag => available.includes(tag)).map(tag => <Button key={tag} size="sm" variant={tags.includes(tag) ? 'secondary' : 'outline'} className="text-xs min-w-0 px-1" aria-pressed={tags.includes(tag)} onClick={() => onChange(catalogWithTags(value, tags.includes(tag) ? tags.filter(current => current !== tag) : [...tags.filter(current => !current.startsWith('评价/')), tag]))}>{tag.slice(3)}</Button>)}</div></section>
    <section className={section} aria-label="预设适配型号"><p>适配模型</p>
      <div className="flex flex-wrap gap-1.5">{(value.models ?? []).map(model => <span key={model} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--hover-overlay)] border border-[color:var(--border-subtle)] px-2 py-1"><span className="truncate" title={model}>{model}</span><button type="button" className="shrink-0 rounded-full p-0.5 hover:bg-[var(--brand-active-bg)]" aria-label={`移除适配型号 ${model}`} onClick={() => set({ models: value.models?.filter(current => current !== model), modelsConfirmed: true })}><X className="w-3 h-3" /></button></span>)}</div>
      <div className="flex gap-1"><Input size="sm" aria-label="适配模型" className={`${inputClass} min-w-0`} value={modelDraft} placeholder="填写型号，回车添加" onChange={event => onModelDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addModels(); } }} /><Button variant="outline" size="icon" className="shrink-0" disabled={!modelDraft.trim()} aria-label="添加适配型号" onClick={addModels}><Plus className="w-3.5 h-3.5" /></Button></div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{inferredModels ? '型号来自文件线索，可修改后保存确认。' : '如 gemini3.1、gemini3.8，多个型号用逗号分隔。'}</p>
    </section>
    <section className={section} aria-label="预设标签"><p>标签</p><div className="flex flex-wrap gap-1.5">{ordinaryTags.map(tag => <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] px-2 py-1"><span className="truncate" title={tag}>{tag.includes('/') ? tag.split('/').slice(1).join('/') : tag}</span><button type="button" aria-label={`移除预设标签 ${tag}`} className="shrink-0 p-0.5 rounded-full hover:bg-[var(--brand-active-bg)]" onClick={() => onChange(catalogWithTags(value, tags.filter(current => current !== tag)))}><X className="w-3 h-3" /></button></span>)}</div>
      <div className="flex gap-1"><Input size="sm" aria-label="添加预设标签" className={`${inputClass} min-w-0`} value={tagDraft} placeholder="添加标签" onChange={event => onTagDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTags(); } }} /><Button variant="outline" size="icon" className="shrink-0" disabled={!tagDraft.trim()} aria-label="添加标签" onClick={addTags}><Plus className="w-3.5 h-3.5" /></Button></div>
    </section>
    <section className={section}><label className="block space-y-2">来源链接<div className="flex gap-1"><Input size="sm" aria-label="来源链接" className={`${inputClass} min-w-0`} value={value.sourceUrl ?? ''} onChange={event => set({ sourceUrl: event.target.value })} placeholder="作者发布页地址" /><Button variant="ghost" size="icon" className="shrink-0" aria-label="打开发布网址" disabled={!value.sourceUrl} onClick={onOpenSource}><ExternalLink className="w-3.5 h-3.5" /></Button></div></label></section>
    <details className={section}><summary className="cursor-pointer min-h-7 text-muted-foreground">版本与使用状态</summary><div className="pt-2 space-y-3">
      <label className="block space-y-1.5">版本号<Input size="sm" aria-label="版本号" className={inputClass} value={value.version ?? ''} placeholder="如 v2.1" onChange={event => set({ version: event.target.value })} /></label>
      <label className="block space-y-1.5">状态<select aria-label="预设状态" className={`${catalogSelectClass} w-full`} value={tags.find(tag => tag.startsWith('状态/')) || ''} onChange={event => onChange(catalogWithTags(value, [...tags.filter(tag => !tag.startsWith('状态/')), ...(event.target.value ? [event.target.value] : [])]))}><option value="">待整理</option>{['状态/在用','状态/备用','状态/过期'].filter(tag => available.includes(tag)).map(tag => <option key={tag} value={tag}>{tag.slice(3)}</option>)}</select></label>
    </div></details>
  </div>;
}
