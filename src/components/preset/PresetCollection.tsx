import { FileText, Layers, SlidersHorizontal, Star, Braces, Paperclip } from 'lucide-react';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { getPresetPresentation, presetSeriesKey } from '@/lib/preset-presentation';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

interface CollectionProps {
  items: AssetIndexEntry[]; selected: string; onSelect: (id: string) => void;
  batch: boolean; checked: string[]; onCheck: (id: string) => void; layout: 'cards' | 'table';
  groupBy?: 'none' | 'series' | 'author'; splitVersions?: boolean;
}
export function PresetCollection(props: CollectionProps) {
  if (!props.groupBy || props.groupBy === 'none') return <PresetSeriesCards {...props} />;
  const groups = new Map<string, { title: string; items: AssetIndexEntry[] }>();
  for (const item of props.items) {
    const p = getPresetPresentation(item);
    const key = props.groupBy === 'series' ? presetSeriesKey(item) : p.author || '未分类作者';
    const group = groups.get(key) ?? { title: props.groupBy === 'series' ? p.series || p.displayName : key, items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return <div className="space-y-6">{[...groups].map(([key, group]) => <section key={key} aria-label={group.title}>
    <h2 className="text-sm font-medium mb-3 border-b border-[color:var(--border-subtle)] pb-2">{group.title}<span className="ml-2 text-xs text-muted-foreground">{group.items.length} 份预设</span></h2>
    <PresetSeriesCards {...props} items={group.items} splitVersions={props.groupBy === 'series'} />
  </section>)}</div>;
}
function PresetSeriesCards({ items, selected, onSelect, batch, checked, onCheck, layout, splitVersions }: CollectionProps) {
  const groups = new Map<string, AssetIndexEntry[]>();
  for (const item of items) {
    const identity = splitVersions ? item.id : presetSeriesKey(item);
    groups.set(identity, [...(groups.get(identity) ?? []), item]);
  }
  return <div className={layout === 'cards' ? 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]' : 'space-y-2'} data-preset-collection>
    {[...groups].map(([key, versions]) => {
      const item = versions.find(item => item.id === selected) ?? versions[0];
      const p = getPresetPresentation(item), active = versions.some(item => item.id === selected);
      const modelLabel = p.models.join(' / ');
      const abbreviation = p.models[0]?.slice(0, 2).toUpperCase();
      const title = p.series || p.displayName;
      const allChecked = versions.every(version => checked.includes(version.id));
      const versionLabels = versions.map(version => {
        const identity = getPresetPresentation(version);
        return [identity.version || '未标版本', version.catalog?.variant].filter(Boolean).join(' · ');
      });
      return <article key={key} className={`group relative rounded-xl border transition-colors ${(batch ? allChecked : active) ? 'border-[color:var(--brand)] bg-[var(--brand-active-bg)]' : 'border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[color:var(--border-strong)]'} ${layout === 'table' ? 'flex flex-wrap items-center gap-x-3' : ''}`} data-preset-series>
        <button className={`text-left min-w-0 p-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${layout === 'table' ? 'flex-1' : 'w-full'}`} aria-label={`${batch ? '选择' : '查看预设'} ${p.displayName}`} aria-pressed={batch ? allChecked : active} onClick={() => { if (batch) versions.filter(version => allChecked || !checked.includes(version.id)).forEach(version => onCheck(version.id)); else onSelect(item.id); }}>
          <div className="flex gap-3 items-start">
            <div className="w-11 h-11 shrink-0 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--hover-overlay)] text-brand flex items-center justify-center font-sans font-semibold text-sm" aria-hidden="true">{abbreviation || <SlidersHorizontal className="w-5 h-5" />}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2"><h2 className="font-medium text-sm leading-relaxed line-clamp-2 break-words flex-1" title={item.title}>{title}</h2>{versions.some(v => v.catalog?.favorite) && <Star className="w-3.5 h-3.5 mt-1 text-brand fill-current shrink-0" aria-label="已收藏" />}</div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.author || modelLabel || '提示词预设'}{p.author && modelLabel ? ` · ${modelLabel}` : ''}</p>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap mt-3 min-h-5 text-xs">
            {(item.catalog?.tags ?? []).slice(0, 2).map(tag => <span key={tag} className="px-2 py-0.5 rounded bg-[var(--hover-overlay)] text-muted-foreground">{tag.split('/').pop()}</span>)}
            {versions.length > 1 && <span className="flex items-center gap-1 text-muted-foreground ml-auto"><Layers className="w-3 h-3" />{versions.length} 个版本</span>}
          </div>
          {item.catalog?.releaseExcerpt && <p className="line-clamp-2 text-xs mt-2 leading-relaxed"><span className="text-muted-foreground">作者说明 · </span>{item.catalog.releaseExcerpt}</p>}
          {item.catalog?.noteExcerpt && <p className="line-clamp-2 text-xs text-muted-foreground mt-2 leading-relaxed">笔记 · {item.catalog.noteExcerpt}</p>}
          <div className="flex gap-3 text-xs text-muted-foreground mt-3" aria-label="预设内容数量">
            <span className="inline-flex items-center gap-1" title="提示词块"><FileText className="w-3.5 h-3.5" />{item.entryCount}</span>
            {!!item.regexCount && <span className="inline-flex items-center gap-1" title="内嵌正则"><Braces className="w-3.5 h-3.5" />{item.regexCount} 正则</span>}
            {!!item.scriptCount && <span>{item.scriptCount} 脚本</span>}
            {!!item.packageFileCount && <span className="inline-flex items-center gap-1" title="独立附件"><Paperclip className="w-3.5 h-3.5" />{item.packageFileCount}</span>}
          </div>
        </button>
        <div className={`border-t border-[color:var(--border-subtle)] px-3 py-2 flex gap-1.5 flex-wrap ${layout === 'table' ? 'w-full' : ''}`} aria-label={`${title}的版本`}>
          {versions.map((version, index) => {
            const repeated = versionLabels.filter(label => label === versionLabels[index]).length > 1;
            const label = `${versionLabels[index]}${repeated ? ` · 文件 ${versionLabels.slice(0, index + 1).filter(label => label === versionLabels[index]).length}` : ''}`;
            return batch ? <label key={version.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-[var(--hover-overlay)]"><Checkbox aria-label={`选择 ${version.title}`} checked={checked.includes(version.id)} onCheckedChange={() => onCheck(version.id)} /><span className="truncate max-w-52" title={version.title}>{label}</span></label>
              : <Button key={version.id} size="sm" variant={version.id === selected ? 'secondary' : 'ghost'} className="max-w-full text-xs" title={version.title} onClick={() => onSelect(version.id)}><span className="truncate">{label}</span></Button>;
          })}
        </div>
      </article>;
    })}
  </div>;
}
