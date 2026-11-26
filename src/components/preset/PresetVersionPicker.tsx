import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useState } from 'react';
import { ChevronDown, Plus, Check } from 'lucide-react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { comparePresetVersions, getPresetPresentation } from '@/lib/preset-presentation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export function PresetVersionPicker({ id, version, versions, onVersion, onNewVersion, disabled }: {
  id: string; version?: string; versions: AssetIndexEntry[]; onVersion?: (id: string) => void; onNewVersion: () => void; disabled?: boolean;
}) {
  useI18n();
  const [open, setOpen] = useState(false);
  const ordered = [...versions].sort((a, b) => comparePresetVersions(getPresetPresentation(b).version, getPresetPresentation(a).version) || b.createdAt - a.createdAt);
  if (versions.length <= 1) return <span aria-label={tr("当前版本")} className="shrink-0 text-xs text-muted-foreground px-2 py-1.5">{version || tr("未标版本")}</span>;
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" size="sm" variant="outline" className="shrink-0 max-w-40 gap-2 text-xs" aria-label={tr("切换预设版本，当前 {{v0}}", { v0: version || tr("未标版本") })} disabled={disabled}><span className="truncate">{version || tr("未标版本")}</span><ChevronDown className="w-3.5 h-3.5 shrink-0" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-1.5" aria-label={tr("同系列版本")}>
      <div className="max-h-[min(26rem,60dvh)] overflow-y-auto">{ordered.map(item => { const p = getPresetPresentation(item), current = item.id === id; return <button key={item.id} type="button" aria-label={tr("切换版本 {{v0}} {{v1}}", { v0: p.version || p.displayName, v1: item.title })} aria-current={current ? 'page' : undefined} disabled={disabled || current} onClick={() => { setOpen(false); onVersion?.(item.id); }} className={`w-full text-left rounded-md px-3 py-2.5 min-w-0 transition-colors ${current ? 'bg-[var(--brand-active-bg)]' : 'hover:bg-[var(--hover-overlay)]'}`}>
        <span className="flex min-w-0 items-center gap-2"><span className="text-sm font-medium truncate">{p.version || tr("未标版本")}</span>{current && <span className="inline-flex items-center gap-1 text-[11px] text-brand shrink-0"><Check className="w-3 h-3" />{tr("当前")}</span>}<span className="ml-auto text-[11px] text-muted-foreground shrink-0">{item.catalog?.publishedAt || new Date(item.createdAt).toLocaleDateString(getLocale())}</span></span>
        <span className="block text-[11px] text-muted-foreground truncate mt-1" title={item.title}>{item.catalog?.variant || (ordered.filter(other => getPresetPresentation(other).version === p.version).length > 1 ? item.title : '')}</span>
        <span className="flex gap-1 mt-1.5 flex-wrap">{p.models.slice(0, 3).map(model => <span key={model} className="max-w-24 truncate rounded-full bg-[var(--hover-overlay)] border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[11px] text-muted-foreground" title={model}>{model}</span>)}</span>
      </button>; })}</div>
      <div className="border-t border-[color:var(--border-subtle)] mt-1 pt-1"><Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2 text-xs" disabled={disabled} onClick={() => { setOpen(false); onNewVersion(); }}><Plus className="w-3.5 h-3.5" />{tr("新建版本")}</Button></div>
    </PopoverContent>
  </Popover>;
}
