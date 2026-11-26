import { getLocale } from '@/lib/i18n';
import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { listRetainedOperations, recycleExpiryLabel, restoreRetainedOperation, type RetainedOperation } from '@/lib/vault/file-maintenance';

const STORE_LABELS: Record<string, string> = {
  get characters() { return tr("角色"); }, get archiveStories() { return tr("故事"); }, get cards() { return tr("卡片"); }, get worldbooks() { return tr("世界书"); }, get presets() { return tr("预设"); }, get regexes() { return tr("正则"); },
  get summaries() { return tr("总结/日记"); }, get stories() { return tr("故事树"); }, get summaryTemplates() { return tr("总结模板"); }, get ratingTemplates() { return tr("评分模板"); },
};

export function RecycleBinPanel() {
  useI18n();
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch), vault = getActiveVault();
  const [items, setItems] = useState<RetainedOperation[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setItems(null); setError(''); }, [epoch]);
  if (!vault) return null;
  async function load() {
    setBusy(true); setError('');
    try { const next = await listRetainedOperations(vault!); if (epoch === getVaultEpoch()) setItems(next); }
    catch { setError(tr("回收站读取失败，请重试。")); }
    finally { setBusy(false); }
  }
  async function restore(item: RetainedOperation) {
    setBusy(true); setError('');
    try { await restoreRetainedOperation(vault!, item.operationId); const next = await listRetainedOperations(vault!); if (epoch === getVaultEpoch()) setItems(next); }
    catch (e) { setError(e instanceof Error ? e.message : tr("恢复失败，请重试")); }
    finally { setBusy(false); }
  }
  return <section aria-label={tr("库内回收站")} className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{tr("库内回收站")}</h3><p className="mt-1 text-sm text-muted-foreground">{tr("查看已移出的文件，恢复到原位置。重名时停止，不覆盖现有内容。")}</p></div>
      <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void load()}>{busy ? tr("处理中…") : items ? tr("刷新回收站") : tr("查看回收站")}</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {items && <div className="max-h-96 overflow-y-auto space-y-3">{!items.length && <p role="status">{tr("回收站为空")}</p>}{items.map(item => <div key={item.operationId} className="rounded-lg border p-3">
      <p className="break-all text-sm font-medium">{STORE_LABELS[item.store] && <span className="mr-1 text-muted-foreground">{STORE_LABELS[item.store]} ·</span>}{item.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{item.paths.length}{tr(" 个文件 · ")}{(item.bytes / 1024).toFixed(1)} KB · {item.createdAt ? new Date(item.createdAt).toLocaleString(getLocale()) : tr("时间未知")} · {recycleExpiryLabel(item.recycleAfter)}</p>
      <details className="mt-2 text-sm"><summary className="cursor-pointer">{tr("查看文件清单")}</summary>{item.paths.map(p => <p className="break-all py-1" key={p}>{p}</p>)}</details>
      {item.issue && <p className="text-sm text-muted-foreground">{item.issue}</p>}
      <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy || !item.restorable} onClick={() => void restore(item)}>{tr("恢复到原位置")}</Button>
        {vault.fs.openPath && <Button variant="ghost" className="min-h-11" onClick={() => void vault.fs.openPath!(`.ste/retained/${item.operationId}/files`).catch(() => setError(tr("无法打开回收文件夹")))}>{tr("打开文件夹")}</Button>}</div>
    </div>)}</div>}
    <p className="text-xs text-muted-foreground">{tr("仅恢复本项文件；删除时已解除绑定的故事或记录仍保留原来的独立归属。")}</p>
  </section>;
}
