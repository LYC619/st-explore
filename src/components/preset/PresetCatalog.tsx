import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, Star, X, Filter, LayoutGrid, List, CheckSquare, SlidersHorizontal } from 'lucide-react';
import type { PresetCatalog as Catalog, PresetStatus } from '@/types/preset';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import { listCharacterIndex } from '@/lib/archive-index';
import { deletePreset, updatePreset } from '@/lib/preset-db';
import { normalizePresetCatalog, PRESET_STATUS_LABELS, splitCatalogLabels } from '@/lib/preset-catalog';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { scopedKey } from '@/lib/vault/vault-scope';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { getPresetPresentation } from '@/lib/preset-presentation';
import { PresetCollection } from './PresetCollection';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PresetCatalogDetails } from './PresetCatalogDetails';
import { PresetPackageImport } from './PresetPackageImport';
import { catalogSelectClass } from './PresetCatalogFields';
import { PresetDiscardDialog, PresetDraftBoundary } from './PresetDraftBoundary';

interface ViewState {
  query: string; author: string; model: string; purpose: string; tag: string; status: string;
  source: string; referenced: string; favorite: boolean; onlyDiy: boolean; selected: string; layout: 'table' | 'cards'; sort: 'version' | 'updated'; scroll: number;
}
const initialView: ViewState = { query: '', author: '', model: '', purpose: '', tag: '', status: 'current', source: '', referenced: '', favorite: false, onlyDiy: false, selected: '', layout: 'cards', sort: 'version', scroll: 0 };
const sourceLabels: Record<string, string> = { fromST: '来自 ST', manual: '手动入库', derived: '角色派生', autoSaved: '自动保留' };
function readView(key: string): ViewState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '{}') as Partial<ViewState>;
    const view = { ...initialView };
    for (const key of ['query', 'author', 'model', 'purpose', 'tag', 'status', 'source', 'referenced', 'selected'] as const) {
      const value = saved[key]; if (typeof value === 'string') view[key] = value;
    }
    view.favorite = saved.favorite === true;
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
  const [view, setView] = useState<ViewState>(() => ({ ...readView(storageKey), ...(params.get('presetId') ? { selected: params.get('presetId')! } : {}) }));
  const [items, setItems] = useState<AssetIndexEntry[]>([]);
  const [references, setReferences] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false), [detailRevision, setDetailRevision] = useState(0);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [importSeed, setImportSeed] = useState<Catalog | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const onlyDiy = view.onlyDiy;
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false), [busy, setBusy] = useState(false);
  const [bulkField, setBulkField] = useState('tags'), [bulkMode, setBulkMode] = useState('add'), [bulkText, setBulkText] = useState('');
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null), restored = useRef(false), sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(view)); } catch { /* Optional UI preference. */ } }, [storageKey, view]);
  useEffect(() => {
    if (seenRequestedId.current === requestedId) return;
    seenRequestedId.current = requestedId;
    if (requestedId === view.selected) return;
    const chooseRequested = () => { setDirty(false); setView(value => ({ ...value, selected: requestedId })); };
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
      const [assets, characters] = await Promise.all([listAssetIndex('presets'), listCharacterIndex().catch(() => null)]);
      if (!mounted.current || ticket !== sequence.current || epoch !== getVaultEpoch()) return;
      setItems(assets); setError('');
      const refs: Record<string, string[]> = {};
      for (const character of characters ?? []) for (const ref of character.assets ?? []) (refs[ref.assetId] ??= []).push(character.name);
      setReferences(characters ? refs : null);
    } catch (e) { if (mounted.current && ticket === sequence.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (mounted.current && ticket === sequence.current) setLoading(false); }
  }, [epoch]);
  useEffect(() => {
    void load();
    return subscribeRecordChanges(change => { if (change.store === 'presets' || change.store === 'characters') void load(); });
  }, [load]);
  useEffect(() => {
    if (!loading && scrollRef.current && !restored.current) { scrollRef.current.scrollTop = view.scroll; restored.current = true; }
  }, [loading, view.scroll]);
  const changeView = (patch: Partial<ViewState>) => { setView(value => ({ ...value, ...patch, scroll: 0 })); setChecked([]); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const request = (action: () => void) => { if (dirty) setPending(() => action); else action(); };
  const select = (id: string) => { if (id === view.selected) return; request(() => { setDirty(false); setView(value => ({ ...value, selected: id })); syncSelectionUrl(id); }); };
  const edit = (id: string) => navigate(`/preset?assetId=${encodeURIComponent(id)}&from=${mode === 'manage' ? 'library' : 'catalog'}`);
  const options = useMemo(() => {
    const values = (key: 'models' | 'purposes' | 'tags') => [...new Set(items.flatMap(item => key === 'tags' ? item.catalog?.tags ?? [] : getPresetPresentation(item)[key]))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { authors: [...new Set(items.map(item => item.catalog?.author || '未分类作者'))].sort(), models: values('models'), purposes: values('purposes'), tags: values('tags') };
  }, [items]);
  const filtered = useMemo(() => items.filter(item => {
    const c = item.catalog ?? {}, identity = getPresetPresentation(item);
    const text = [item.title, identity.author, identity.series, identity.version, c.variant, c.noteExcerpt, ...identity.models, ...(c.tags ?? []), ...identity.purposes, ...(c.representativeCards ?? [])].join(' ').toLocaleLowerCase();
    return (!view.query || text.includes(view.query.trim().toLocaleLowerCase())) && (!view.author || (c.author || '未分类作者') === view.author)
      && (!view.model || (view.model === '__unlabeled__' ? !identity.models.length : identity.models.includes(view.model))) && (!view.purpose || identity.purposes.includes(view.purpose))
      && (!view.tag || c.tags?.includes(view.tag)) && (!view.status || (view.status === 'current' ? c.status !== 'retired' : (c.status ?? 'unreviewed') === view.status))
      && (!onlyDiy || !!c.originId || item.source === 'derived' || /DIY/i.test(c.variant ?? '')) && (!view.favorite || c.favorite) && (!view.source || item.source === view.source)
      && (!view.referenced || !references || (view.referenced === 'yes' ? !!references[item.id]?.length : !references[item.id]?.length));
  }).sort((a, b) => {
    const pa = getPresetPresentation(a), pb = getPresetPresentation(b);
    return view.sort === 'updated' ? Math.max(b.updatedAt, b.catalog?.updatedAt ?? 0) - Math.max(a.updatedAt, a.catalog?.updatedAt ?? 0)
      : (pa.series || pa.displayName).localeCompare(pb.series || pb.displayName, 'zh-CN', { numeric: true })
      || (pb.version ?? '').localeCompare(pa.version ?? '', 'zh-CN', { numeric: true });
  }), [items, references, view, onlyDiy]);
  const filterCount = [view.author, view.model, view.purpose, view.tag, view.source, view.referenced, view.status !== 'current'].filter(Boolean).length;
  const selected = items.find(item => item.id === view.selected);
  const applyBulk = async () => {
    if (busy) return;
    setBusy(true); setBulkErrors([]);
    const failures: string[] = [], failedIds: string[] = [];
    for (const id of checked) {
      try {
        if (epoch !== getVaultEpoch()) throw new Error('资料库已切换，剩余修改已停止');
        await updatePreset(id, latest => {
          const catalog = { ...latest.catalog };
          if (bulkField === 'status') catalog.status = bulkText as PresetStatus;
          else if (bulkField === 'favorite') catalog.favorite = bulkText === 'yes';
          else if (bulkField === 'author' || bulkField === 'series') catalog[bulkField] = bulkText.trim();
          else {
            const key = bulkField as 'models' | 'purposes' | 'tags', labels = splitCatalogLabels(bulkText), old = catalog[key] ?? [];
            catalog[key] = bulkMode === 'replace' ? labels : bulkMode === 'remove' ? old.filter(value => !labels.includes(value)) : [...old, ...labels];
          }
          return { ...latest, autoSaved: false, catalog: normalizePresetCatalog({ ...catalog, updatedAt: Date.now() }) };
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
    <header className="flex items-center gap-3 shrink-0">
      <div className="rounded-xl bg-[var(--brand-active-bg)] text-brand p-2.5 hidden sm:block"><SlidersHorizontal className="w-5 h-5" /></div>
      <div className="min-w-0 flex-1"><h1 className="font-serif text-xl font-semibold">预设库</h1><p className="text-xs text-muted-foreground mt-1">{mode === 'select' ? '找到预设，再进入编辑区' : '收藏、取用，也留一份自己的版本'}{!loading && <span className="ml-3">{items.length} 份预设</span>}</p></div>
      <Button onClick={() => request(() => setImportSeed({ author: view.author === '未分类作者' ? '' : view.author }))}><Download className="w-4 h-4 mr-1.5" />导入预设</Button>
    </header>
    <div className={`${view.selected ? 'hidden xl:flex' : 'flex'} flex-wrap gap-2 items-center shrink-0`}>
      <div className="flex items-center rounded-lg bg-[var(--hover-overlay)] p-1 gap-0.5" aria-label="预设收藏范围">
        <Button size="sm" variant={!view.favorite && !onlyDiy ? 'secondary' : 'ghost'} aria-pressed={!view.favorite && !onlyDiy} onClick={() => changeView({ favorite: false, onlyDiy: false })}>全部</Button>
        <Button size="sm" variant={view.favorite ? 'secondary' : 'ghost'} aria-pressed={view.favorite} onClick={() => changeView({ favorite: true, onlyDiy: false })}><Star className="w-3.5 h-3.5 mr-1" />收藏</Button>
        <Button size="sm" variant={onlyDiy ? 'secondary' : 'ghost'} aria-pressed={onlyDiy} onClick={() => changeView({ favorite: false, onlyDiy: true })}>我的 DIY</Button>
      </div>
      <div className="relative min-w-44 flex-1"><Search className="absolute left-2.5 top-2 w-4 h-4 text-muted-foreground" /><Input aria-label="搜索预设" className="pl-9" placeholder="搜索名称、作者、模型…" value={view.query} onChange={e => changeView({ query: e.target.value })} /></div>
      <Popover open={filtersOpen} onOpenChange={setFiltersOpen}><PopoverTrigger asChild><Button variant="outline" aria-label="筛选预设"><Filter className="w-3.5 h-3.5 mr-1" />筛选{filterCount ? ` · ${filterCount}` : ''}</Button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-h-[75dvh] overflow-y-auto space-y-3">
          <div className="flex justify-between items-center"><h2 className="font-medium text-sm">筛选预设</h2><Button variant="ghost" size="sm" onClick={() => changeView({ ...initialView, layout: view.layout, selected: view.selected })}>重置</Button></div>
          {(['author', 'model', 'purpose', 'tag'] as const).map((key, index) => {
            const label = ['作者', '模型', '用途', '标签'][index], values = [options.authors, options.models, options.purposes, options.tags][index];
            return <label key={key} className="flex items-center gap-3 text-xs"><span className="w-12 shrink-0">{label}</span><select aria-label={`筛选${label}`} className={`${catalogSelectClass} flex-1`} value={view[key]} onChange={e => changeView({ [key]: e.target.value })}><option value="">全部{label}</option>{key === 'model' && <option value="__unlabeled__">未识别模型</option>}{values.map(value => <option key={value}>{value}</option>)}</select></label>;
          })}
          <label className="flex items-center gap-3 text-xs"><span className="w-12 shrink-0">状态</span><select aria-label="筛选状态" className={`${catalogSelectClass} flex-1`} value={view.status} onChange={e => changeView({ status: e.target.value })}><option value="current">未停用</option><option value="">全部状态</option>{Object.entries(PRESET_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="flex items-center gap-3 text-xs"><span className="w-12 shrink-0">来源</span><select aria-label="筛选来源" className={`${catalogSelectClass} flex-1`} value={view.source} onChange={e => changeView({ source: e.target.value })}><option value="">全部来源</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="flex items-center gap-3 text-xs"><span className="w-12 shrink-0">引用</span><select aria-label="筛选引用状态" className={`${catalogSelectClass} flex-1`} value={view.referenced} onChange={e => changeView({ referenced: e.target.value })}><option value="">全部引用状态</option><option value="yes">已被角色引用</option><option value="no">未被引用</option></select></label>
          <Button className="w-full" onClick={() => setFiltersOpen(false)}>查看 {filtered.length} 份结果</Button>
        </PopoverContent>
      </Popover>
      <Button variant={batchMode ? 'secondary' : 'outline'} onClick={() => { setBatchMode(value => !value); setChecked([]); }}><CheckSquare className="w-3.5 h-3.5 mr-1" />{batchMode ? '完成' : '批量管理'}</Button>
    </div>
    <div className={`${view.selected ? 'hidden xl:flex' : 'flex'} flex-wrap gap-2 items-center shrink-0 text-xs`}>
      <button className={`tap-target px-2 py-1 rounded-full ${!view.model ? 'text-brand bg-[var(--brand-active-bg)]' : 'text-muted-foreground'}`} onClick={() => changeView({ model: '' })}>全部模型</button>
      {options.models.slice(0, 6).map(model => <button key={model} className={`tap-target px-2 py-1 rounded-full ${view.model === model ? 'text-brand bg-[var(--brand-active-bg)]' : 'text-muted-foreground hover:bg-[var(--hover-overlay)]'}`} aria-pressed={view.model === model} onClick={() => changeView({ model: view.model === model ? '' : model })}>{model}</button>)}
      <span className="flex-1" />
      <span className="text-muted-foreground">{filtered.length} 份</span>
      <select aria-label="预设排序" className={`${catalogSelectClass} border-0 bg-transparent text-xs max-w-32`} value={view.sort} onChange={e => changeView({ sort: e.target.value as ViewState['sort'] })}><option value="version">系列与版本</option><option value="updated">最近更新</option></select>
      <Button variant="ghost" size="icon" aria-label={view.layout === 'cards' ? '切换列表' : '切换卡片'} onClick={() => changeView({ layout: view.layout === 'cards' ? 'table' : 'cards' })}>{view.layout === 'cards' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}</Button>
      {filterCount > 0 && <Button size="sm" variant="ghost" onClick={() => changeView({ ...initialView, layout: view.layout, selected: view.selected })}>清除筛选</Button>}
    </div>
    {batchMode && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--brand-active-bg)] px-3 py-2 text-xs shrink-0"><label className="flex items-center gap-2"><Checkbox aria-label="选择当前筛选结果" checked={!!filtered.length && filtered.every(item => checked.includes(item.id))} onCheckedChange={value => setChecked(value ? filtered.map(item => item.id) : [])} />全选当前结果</label><span>已选 {checked.length} 份</span><Button size="sm" variant="outline" disabled={!checked.length || dirty} onClick={() => { setBulkOpen(true); setBulkErrors([]); }}>整理所选</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" onClick={() => void load()}>重新读取</Button></p>}
    {!references && !loading && <p className="text-xs text-muted-foreground">角色引用暂未读到，可重新读取后使用引用筛选。</p>}
    <div className={`flex-1 min-h-0 grid gap-4 ${view.selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]' : ''}`}>
      <div ref={scrollRef} className={`min-h-0 overflow-y-auto pb-3 pr-1 ${view.selected ? 'hidden xl:block' : ''}`} onScroll={e => { const scroll = e.currentTarget.scrollTop; setView(value => ({ ...value, scroll })); }}>
        {loading ? <p className="p-8 text-sm text-center text-muted-foreground">正在读取预设库…</p> : !error && !filtered.length ? <div className="py-16 text-center space-y-3"><SlidersHorizontal className="w-10 h-10 mx-auto text-muted-foreground" /><h2 className="text-base">{items.length ? '没有符合条件的预设' : '先收藏一份喜欢的预设'}</h2><p className="text-sm text-muted-foreground">{items.length ? '试试其他关键词，或清除筛选。' : '选择作者的 JSON 和配套文件，模型与版本会先帮你识别。'}</p><Button variant="outline" onClick={() => items.length ? changeView({ ...initialView, selected: view.selected }) : setImportSeed({})}>{items.length ? '清除筛选' : '导入预设'}</Button></div> : null}
        <PresetCollection items={filtered} selected={view.selected} onSelect={select} batch={batchMode} checked={checked} onCheck={id => setChecked(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])} layout={view.layout} />
      </div>
      {view.selected && <aside className="min-h-0 flex flex-col rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden" aria-label="预设资料">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--border-subtle)]"><span className="text-xs text-muted-foreground">预设详情</span><Button size="icon" variant="ghost" aria-label="关闭预设资料" onClick={() => select('')}><X className="w-4 h-4" /></Button></div>
        {!loading && !selected ? <p className="p-4 text-sm">当前预设已不存在，请选择其他预设。</p> : <PresetCatalogDetails key={`${view.selected}:${detailRevision}`} id={view.selected} onDirty={setDirty} onEdit={edit} onImport={setImportSeed} onSaved={() => void load()} onDelete={() => setDeleteId(view.selected)} />}
      </aside>}
    </div>
    {importSeed && <PresetPackageImport seed={importSeed} onClose={() => setImportSeed(null)} onImported={ids => { void load(); if (ids[0]) { setView(value => ({ ...value, selected: ids[0] })); syncSelectionUrl(ids[0]); } }} />}
    <PresetDiscardDialog open={!!pending} cancel={() => { setPending(null); if (requestedId !== view.selected) syncSelectionUrl(view.selected); }} discard={() => { const action = pending; setPending(null); setDirty(false); setDetailRevision(n => n + 1); action?.(); }} />
    <Dialog open={bulkOpen} onOpenChange={open => { if (!busy) setBulkOpen(open); }}><DialogContent>
      <DialogHeader><DialogTitle>批量整理 {checked.length} 份预设</DialogTitle><DialogDescription>只修改管理资料；正文和角色当前引用保持原样。失败项会保留在选择中。</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="space-y-3 min-w-0">
        <select aria-label="批量字段" className={`${catalogSelectClass} w-full`} value={bulkField} onChange={e => { setBulkField(e.target.value); setBulkText(''); }}>
          {Object.entries({ tags: '标签', models: '适配模型', purposes: '用途', status: '状态', favorite: '收藏', author: '作者', series: '系列' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {['tags', 'models', 'purposes'].includes(bulkField) && <select aria-label="批量操作方式" className={`${catalogSelectClass} w-full`} value={bulkMode} onChange={e => setBulkMode(e.target.value)}><option value="add">追加</option><option value="remove">移除指定值</option><option value="replace">全部替换（空值为清空）</option></select>}
        {bulkField === 'status' ? <select aria-label="批量状态" className={`${catalogSelectClass} w-full`} value={bulkText} onChange={e => setBulkText(e.target.value)}><option value="" disabled>选择状态</option>{Object.entries(PRESET_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          : bulkField === 'favorite' ? <select aria-label="批量收藏" className={`${catalogSelectClass} w-full`} value={bulkText} onChange={e => setBulkText(e.target.value)}><option value="" disabled>选择操作</option><option value="yes">加入收藏</option><option value="no">取消收藏</option></select>
          : <Input aria-label="批量填写内容" placeholder={['author', 'series'].includes(bulkField) ? '替换为此内容；留空为清空' : '以逗号分隔'} value={bulkText} onChange={e => setBulkText(e.target.value)} />}
      </fieldset>
      {!!bulkErrors.length && <div role="alert" className="max-h-40 overflow-y-auto text-sm text-destructive">{bulkErrors.map(error => <p key={error}>{error}</p>)}</div>}
      <Button disabled={busy || !checked.length || (['status', 'favorite'].includes(bulkField) && !bulkText)} onClick={() => void applyBulk()}>{busy ? '保存中…' : '应用到所选预设'}</Button>
    </DialogContent></Dialog>
    <DeleteConfirmDialog open={!!deleteId} title="删除预设？" description={`预设会从库内移除。${references && deleteId ? `当前被 ${references[deleteId]?.length ?? 0} 张角色卡引用。` : '角色引用信息未知。'}已有引用在删除后会显示失效；已导出的取用副本独立保留。`} onOpenChange={open => { if (!open) setDeleteId(null); }} fileTarget={deleteId ? { store: 'presets', id: deleteId } : undefined} onConfirm={async options => {
      if (!deleteId || epoch !== getVaultEpoch()) return false;
      await deletePreset(deleteId, options); setDirty(false); setView(value => ({ ...value, selected: value.selected === deleteId ? '' : value.selected })); setChecked(ids => ids.filter(id => id !== deleteId)); void load(); return true;
    }} />
  </div>;
}
