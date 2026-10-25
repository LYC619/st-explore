import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, Star, X } from 'lucide-react';
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
import { PresetCatalogDetails } from './PresetCatalogDetails';
import { PresetPackageImport } from './PresetPackageImport';
import { catalogSelectClass } from './PresetCatalogFields';
import { PresetDiscardDialog, PresetDraftBoundary } from './PresetDraftBoundary';

interface ViewState {
  query: string; author: string; model: string; purpose: string; tag: string; status: string;
  source: string; referenced: string; favorite: boolean; selected: string; layout: 'table' | 'cards'; sort: 'version' | 'updated'; group: 'author' | 'model'; scroll: number;
}
const initialView: ViewState = { query: '', author: '', model: '', purpose: '', tag: '', status: 'current', source: '', referenced: '', favorite: false, selected: '', layout: 'table', sort: 'version', group: 'author', scroll: 0 };
const sourceLabels: Record<string, string> = { fromST: '来自 ST', manual: '手动入库', derived: '角色派生', autoSaved: '自动保留' };
function readView(key: string): ViewState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '{}') as Partial<ViewState>;
    const view = { ...initialView };
    for (const key of ['query', 'author', 'model', 'purpose', 'tag', 'status', 'source', 'referenced', 'selected'] as const) {
      const value = saved[key]; if (typeof value === 'string') view[key] = value;
    }
    view.favorite = saved.favorite === true;
    view.layout = saved.layout === 'cards' ? 'cards' : 'table';
    view.sort = saved.sort === 'updated' ? 'updated' : 'version';
    view.group = saved.group === 'model' ? 'model' : 'author';
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
  const [params] = useSearchParams();
  const storageKey = useRef(scopedKey('preset-catalog-view')).current;
  const [view, setView] = useState<ViewState>(() => ({ ...readView(storageKey), ...(params.get('presetId') ? { selected: params.get('presetId')! } : {}) }));
  const [items, setItems] = useState<AssetIndexEntry[]>([]);
  const [references, setReferences] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false), [detailRevision, setDetailRevision] = useState(0);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [importSeed, setImportSeed] = useState<Catalog | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false), [busy, setBusy] = useState(false);
  const [bulkField, setBulkField] = useState('tags'), [bulkMode, setBulkMode] = useState('add'), [bulkText, setBulkText] = useState('');
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null), restored = useRef(false), sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(view)); } catch { /* Optional UI preference. */ } }, [storageKey, view]);
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
  const edit = (id: string) => navigate(`/preset?assetId=${encodeURIComponent(id)}&from=${mode === 'manage' ? 'library' : 'catalog'}`);
  const options = useMemo(() => {
    const values = (key: 'models' | 'purposes' | 'tags') => [...new Set(items.flatMap(item => item.catalog?.[key] ?? []))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return { authors: [...new Set(items.map(item => item.catalog?.author || '未分类作者'))].sort(), models: values('models'), purposes: values('purposes'), tags: values('tags') };
  }, [items]);
  const filtered = useMemo(() => items.filter(item => {
    const c = item.catalog ?? {};
    const text = [item.title, c.author, c.series, c.version, c.variant, c.noteExcerpt, ...(c.models ?? []), ...(c.tags ?? []), ...(c.purposes ?? []), ...(c.representativeCards ?? [])].join(' ').toLocaleLowerCase();
    return (!view.query || text.includes(view.query.trim().toLocaleLowerCase())) && (!view.author || (c.author || '未分类作者') === view.author)
      && (!view.model || (view.model === '__unlabeled__' ? !c.models?.length : c.models?.includes(view.model))) && (!view.purpose || c.purposes?.includes(view.purpose))
      && (!view.tag || c.tags?.includes(view.tag)) && (!view.status || (view.status === 'current' ? c.status !== 'retired' : (c.status ?? 'unreviewed') === view.status))
      && (!view.favorite || c.favorite) && (!view.source || item.source === view.source)
      && (!view.referenced || !references || (view.referenced === 'yes' ? !!references[item.id]?.length : !references[item.id]?.length));
  }).sort((a, b) => {
    const group = `${a.catalog?.author || '未分类作者'} / ${a.catalog?.series || a.title}`.localeCompare(`${b.catalog?.author || '未分类作者'} / ${b.catalog?.series || b.title}`, 'zh-CN', { numeric: true });
    return group || (view.sort === 'version' ? (b.catalog?.version ?? '').localeCompare(a.catalog?.version ?? '', 'zh-CN', { numeric: true }) : 0)
      || Math.max(b.updatedAt, b.catalog?.updatedAt ?? 0) - Math.max(a.updatedAt, a.catalog?.updatedAt ?? 0);
  }), [items, references, view]);
  const grouped = useMemo(() => filtered.flatMap(item => (view.group === 'model'
    ? item.catalog?.models?.length ? item.catalog.models : ['未标模型']
    : [`${item.catalog?.author || '未分类作者'} / ${item.catalog?.series || item.title}`])
    .map(group => ({ item, group }))).sort((a, b) => a.group.localeCompare(b.group, 'zh-CN', { numeric: true })), [filtered, view.group]);
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
  const row = (item: AssetIndexEntry) => {
    const c = item.catalog ?? {};
    return <>
      <Checkbox aria-label={`选择 ${item.title}`} checked={checked.includes(item.id)} onCheckedChange={value => setChecked(ids => value ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
      <button className="min-w-0 flex-1 text-left min-h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded" onClick={() => request(() => { setDirty(false); setView(value => ({ ...value, selected: item.id })); })}>
        <span className="flex gap-1 items-center text-sm font-medium break-words">{c.favorite && <Star className="w-3.5 h-3.5 shrink-0" />}<span>{item.title}</span></span>
        <span className="text-xs text-muted-foreground">{c.version || '未标版本'}{c.variant && ` · ${c.variant}`} · {c.models?.join(' / ') || '未标模型'} · {PRESET_STATUS_LABELS[c.status ?? 'unreviewed']}</span>
        {view.layout === 'cards' && <span className="block text-xs text-muted-foreground mt-1">{c.noteExcerpt || `${item.entryCount} 个提示词 · ${item.packageFileCount ?? 0} 个附件`}</span>}
      </button>
      <span className="text-xs text-muted-foreground shrink-0">{references ? (references[item.id]?.length ? `${references[item.id].length} 卡引用` : '未引用') : '引用未知'}</span>
    </>;
  };
  const selectItem = (item: AssetIndexEntry) => request(() => { setDirty(false); setView(value => ({ ...value, selected: item.id })); });
  return <div className="flex flex-col h-full min-h-0 min-w-0 p-4 gap-3" data-preset-catalog>
    <PresetDraftBoundary dirty={dirty || !!importSeed || bulkOpen} />
    <div className="flex items-center gap-2 flex-wrap"><h1 className="text-lg font-semibold flex-1">{mode === 'select' ? '选择预设进行编辑' : '预设库'}</h1>
      <Button onClick={() => request(() => setImportSeed({ author: view.author === '未分类作者' ? '' : view.author }))}><Download className="w-4 h-4 mr-1" />导入作者预设</Button></div>
    <div className="flex flex-wrap gap-2">
      <div className="relative min-w-48 flex-1"><Search className="absolute left-2 top-2 w-4 h-4 text-muted-foreground" /><Input aria-label="搜索预设" className="pl-8" placeholder="名称、作者、系列、版本、模型或标签" value={view.query} onChange={e => changeView({ query: e.target.value })} /></div>
      {(['author', 'model', 'purpose', 'tag'] as const).map((key, index) => {
        const label = ['作者', '模型', '用途', '标签'][index], values = [options.authors, options.models, options.purposes, options.tags][index];
        return <select key={key} aria-label={`筛选${label}`} className={`${catalogSelectClass} max-w-44`} value={view[key]} onChange={e => changeView({ [key]: e.target.value })}><option value="">全部{label}</option>{key === 'model' && <option value="__unlabeled__">未标模型</option>}{values.map(value => <option key={value}>{value}</option>)}</select>;
      })}
      <select aria-label="筛选状态" className={catalogSelectClass} value={view.status} onChange={e => changeView({ status: e.target.value })}><option value="current">未停用</option><option value="">全部状态</option>{Object.entries(PRESET_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <Button variant={view.favorite ? 'secondary' : 'outline'} aria-pressed={view.favorite} onClick={() => changeView({ favorite: !view.favorite })}>只看收藏</Button>
    </div>
    <div className="flex flex-wrap gap-2 items-center text-xs">
      <select aria-label="筛选来源" className={catalogSelectClass} value={view.source} onChange={e => changeView({ source: e.target.value })}><option value="">全部来源</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="筛选引用" disabled={!references} className={catalogSelectClass} value={view.referenced} onChange={e => changeView({ referenced: e.target.value })}><option value="">全部引用状态</option><option value="yes">已被角色引用</option><option value="no">未被角色引用</option></select>
      <select aria-label="系列内排序" className={catalogSelectClass} value={view.sort} onChange={e => changeView({ sort: e.target.value as ViewState['sort'] })}><option value="version">系列内按版本倒序</option><option value="updated">系列内按最近修改</option></select>
      <Button variant="ghost" onClick={() => changeView({ ...initialView, status: '', selected: view.selected, layout: view.layout, group: view.group })}>清除筛选</Button>
      <span className="flex-1" />
      <Button variant="outline" onClick={() => setView(value => ({ ...value, layout: value.layout === 'table' ? 'cards' : 'table' }))}>{view.layout === 'table' ? '切换卡片' : '切换表格'}</Button>
      <span>{loading ? '读取中…' : `${filtered.length} / ${items.length} 份`}{view.status === 'current' && !loading ? ` · 隐藏 ${items.filter(item => item.catalog?.status === 'retired').length} 份已停用` : ''}</span>
    </div>
    {error && <div role="alert" className="text-sm text-destructive">读取失败：{error} <Button variant="outline" onClick={() => void load()}>重试</Button></div>}
    {!references && !loading && <p className="text-xs text-muted-foreground">角色引用信息读取失败，引用筛选暂不可用。</p>}
    <div className="flex items-center gap-2 text-xs"><Checkbox aria-label="选择当前筛选结果" disabled={loading || !filtered.length} checked={!!filtered.length && filtered.every(item => checked.includes(item.id))} onCheckedChange={value => setChecked(value ? filtered.map(item => item.id) : [])} />选择当前结果
      <span>已选 {checked.length} 份</span><Button variant="outline" disabled={!checked.length || dirty} onClick={() => { setBulkOpen(true); setBulkErrors([]); }}>批量整理</Button>
      <select aria-label="预设分组" className={catalogSelectClass} value={view.group} onChange={e => changeView({ group: e.target.value as ViewState['group'] })}><option value="author">按作者 / 系列分组</option><option value="model">按适配模型分组</option></select></div>
    <div className={`flex-1 min-h-0 grid gap-3 ${view.selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]' : ''} overflow-y-auto xl:overflow-hidden`}>
      <div ref={scrollRef} className="min-h-48 xl:min-h-0 overflow-y-auto rounded-lg border" onScroll={e => { const scroll = e.currentTarget.scrollTop; setView(value => ({ ...value, scroll })); }}>
        {loading ? <p className="p-8 text-sm text-center text-muted-foreground">正在读取预设库…</p> : !error && !filtered.length ? <p className="p-8 text-sm text-center text-muted-foreground">{items.length ? '没有符合筛选的预设。' : '还没有预设，先导入作者的预设文件。'}</p> : null}
        {view.layout === 'table' ? <table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-[var(--surface-elevated)]"><tr>
            <th className="p-2"><span className="sr-only">选择</span></th><th className="p-2 min-w-40">名称 / 版本</th><th className="p-2 min-w-28">模型 / 用途</th><th className="p-2 min-w-20">状态</th><th className="p-2 min-w-32">自用摘要 / 引用</th>
          </tr></thead><tbody>
            {grouped.map(({ item, group }, i) => {
              const c = item.catalog ?? {}, previousGroup = grouped[i - 1]?.group;
              return <Fragment key={`${group}:${item.id}`}>
                {group !== previousGroup && <tr><th colSpan={5} className="px-3 py-2 text-xs font-medium bg-[var(--hover-overlay)]">{group}</th></tr>}
                <tr className={`border-b ${view.selected === item.id ? 'bg-[var(--brand-active-bg)]' : ''}`}>
                  <td className="p-2"><Checkbox aria-label={`选择 ${item.title}`} checked={checked.includes(item.id)} onCheckedChange={value => setChecked(ids => value ? [...ids, item.id] : ids.filter(id => id !== item.id))} /></td>
                  <td className="p-2"><button className="min-h-8 text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded" onClick={() => selectItem(item)}>
                    <span className="block font-medium break-words">{c.favorite ? '★ ' : ''}{item.title}</span><span className="block text-xs text-muted-foreground">{c.version || '未标版本'}{c.variant && ` · ${c.variant}`}</span>
                  </button></td>
                  <td className="p-2 text-xs"><span className="block">{c.models?.join(' / ') || '未标模型'}</span><span className="block text-muted-foreground">{c.purposes?.join(' / ')}</span></td>
                  <td className="p-2 text-xs">{PRESET_STATUS_LABELS[c.status ?? 'unreviewed']}</td>
                  <td className="p-2 text-xs"><span className="line-clamp-2">{c.noteExcerpt}</span><span className="text-muted-foreground">{references ? (references[item.id]?.length ? `${references[item.id].length} 卡引用` : '未引用') : '引用未知'} · {item.packageFileCount ?? 0} 附件</span></td>
                </tr>
              </Fragment>;
            })}
          </tbody>
        </table> : <div className="grid sm:grid-cols-2 gap-2 p-2">
          {grouped.map(({ item, group }, i) => {
            const previousGroup = grouped[i - 1]?.group;
            return <Fragment key={`${group}:${item.id}`}>
              {group !== previousGroup && <h2 className="col-span-full text-xs font-medium px-3 py-2 bg-[var(--hover-overlay)] break-words">{group}</h2>}
              <div className={`flex items-center gap-3 p-3 border-b ${view.selected === item.id ? 'bg-[var(--brand-active-bg)]' : ''} ${view.layout === 'cards' ? 'rounded border' : ''}`}>{row(item)}</div>
            </Fragment>;
          })}
        </div>}
      </div>
      {view.selected && <aside className="min-h-0 overflow-y-auto rounded-lg border bg-[var(--surface-elevated)]" aria-label="预设资料">
        <div className="flex justify-end p-1"><Button size="icon" variant="ghost" aria-label="关闭预设资料" onClick={() => request(() => { setDirty(false); setView(value => ({ ...value, selected: '' })); })}><X className="w-4 h-4" /></Button></div>
        {!loading && !selected ? <p className="p-4 text-sm">当前预设已不存在，请选择其他预设。</p> : <PresetCatalogDetails key={`${view.selected}:${detailRevision}`} id={view.selected} onDirty={setDirty} onEdit={edit} onImport={setImportSeed} onSaved={() => void load()} onDelete={() => setDeleteId(view.selected)} />}
      </aside>}
    </div>
    {importSeed && <PresetPackageImport seed={importSeed} onClose={() => setImportSeed(null)} onImported={ids => { void load(); setView(value => ({ ...value, selected: ids[0] || value.selected })); }} />}
    <PresetDiscardDialog open={!!pending} cancel={() => setPending(null)} discard={() => { const action = pending; setPending(null); setDirty(false); setDetailRevision(n => n + 1); action?.(); }} />
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
