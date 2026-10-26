import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { PresetCatalogDetails } from '@/components/preset/PresetCatalogDetails';
import { PresetDraftBoundary } from '@/components/preset/PresetDraftBoundary';
import { PresetPackageImport } from '@/components/preset/PresetPackageImport';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { listAssetIndex } from '@/lib/asset-index';
import type { AssetIndexEntry } from '@/lib/asset-index-entry';
import type { PresetCatalog } from '@/types/preset';
import { deletePreset } from '@/lib/preset-db';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { subscribeRecordChanges } from '@/lib/repo/changes';
import { presetSeriesKey } from '@/lib/preset-presentation';

export default function PresetDetail() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  return <AppLayout><DetailSession key={epoch} epoch={epoch} /></AppLayout>;
}
function DetailSession({ epoch }: { epoch: number }) {
  const { id = '' } = useParams(), navigate = useNavigate();
  const [items, setItems] = useState<AssetIndexEntry[]>([]), [error, setError] = useState('');
  const [dirty, setDirty] = useState(false), [seed, setSeed] = useState<PresetCatalog | null>(null), [deleting, setDeleting] = useState(false);
  const [importedId, setImportedId] = useState('');
  const live = useRef(true), sequence = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    try { const items = await listAssetIndex('presets'); if (live.current && epoch === getVaultEpoch() && ticket === sequence.current) { setItems(items); setError(''); } }
    catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [epoch]);
  useEffect(() => { live.current = true; void load(); const off = subscribeRecordChanges(change => { if (change.store === 'presets') void load(); }); return () => { live.current = false; off(); }; }, [load]);
  useEffect(() => { setDirty(false); }, [id]);
  useEffect(() => {
    if (seed || !importedId) return;
    setImportedId('');
    navigate(`/presets/${encodeURIComponent(importedId)}`, { replace: true });
  }, [seed, importedId, navigate]);
  const current = items.find(item => item.id === id);
  const versions = current ? items.filter(item => presetSeriesKey(item) === presetSeriesKey(current)) : [];
  return <div className="flex flex-col h-full min-h-0 min-w-0" data-preset-detail-page>
    <PresetDraftBoundary dirty={dirty || !!seed} />
    <header className="shrink-0 border-b border-[color:var(--border-subtle)] px-3 py-2 flex items-center gap-3"><Button variant="ghost" onClick={() => navigate('/presets')}><ArrowLeft className="w-4 h-4 mr-2" />返回预设库</Button><span className="text-xs text-muted-foreground truncate">系列详情</span></header>
    {error && <p role="alert">{error}<Button variant="ghost" onClick={() => void load()}>重新读取</Button></p>}
    <PresetCatalogDetails key={id} id={id} full versions={versions} onVersion={next => navigate(`/presets/${encodeURIComponent(next)}`, { replace: true })} onDirty={setDirty} onSaved={() => void load()} onEdit={next => navigate(`/preset?assetId=${encodeURIComponent(next)}&from=detail`)} onImport={setSeed} onDelete={() => setDeleting(true)} />
    {seed && <PresetPackageImport seed={seed} onClose={() => setSeed(null)} onImported={ids => { setSeed(null); void load(); if (ids[0]) setImportedId(ids[0]); }} />}
    <DeleteConfirmDialog open={deleting} onOpenChange={setDeleting} title="删除当前版本？" description="从 STE 库内移除此预设版本，已有引用将显示失效。其他版本和导出的副本保持独立。" fileTarget={{ store: 'presets', id }} onConfirm={async options => { if (epoch !== getVaultEpoch()) return false; await deletePreset(id, options); const next = versions.find(item => item.id !== id); navigate(next ? `/presets/${encodeURIComponent(next.id)}` : '/presets', { replace: true }); return true; }} />
  </div>;
}
