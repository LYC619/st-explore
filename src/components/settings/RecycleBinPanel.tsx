import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { listRetainedOperations, recycleExpiryLabel, restoreRetainedOperation, type RetainedOperation } from '@/lib/vault/file-maintenance';

const STORE_LABELS: Record<string, string> = {
  characters: '角色', archiveStories: '故事', cards: '卡片', worldbooks: '世界书', presets: '预设', regexes: '正则',
  summaries: '总结/日记', stories: '故事树', summaryTemplates: '总结模板', ratingTemplates: '评分模板',
};

export function RecycleBinPanel() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch), vault = getActiveVault();
  const [items, setItems] = useState<RetainedOperation[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setItems(null); setError(''); }, [epoch]);
  if (!vault) return null;
  async function load() {
    setBusy(true); setError('');
    try { const next = await listRetainedOperations(vault!); if (epoch === getVaultEpoch()) setItems(next); }
    catch { setError('回收站读取失败，请重试。'); }
    finally { setBusy(false); }
  }
  async function restore(item: RetainedOperation) {
    setBusy(true); setError('');
    try { await restoreRetainedOperation(vault!, item.operationId); const next = await listRetainedOperations(vault!); if (epoch === getVaultEpoch()) setItems(next); }
    catch (e) { setError(e instanceof Error ? e.message : '恢复失败，请重试'); }
    finally { setBusy(false); }
  }
  return <section aria-label="库内回收站" className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">库内回收站</h3><p className="mt-1 text-sm text-muted-foreground">查看已移出的文件，恢复到原位置。重名时停止，不覆盖现有内容。</p></div>
      <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? '处理中…' : items ? '刷新回收站' : '查看回收站'}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {items && <div className="max-h-96 overflow-y-auto space-y-3">{!items.length && <p role="status">回收站为空</p>}{items.map(item => <div key={item.operationId} className="rounded-lg border p-3">
      <p className="break-all text-sm font-medium">{STORE_LABELS[item.store] && <span className="mr-1 text-muted-foreground">{STORE_LABELS[item.store]} ·</span>}{item.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{item.paths.length} 个文件 · {(item.bytes / 1024).toFixed(1)} KB · {item.createdAt ? new Date(item.createdAt).toLocaleString() : '时间未知'} · {recycleExpiryLabel(item.recycleAfter)}</p>
      <details className="mt-2 text-sm"><summary className="cursor-pointer">查看文件清单</summary>{item.paths.map(p => <p className="break-all py-1" key={p}>{p}</p>)}</details>
      {item.issue && <p className="text-sm text-muted-foreground">{item.issue}</p>}
      <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy || !item.restorable} onClick={() => void restore(item)}>恢复到原位置</Button>
        {vault.fs.openPath && <Button variant="ghost" className="min-h-11" onClick={() => void vault.fs.openPath!(`.ste/retained/${item.operationId}/files`).catch(() => setError('无法打开回收文件夹'))}>打开文件夹</Button>}</div>
    </div>)}</div>}
    <p className="text-xs text-muted-foreground">仅恢复本项文件；删除时已解除绑定的故事或记录仍保留原来的独立归属。</p>
  </section>;
}
