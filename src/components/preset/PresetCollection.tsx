import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { FileText, Layers, SlidersHorizontal, Star, Braces, Paperclip } from 'lucide-react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { getPresetPresentation, presetSeriesKey } from '@/lib/preset-presentation';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { displayPresetTagLabel } from './PresetCatalogFields';

interface CollectionProps {
  items: AssetIndexEntry[]; selected: string; onSelect: (id: string) => void;
  batch: boolean; checked: string[]; onCheck: (id: string) => void; layout: 'cards' | 'table';
  groupBy?: 'none' | 'series' | 'author'; splitVersions?: boolean;
}
export function PresetCollection(props: CollectionProps) {
  useI18n();
  if (!props.groupBy || props.groupBy === 'none') return <PresetSeriesCards {...props} />;
  const groups = new Map<string, { title: string; items: AssetIndexEntry[] }>();
  for (const item of props.items) {
    const p = getPresetPresentation(item);
    const key = props.groupBy === 'series' ? presetSeriesKey(item) : p.author || '未分类作者';
    const group = groups.get(key) ?? { title: props.groupBy === 'series' ? p.series || p.displayName : (p.author ? p.author : tr("未分类作者")), items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return <div className="space-y-6">{[...groups].map(([key, group]) => <section key={key} aria-label={group.title} className="contain-section p-1 -m-1">
    <h2 className="font-serif text-sm font-semibold mb-3 border-b border-[color:var(--hairline-inner)] pb-2">{group.title}<span className="ml-2 font-sans text-xs font-normal text-muted-foreground">{tr("{{v0}} 份预设", { v0: group.items.length })}</span></h2>
    <PresetSeriesCards {...props} items={group.items} splitVersions={props.groupBy === 'series'} />
  </section>)}</div>;
}
function PresetSeriesCards({ items, selected, onSelect, batch, checked, onCheck, layout, splitVersions }: CollectionProps) {
  useI18n();
  const groups = new Map<string, AssetIndexEntry[]>();
  for (const item of items) {
    const identity = splitVersions ? item.id : presetSeriesKey(item);
    groups.set(identity, [...(groups.get(identity) ?? []), item]);
  }
  const isRow = layout === 'table';
  return <div className={isRow ? 'divide-y divide-[color:var(--hairline-inner)] rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden' : 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]'} data-preset-collection>
    {[...groups].map(([key, versions]) => {
      const item = versions.find(item => item.id === selected) ?? versions[0];
      const p = getPresetPresentation(item), active = versions.some(item => item.id === selected);
      const modelLabel = p.models.join(' / ');
      const abbreviation = p.models[0]?.slice(0, 2).toUpperCase();
      const title = p.series || p.displayName;
      const allChecked = versions.every(version => checked.includes(version.id));
      const versionLabels = versions.map(version => {
        const identity = getPresetPresentation(version);
        return [identity.version || tr("未标版本"), version.catalog?.variant].filter(Boolean).join(' · ');
      });
      return <article
        key={key}
        className={
          isRow
            ? `group relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors ${(batch ? allChecked : active) ? 'bg-[var(--brand-active-bg)]' : 'hover:bg-[var(--hover-overlay)]'}`
            : `group relative rounded-xl border transition-colors ${(batch ? allChecked : active) ? 'border-[color:var(--brand)] bg-[var(--brand-active-bg)]' : 'border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[color:var(--border-strong)]'}`
        }
        data-preset-series
      >
        <button
          type="button"
          className={`text-left min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${isRow ? 'flex flex-1 items-center gap-3 rounded-lg py-0.5' : 'w-full p-4 rounded-xl'}`}
          aria-label={`${batch ? tr("选择") : tr("查看预设")} ${p.displayName}`}
          aria-pressed={batch ? allChecked : active}
          onClick={() => { if (batch) versions.filter(version => allChecked || !checked.includes(version.id)).forEach(version => onCheck(version.id)); else onSelect(item.id); }}
        >
          <div className={`flex gap-3 ${isRow ? 'items-center min-w-0 flex-1' : 'items-start'}`}>
            <div className={`${isRow ? 'w-9 h-9 text-xs' : 'w-11 h-11 text-sm'} shrink-0 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] text-brand flex items-center justify-center font-sans font-semibold`} aria-hidden="true">
              {abbreviation || <SlidersHorizontal className="w-4 h-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className={`font-serif font-medium text-sm leading-snug ${isRow ? 'truncate' : 'line-clamp-2 break-words'} flex-1`} title={item.title}>{title}</h2>
                {versions.some(v => v.catalog?.favorite) && <Star className="w-3.5 h-3.5 text-brand fill-current shrink-0" aria-label={tr("已收藏")} />}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.author || modelLabel || tr("提示词预设")}{p.author && modelLabel ? ` · ${modelLabel}` : ''}</p>
            </div>
          </div>
          {!isRow && (
            <>
              <div className="flex gap-1.5 flex-wrap mt-3 min-h-5 text-xs">
                {(item.catalog?.tags ?? []).slice(0, 2).map(tag => <span key={tag} className="px-2 py-0.5 rounded bg-[var(--hover-overlay)] text-muted-foreground">{displayPresetTagLabel(tag.split('/').pop() ?? tag)}</span>)}
                {versions.length > 1 && <span className="flex items-center gap-1 text-muted-foreground ml-auto"><Layers className="w-3 h-3" />{tr("{{v0}} 个版本", { v0: versions.length })}</span>}
              </div>
              {item.catalog?.releaseExcerpt && <p className="line-clamp-2 text-xs mt-2 leading-relaxed"><span className="text-muted-foreground">{tr("作者说明 · ")}</span>{item.catalog.releaseExcerpt}</p>}
              {item.catalog?.noteExcerpt && <p className="line-clamp-2 text-xs text-muted-foreground mt-2 leading-relaxed">{tr("笔记 · ")}{item.catalog.noteExcerpt}</p>}
            </>
          )}
          <div className={`flex gap-3 text-xs text-muted-foreground ${isRow ? 'shrink-0 hidden sm:flex' : 'mt-3'}`} aria-label={tr("预设内容数量")}>
            <span className="inline-flex items-center gap-1" title={tr("提示词块")}><FileText className="w-3.5 h-3.5" />{item.entryCount}</span>
            {!!item.regexCount && <span className="inline-flex items-center gap-1" title={tr("内嵌正则")}><Braces className="w-3.5 h-3.5" />{tr("{{v0}} 正则", { v0: item.regexCount })}</span>}
            {!!item.scriptCount && <span>{tr("{{v0}} 脚本", { v0: item.scriptCount })}</span>}
            {!!item.packageFileCount && <span className="inline-flex items-center gap-1" title={tr("独立附件")}><Paperclip className="w-3.5 h-3.5" />{item.packageFileCount}</span>}
          </div>
        </button>
        <div className={`flex gap-1.5 flex-wrap ${isRow ? 'shrink-0 items-center' : 'border-t border-[color:var(--hairline-inner)] px-3 py-2'}`} aria-label={tr("{{v0}}的版本", { v0: title })}>
          {versions.map((version, index) => {
            const repeated = versionLabels.filter(label => label === versionLabels[index]).length > 1;
            const label = `${versionLabels[index]}${repeated ? tr(" · 文件 {{v0}}", { v0: versionLabels.slice(0, index + 1).filter(label => label === versionLabels[index]).length }) : ''}`;
            return batch ? <label key={version.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-[var(--hover-overlay)]"><Checkbox aria-label={tr("选择 {{v0}}", { v0: version.title })} checked={checked.includes(version.id)} onCheckedChange={() => onCheck(version.id)} /><span className="truncate max-w-52" title={version.title}>{label}</span></label>
              : <Button key={version.id} size="sm" variant={version.id === selected ? 'secondary' : 'ghost'} className="max-w-full text-xs px-2.5" title={version.title} onClick={() => onSelect(version.id)}><span className="truncate">{label}</span></Button>;
          })}
        </div>
      </article>;
    })}
  </div>;
}
