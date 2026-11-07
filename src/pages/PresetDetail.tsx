import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { PresetCatalogDetails } from '@/components/preset/PresetCatalogDetails';
import { PresetDiscardDialog, PresetDraftBoundary } from '@/components/preset/PresetDraftBoundary';
import { PresetPackageImport } from '@/components/preset/PresetPackageImport';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import type { PresetCatalog } from '@/types/preset';
import { deletePreset, refreshPresetFiles } from '@/lib/preset-db';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { setPendingToolFile } from '@/lib/tool-handoff';
import { presetSeriesKey } from '@/lib/preset-presentation';

export default function PresetDetail() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  return <AppLayout><DetailSession key={epoch} epoch={epoch} /></AppLayout>;
}
function DetailSession({ epoch }: { epoch: number }) {
  const { id = '' } = useParams(), navigate = useNavigate();
  const [items, setItems] = useState<AssetIndexEntry[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false), [seed, setSeed] = useState<PresetCatalog | null>(null), [deleting, setDeleting] = useState(false);
  const [importedId, setImportedId] = useState('');
  const [pending, setPending] = useState<(() => void) | null>(null), [deletedDestination, setDeletedDestination] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const live = useRef(true), sequence = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const ticket = ++sequence.current;
    try { if (refresh) await refreshPresetFiles(); const items = await listAssetIndex('presets'); if (live.current && epoch === getVaultEpoch() && ticket === sequence.current) { setItems(items); setError(''); setLoaded(true); } }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [epoch]);
  useEffect(() => { live.current = true; void load(true); const focus = () => { if (document.visibilityState !== 'hidden') void load(true); }; window.addEventListener('focus', focus); const off = subscribeRecordChanges(change => { if (change.store === 'presets') void load(); }); return () => { live.current = false; off(); window.removeEventListener('focus', focus); }; }, [load]);
  useEffect(() => { setDirty(false); }, [id]);
  useEffect(() => {
    if (seed || !importedId) return;
    setImportedId('');
    navigate(`/presets/${encodeURIComponent(importedId)}`, { replace: true });
  }, [seed, importedId, navigate]);
  useEffect(() => { if (deletedDestination && !dirty) navigate(deletedDestination, { replace: true }); }, [deletedDestination, dirty, navigate]);
  const [confirmedAction, setConfirmedAction] = useState<(() => void) | null>(null);
  useEffect(() => { if (confirmedAction && !dirty) { setConfirmedAction(null); confirmedAction(); } }, [confirmedAction, dirty]);
  const request = (action: () => void) => { if (dirty) setPending(() => action); else action(); };
  const current = items.find(item => item.id === id);
  const versions = current ? items.filter(item => presetSeriesKey(item) === presetSeriesKey(current)) : [];
  return <div className="flex flex-col h-full min-h-0 min-w-0" data-preset-detail-page>
    <PresetDraftBoundary dirty={dirty || !!seed} />
    {(!!error || (loaded && !current && !dirty)) && <header className="shrink-0 border-b border-[color:var(--border-subtle)] px-3 py-2 flex items-center gap-3"><Button variant="ghost" onClick={() => navigate('/presets')}><ArrowLeft className="w-4 h-4 mr-2" />返回预设库</Button><span className="text-xs text-muted-foreground truncate">系列详情</span></header>}
    {error && <p role="alert">{error}<Button variant="ghost" onClick={() => void load()}>重新读取</Button></p>}
    {loaded && !current && !dirty ? <div className="p-6 text-sm space-y-3"><p role="status">预设文件已不存在，已从预设库移除。</p><Button variant="outline" onClick={() => navigate('/presets')}>返回预设库</Button></div> : <PresetCatalogDetails key={`${id}:${detailRevision}`} id={id} full onBack={() => navigate('/presets')} versions={versions} onVersion={next => request(() => navigate(`/presets/${encodeURIComponent(next)}`, { replace: true }))} onDirty={setDirty} onSaved={() => void load()} onEdit={next => request(() => navigate(`/preset?assetId=${encodeURIComponent(next)}&from=detail`))} onOpenRegex={(name, text) => request(() => { setPendingToolFile('regex', new File([text], name, { type: 'application/json' })); navigate('/regex'); })} onOpenRegexAsset={assetId => request(() => navigate(`/regex?assetId=${encodeURIComponent(assetId)}`))} onImport={next => request(() => setSeed(next))} onDelete={() => setDeleting(true)} />}
    {seed && <PresetPackageImport seed={seed} onClose={() => setSeed(null)} onImported={ids => { setSeed(null); void load(); if (ids[0]) setImportedId(ids[0]); }} />}
    <PresetDiscardDialog open={!!pending} cancel={() => setPending(null)} discard={() => { const action = pending; setPending(null); setDirty(false); setDetailRevision(value => value + 1); setConfirmedAction(() => action); }} />
    <DeleteConfirmDialog open={deleting} onOpenChange={setDeleting} title="删除当前版本？" description={`从 STE 库内移除此预设版本，已有引用将显示失效。其他版本和导出的副本保持独立。${dirty ? '当前尚未保存的笔记和资料也会随此版本丢弃。' : ''}`} fileTarget={{ store: 'presets', id }} onConfirm={async options => { if (epoch !== getVaultEpoch()) return false; await deletePreset(id, options); const next = versions.find(item => item.id !== id); setDirty(false); setDeletedDestination(next ? `/presets/${encodeURIComponent(next.id)}` : '/presets'); return true; }} />
  </div>;
}
