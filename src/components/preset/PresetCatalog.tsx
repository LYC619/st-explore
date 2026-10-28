import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, Star, LayoutGrid, List, CheckSquare, SlidersHorizontal, Eye, Tags, Trash2 } from 'lucide-react';
import type { PresetCatalog as Catalog } from '@/types/preset';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { listCharacterIndex } from '@/lib/archive-index';
import { deletePreset, updatePreset } from '@/lib/preset-db';
import { getPresetTags } from '@/lib/preset-tag-values';
import { normalizePresetCatalog, PRESET_MODELS } from '@/lib/preset-catalog';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { scopedKey } from '@/lib/vault/vault-scope';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { PresetBulkEdit, applyPresetBulkPatch, type PresetBulkPatch } from './PresetBulkEdit';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { getPresetPresentation, presetSeriesKey } from '@/lib/preset-presentation';
import { defaultPresetTags, getPresetTagOptions, loadPresetTags, presetTagParts } from '@/lib/preset-tags';
import { PresetTagManager } from './PresetTagManager';
import { PresetCollection } from './PresetCollection';
import { PresetCatalogDetails } from './PresetCatalogDetails';
import { PresetPackageImport } from './PresetPackageImport';
import { catalogSelectClass } from './PresetCatalogFields';
import { PresetDiscardDialog, PresetDraftBoundary } from './PresetDraftBoundary';

interface ViewState {
  groupBy: 'none' | 'series' | 'author'; query: string; author: string; model: string; tag: string; preview: boolean;
  source: string; referenced: string; favorite: boolean; onlyDiy: boolean; selected: string; layout: 'table' | 'cards'; sort: 'version' | 'updated'; scroll: number;
}
const initialView: ViewState = { groupBy: 'none', query: '', author: '', model: '', tag: '', preview: false, source: '', referenced: '', favorite: false, onlyDiy: false, selected: '', layout: 'cards', sort: 'version', scroll: 0 };
function readView(key: string): ViewState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '{}') as Partial<ViewState>;
    const view = { ...initialView };
    for (const key of ['query', 'author', 'model', 'tag', 'source', 'referenced', 'selected'] as const) {
      const value = saved[key]; if (typeof value === 'string') view[key] = value;
    }
    view.groupBy = saved.groupBy === 'series' || saved.groupBy === 'author' ? saved.groupBy : 'none';
    view.favorite = saved.favorite === true;
    view.preview = saved.preview === true;
    view.layout = saved.layout === 'table' ? 'table' : 'cards';
    view.sort = saved.sort === 'updated' ? 'updated' : 'version';
    view.onlyDiy = saved.onlyDiy === true;
    view.scroll = typeof saved.scroll === 'number' && Number.isFinite(saved.scroll) ? saved.scroll : 0;
    return view;
  } catch { return initialView; }
}

export function PresetCatalog({ mode = 'manage' }: { mode?: 'manage' | 'select' }) {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  return <CatalogSession key={epoch} mode={mode} epoch={epoch} />;
}

function CatalogSession({ mode, epoch }: { mode: 'manage' | 'select'; epoch: number }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('presetId') ?? '';
  const seenRequestedId = useRef(requestedId);
  const storageKey = useRef(scopedKey('preset-catalog-view-v2')).current;
  const [view, setView] = useState<ViewState>(() => ({ ...readView(storageKey), ...(params.get('presetId') ? { selected: params.get('presetId')!, preview: true } : {}) }));
  const [items, setItems] = useState<AssetIndexEntry[]>([]);
  const [references, setReferences] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false), [detailRevision, setDetailRevision] = useState(0);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [importSeed, setImportSeed] = useState<Catalog | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagPreferences, setTagPreferences] = useState(defaultPresetTags);
  const onlyDiy = view.onlyDiy;
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false), [busy, setBusy] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null), restored = useRef(false), sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(view)); } catch { /* Optional UI preference. */ } }, [storageKey, view]);
  useEffect(() => {
    if (seenRequestedId.current === requestedId) return;
    seenRequestedId.current = requestedId;
    if (requestedId === view.selected) return;
    const chooseRequested = () => { setDirty(false); setView(value => ({ ...value, selected: requestedId, preview: !!requestedId })); };
    if (dirty) setPending(() => chooseRequested);
    else chooseRequested();
  }, [requestedId, dirty, view.selected]);
  const syncSelectionUrl = (id: string) => {
    seenRequestedId.current = id;
    setParams(current => { const next = new URLSearchParams(current); if (id) next.set('presetId', id); else next.delete('presetId'); return next; }, { replace: true });
  };
  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const [assets, characters, tags] = await Promise.all([listAssetIndex('presets'), listCharacterIndex().catch(() => null), loadPresetTags()]);
      if (!mounted.current || ticket !== sequence.current || epoch !== getVaultEpoch()) return;
      setItems(assets); setTagPreferences(tags); setError('');
      const visibleTags = getPresetTagOptions(tags, assets.flatMap(item => getPresetTags(item.catalog))).filter(tag => !tags.hidden.includes(tag));
      setView(view => ({ ...view, ...(view.tag && !visibleTags.includes(view.tag) ? { tag: '', scroll: 0 } : {}),
        ...(view.selected && !assets.some(item => item.id === view.selected) ? { selected: '' } : {}) }));
      const refs: Record<string, string[]> = {};
      for (const character of characters ?? []) for (const ref of character.assets ?? []) (refs[ref.assetId] ??= []).push(character.name);
      setReferences(characters ? refs : null);
    } catch (e) { if (mounted.current && ticket === sequence.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current && ticket === sequence.current) setLoading(false); }
  }, [epoch]);
  useEffect(() => {
    void load();
    return subscribeRecordChanges(change => { if (change.store === 'presets' || change.store === 'characters' || change.store === 'archiveMeta') void load(); });
  }, [load]);
  useEffect(() => {
    if (!loading && scrollRef.current && !restored.current) { scrollRef.current.scrollTop = view.scroll; restored.current = true; }
  }, [loading, view.scroll]);
  const changeView = (patch: Partial<ViewState>) => { setView(value => ({ ...value, ...patch, scroll: 0 })); setChecked([]); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const request = (action: () => void) => { if (dirty) setPending(() => action); else action(); };
  const select = (id: string) => { if (id && !view.preview && mode !== 'select') { request(() => navigate(`/presets/${encodeURIComponent(id)}`)); return; } if (id === view.selected) id = ''; request(() => { setDirty(false); setView(value => ({ ...value, selected: id })); syncSelectionUrl(id); }); };
  const edit = (id: string) => navigate(`/preset?assetId=${encodeURIComponent(id)}&from=${mode === 'manage' ? 'library' : 'catalog'}`);
  const options = useMemo(() => ({
    authors: [...new Set(items.flatMap(item => item.catalog?.author ? [item.catalog.author] : []))].sort(),
    models: [...new Set([...PRESET_MODELS, ...items.flatMap(item => getPresetPresentation(item).models)])],
    tags: getPresetTagOptions(tagPreferences, items.flatMap(item => getPresetTags(item.catalog))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  }), [items, tagPreferences]);
  const filtered = useMemo(() => items.filter(item => {
    const c = item.catalog ?? {}, identity = getPresetPresentation(item);
    const text = [identity.displayName, item.title, c.releaseExcerpt, identity.author, identity.series, identity.version, c.variant, c.noteExcerpt, ...identity.models, ...(c.tags ?? []), ...identity.purposes, ...(c.representativeCards ?? [])].join(' ').toLocaleLowerCase();
    return (!view.query || text.includes(view.query.trim().toLocaleLowerCase())) && (!view.author || (c.author || '未分类作者') === view.author)
      && (!view.model || (view.model === '__unlabeled__' ? !identity.models.length : identity.models.includes(view.model)))
      && (!view.tag || getPresetTags(c).includes(view.tag))
      && (!onlyDiy || !!c.originId || item.source === 'derived' || /DIY/i.test(c.variant ?? '')) && (!view.favorite || c.favorite) && (!view.source || item.source === view.source)
      && (!view.referenced || !references || (view.referenced === 'yes' ? !!references[item.id]?.length : !references[item.id]?.length));
  }).sort((a, b) => {
    const pa = getPresetPresentation(a), pb = getPresetPresentation(b);
    return view.sort === 'updated' ? Math.max(b.updatedAt, b.catalog?.updatedAt ?? 0) - Math.max(a.updatedAt, a.catalog?.updatedAt ?? 0)
      : (pa.series || pa.displayName).localeCompare(pb.series || pb.displayName, 'zh-CN', { numeric: true })
      || (pb.version ?? '').localeCompare(pa.version ?? '', 'zh-CN', { numeric: true });
  }), [items, references, view, onlyDiy]);
  const filterCount = [view.author, view.model, view.tag].filter(Boolean).length;
  const selected = items.find(item => item.id === view.selected);
  const applyBulk = async (patch: PresetBulkPatch) => {
    if (busy) return;
    setBusy(true); setBulkErrors([]);
    const failures: string[] = [], failedIds: string[] = [];
    for (const id of checked) {
      try {
        if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，剩余修改已停止');
        await updatePreset(id, latest => {
          const catalog = applyPresetBulkPatch({ ...latest.catalog, tags: getPresetTags(latest.catalog), ...(Object.keys(patch.models).length ? { models: getPresetPresentation(latest).models } : {}) }, patch);
          return { ...latest, autoSaved: false, catalog: normalizePresetCatalog({ ...catalog, ...patch.items?.[id], updatedAt: Date.now() }) };
        });
      } catch (e) { failedIds.push(id); failures.push(`${items.find(item => item.id === id)?.title ?? id}：${e instanceof Error ? e.message : String(e)}`); }
    }
    if (!mounted.current || epoch !== getVaultEpoch()) return;
    setBusy(false); setChecked(failedIds); setBulkErrors(failures); setDetailRevision(n => n + 1);
    if (!failures.length) setBulkOpen(false);
    void load();
  };
  return <div className="flex flex-col h-full min-h-0 min-w-0 px-4 py-4 md:px-6 gap-4" data-preset-catalog>
    <PresetDraftBoundary dirty={dirty || !!importSeed || bulkOpen} />
    <header className="flex flex-wrap items-center gap-3 shrink-0" data-preset-toolbar>
      <div className="flex items-baseline gap-2 shrink-0"><h1 className="font-serif text-xl font-semibold">预设库</h1>{!loading && <span className="text-xs text-muted-foreground">{items.length} 份</span>}</div>
        <div className="flex flex-wrap gap-2 items-center flex-1 min-w-0">
          <div className="flex items-center rounded-lg bg-[var(--hover-overlay)] p-1 gap-0.5" aria-label="预设收藏范围">
            <Button size="sm" variant={!view.favorite && !onlyDiy ? 'secondary' : 'ghost'} aria-pressed={!view.favorite && !onlyDiy} onClick={() => changeView({ favorite: false, onlyDiy: false })}>全部</Button>
            <Button size="sm" variant={view.favorite ? 'secondary' : 'ghost'} aria-pressed={view.favorite} onClick={() => changeView({ favorite: true, onlyDiy: false })}><Star className="w-3.5 h-3.5 mr-1" />收藏</Button>
            <Button size="sm" variant={onlyDiy ? 'secondary' : 'ghost'} aria-pressed={onlyDiy} onClick={() => changeView({ favorite: false, onlyDiy: true })}>我的 DIY</Button>
          </div>
          <div className="relative min-w-40 flex-1"><Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" /><Input aria-label="搜索预设" className="pl-9" placeholder="搜索名称、作者、说明…" value={view.query} onChange={e => changeView({ query: e.target.value })} /></div>
          <Button variant={view.preview ? 'secondary' : 'outline'} aria-pressed={view.preview} onClick={() => request(() => { changeView({ preview: !view.preview, selected: '' }); syncSelectionUrl(''); })}><Eye className="w-3.5 h-3.5 mr-1" />预览</Button>
          <Button variant={batchMode ? 'secondary' : 'outline'} onClick={() => request(() => { setBatchMode(value => !value); setChecked([]); changeView({ selected: '' }); syncSelectionUrl(''); })}><CheckSquare className="w-3.5 h-3.5 mr-1" />{batchMode ? '完成' : '批量管理'}</Button>
        </div>
      <Button onClick={() => request(() => setImportSeed({ author: view.author === '未分类作者' ? '' : view.author }))}><Download className="w-4 h-4 mr-1.5" />导入预设</Button>
    </header>
    <div className="flex flex-1 min-h-0 min-w-0 gap-4">
      <aside aria-label="预设筛选" className={`hidden md:flex w-44 xl:w-48 shrink-0 flex-col gap-5 overflow-y-auto pr-2 pb-3`}>
        <section className="space-y-1"><h2 className="text-xs text-muted-foreground px-3 mb-2">适配模型</h2>
          {['', ...options.models, '__unlabeled__'].map(model => <button key={model} aria-pressed={view.model === model} className={`w-full min-h-9 rounded-lg px-3 text-sm flex items-center text-left gap-2 ${view.model === model ? 'bg-[var(--brand-active-bg)] text-brand' : 'hover:bg-[var(--hover-overlay)] text-muted-foreground'}`} onClick={() => changeView({ model: model === view.model ? '' : model })}><span className="flex-1 truncate">{model === '__unlabeled__' ? '未标记' : model || '全部模型'}</span><span className="text-xs opacity-70">{items.filter(item => !model || (model === '__unlabeled__' ? !getPresetPresentation(item).models.length : getPresetPresentation(item).models.includes(model))).length}</span></button>)}
        </section>
        <section className="space-y-1 border-t border-[color:var(--border-subtle)] pt-4"><div className="flex items-center justify-between px-3 mb-2"><h2 className="text-xs text-muted-foreground">标签</h2><Button size="icon" variant="ghost" aria-label="管理预设标签" onClick={() => setTagsOpen(true)}><Tags className="w-3.5 h-3.5" /></Button></div>
          <button className={`w-full text-left rounded-lg min-h-9 px-3 text-sm ${!view.tag ? 'text-brand bg-[var(--brand-active-bg)]' : 'text-muted-foreground'}`} onClick={() => changeView({ tag: '' })}>全部标签</button>
          {[...new Set([...tagPreferences.categories, ...options.tags.map(tag => presetTagParts(tag).category)])].map(category => <details key={category} open className="pt-2"><summary className="cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">{category}</summary><div className="flex flex-wrap gap-1 p-1">
            {options.tags.filter(tag => presetTagParts(tag).category === category && !tagPreferences.hidden.includes(tag)).map(tag => <button key={tag} title={tag} aria-pressed={view.tag === tag} className={`max-w-full flex items-center gap-2 text-left rounded-lg min-h-8 px-2 text-xs ${view.tag === tag ? 'text-brand bg-[var(--brand-active-bg)]' : 'hover:bg-[var(--hover-overlay)] text-muted-foreground'}`} onClick={() => changeView({ tag: tag === view.tag ? '' : tag })}><span className="truncate">{presetTagParts(tag).label}</span><span className="opacity-60">{items.filter(item => getPresetTags(item.catalog).includes(tag)).length}</span></button>)}
          </div></details>)}
          {!options.tags.length && <p className="px-3 text-xs text-muted-foreground leading-relaxed">用标签整理自己的预设收藏。</p>}
        </section>
      </aside>
      <main className="flex-1 flex flex-col min-h-0 min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
          <select aria-label="筛选模型" className={`${catalogSelectClass} md:hidden max-w-36`} value={view.model} onChange={e => changeView({ model: e.target.value })}><option value="">全部模型</option>{options.models.map(value => <option key={value}>{value}</option>)}<option value="__unlabeled__">未标记</option></select>
          <select aria-label="筛选标签" className={`${catalogSelectClass} md:hidden max-w-36`} value={view.tag} onChange={e => changeView({ tag: e.target.value })}><option value="">全部标签</option>{options.tags.filter(tag => !tagPreferences.hidden.includes(tag)).map(value => <option key={value}>{value}</option>)}</select>
          <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setTagsOpen(true)}>管理标签</Button>
          <span className="text-muted-foreground">{new Set(filtered.map(presetSeriesKey)).size} 个系列 · {filtered.length} 份预设</span>
          {!!filterCount && <Button size="sm" variant="ghost" onClick={() => changeView({ author: '', model: '', tag: '' })}>清除筛选</Button>}
          <span className="flex-1" />
          <select aria-label="预设分组" className={catalogSelectClass} value={view.groupBy} onChange={e => changeView({ groupBy: e.target.value as ViewState['groupBy'] })}><option value="none">不分组</option><option value="series">按系列分组</option><option value="author">按作者分组</option></select>
          <select aria-label="预设排序" className={`${catalogSelectClass} border-0 bg-transparent text-xs max-w-32`} value={view.sort} onChange={e => changeView({ sort: e.target.value as ViewState['sort'] })}><option value="version">系列与版本</option><option value="updated">最近更新</option></select>
          <Button variant="ghost" size="icon" aria-label={view.layout === 'cards' ? '切换列表' : '切换卡片'} onClick={() => changeView({ layout: view.layout === 'cards' ? 'table' : 'cards' })}>{view.layout === 'cards' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}</Button>
        </div>
        {batchMode && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--brand-active-bg)] px-3 py-2 text-xs shrink-0"><label className="flex items-center gap-2"><Checkbox aria-label="选择当前筛选结果" checked={!!filtered.length && filtered.every(item => checked.includes(item.id))} onCheckedChange={value => setChecked(value ? filtered.map(item => item.id) : [])} />全选当前结果</label><span>已选 {checked.length} 份 · 点击卡片选择系列</span><Button size="sm" variant="outline" disabled={!checked.length || dirty} onClick={() => { setBulkOpen(true); setBulkErrors([]); }}>整理所选</Button><Button size="sm" variant="outline" disabled={!checked.length || busy} onClick={() => request(() => setDeleteIds([...checked]))}><Trash2 className="w-3.5 h-3.5 mr-1" />删除所选</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" onClick={() => void load()}>重新读取</Button></p>}
    <div className={`flex-1 min-h-0 grid gap-4 ${view.selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]' : ''}`}>
      <div ref={scrollRef} className={`min-h-0 overflow-y-auto pb-3 pr-1 ${view.selected ? 'hidden xl:block' : ''}`} onScroll={e => { const scroll = e.currentTarget.scrollTop; setView(value => ({ ...value, scroll })); }}>
        {loading ? <p className="p-8 text-sm text-center text-muted-foreground">正在读取预设库…</p> : !error && !filtered.length ? <div className="py-16 text-center space-y-3"><SlidersHorizontal className="w-10 h-10 mx-auto text-muted-foreground" /><h2 className="text-base">{items.length ? '没有符合条件的预设' : '先收藏一份喜欢的预设'}</h2><p className="text-sm text-muted-foreground">{items.length ? '试试其他关键词，或清除筛选。' : '选择作者的 JSON 和配套文件，模型与版本会先帮你识别。'}</p><Button variant="outline" onClick={() => items.length ? changeView({ ...initialView, selected: view.selected }) : setImportSeed({})}>{items.length ? '清除筛选' : '导入预设'}</Button></div> : null}
        <PresetCollection items={filtered} selected={view.selected} onSelect={select} batch={batchMode} checked={checked} onCheck={id => setChecked(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} layout={view.layout} groupBy={view.groupBy} />
      </div>
      {view.selected && <aside className="min-h-0 flex flex-col rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden" aria-label="预设资料">
        {!loading && !selected ? <p className="p-4 text-sm">当前预设已不存在，请选择其他预设。</p> : <PresetCatalogDetails key={`${view.selected}:${detailRevision}`} id={view.selected} versions={items.filter(item => selected && presetSeriesKey(item) === presetSeriesKey(selected))} onOpenFull={() => request(() => navigate(`/presets/${encodeURIComponent(view.selected)}`))} onClose={() => select('')} onDirty={setDirty} onEdit={id => request(() => edit(id))} onImport={seed => request(() => setImportSeed(seed))} onSaved={() => void load()} onDelete={() => request(() => setDeleteId(view.selected))} />}
      </aside>}
    </div>
      </main>
    </div>
    {importSeed && <PresetPackageImport seed={importSeed} onClose={() => setImportSeed(null)} onImported={ids => { void load(); if (ids[0]) { setView(value => ({ ...value, preview: true, selected: ids[0] })); syncSelectionUrl(ids[0]); } }} />}
    <PresetDiscardDialog open={!!pending} cancel={() => { setPending(null); if (requestedId !== view.selected) syncSelectionUrl(view.selected); }} discard={() => { const action = pending; setPending(null); setDirty(false); setDetailRevision(n => n + 1); action?.(); }} />
    {bulkOpen && <PresetBulkEdit items={items.filter(item => checked.includes(item.id))} allItems={items} tags={options.tags} busy={busy} errors={bulkErrors} onClose={() => setBulkOpen(false)} onApply={patch => void applyBulk(patch)} />}
    {tagsOpen && <PresetTagManager preferences={tagPreferences} items={items} onClose={() => setTagsOpen(false)} onChanged={() => void load()} />}
    <DeleteConfirmDialog open={!!deleteIds.length} title={`删除 ${deleteIds.length} 份预设？`} description="所选版本会从预设库移除，已有引用会显示失效。可同时删除 STE 库内文件。" fileTargets={deleteIds.map(id => ({ store: 'presets', id }))} onOpenChange={open => { if (!open) setDeleteIds([]); }} onConfirm={async options => {
      const failures: string[] = [], removed: string[] = [];
      for (const id of deleteIds) {
        try { if (epoch !== getVaultEpoch()) throw new Error('资料库已切换'); await deletePreset(id, options); removed.push(id); }
        catch (e) { failures.push(`${items.find(item => item.id === id)?.title || id}：${e instanceof Error ? e.message : String(e)}`); }
      }
      if (epoch !== getVaultEpoch()) return false;
      setChecked(ids => ids.filter(id => !removed.includes(id))); setDeleteIds(ids => ids.filter(id => !removed.includes(id)));
      if (removed.includes(view.selected)) { setDirty(false); setView(value => ({ ...value, selected: '' })); syncSelectionUrl(''); }
      await load();
      if (failures.length) throw new Error(failures.join('\n'));
      return true;
    }} />
    <DeleteConfirmDialog open={!!deleteId} title="删除预设？" description={`预设会从库内移除。${references && deleteId ? `当前被 ${references[deleteId]?.length ?? 0} 张角色卡引用。` : '角色引用信息未知。'}已有引用在删除后会显示失效；已导出的取用副本独立保留。`} onOpenChange={open => { if (!open) setDeleteId(null); }} fileTarget={deleteId ? { store: 'presets', id: deleteId } : undefined} onConfirm={async options => {
      if (!deleteId || epoch !== getVaultEpoch()) return false;
      await deletePreset(deleteId, options); if (view.selected === deleteId) syncSelectionUrl(''); setDirty(false); setView(value => ({ ...value, selected: value.selected === deleteId ? '' : value.selected })); setChecked(ids => ids.filter(id => id !== deleteId)); void load(); return true;
    }} />
  </div>;
}
