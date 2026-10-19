import { useEffect, useState, useSyncExternalStore } from 'react';
import { FolderOpen, Loader2, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { cleanupVaultFiles, scanVaultFiles, type FileCleanupResult, type FileMaintenanceScan, type MaintenanceCategory } from '@/lib/vault/file-maintenance';
import { formatBytes } from '@/lib/storage-utils';

const labels: Record<MaintenanceCategory, string> = {
  retained: '删除时保留的文件', unreferenced: '确认失去引用的受管理文件', unknown: '无法确认归属的文件（仅查看）', 'empty-directory': '空目录',
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function FileMaintenancePanel() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const vault = getActiveVault();
  const [scan, setScan] = useState<FileMaintenanceScan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FileCleanupResult>();
  useEffect(() => { setScan(undefined); setSelected(new Set()); setConfirm(false); setResult(undefined); setError(''); }, [epoch]);
  if (!vault) return null;
  const current = scan?.vault === vault && scan.epoch === epoch;
  const selectedEntries = current ? scan.entries.filter(entry => selected.has(entry.path)) : [];
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + entry.size, 0);
  async function inspect() {
    if (!vault) return;
    setBusy(true); setError(''); setResult(undefined); setSelected(new Set());
    try {
      const next = await scanVaultFiles(vault);
      if (getVaultEpoch() === epoch && getActiveVault() === vault) setScan(next);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  async function clean() {
    if (!scan || !current) return;
    setBusy(true); setError(''); setConfirm(false);
    try {
      const outcome = await cleanupVaultFiles(scan, [...selected]);
      if (getVaultEpoch() !== epoch || getActiveVault() !== vault) return;
      setResult(outcome); setSelected(new Set());
      setScan(await scanVaultFiles(vault!));
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="文件检查与清理">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-medium">文件检查与清理</h3><p className="mt-1 text-xs text-muted-foreground">检查当前 STE 文件库中的保留文件、未引用的受管理文件和未知内容。</p></div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void inspect()}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}检查文件</Button>
    </div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {current && <>
      <p className="text-xs text-muted-foreground">检查结果共 {scan.entries.length} 项，占用 {formatBytes(scan.bytes)}。有效的未绑定记录、独立资产和备份不会自动清理。</p>
      {!scan.complete && <div role="alert" className="space-y-1 rounded-md border border-destructive/30 p-3 text-xs text-destructive"><p>检查未完成，已禁用清理。请处理以下问题后重新检查：</p>{scan.errors.map((text, index) => <p key={index} className="break-all">{text}</p>)}</div>}
      {(Object.keys(labels) as MaintenanceCategory[]).map(category => {
        const entries = scan.entries.filter(entry => entry.category === category);
        if (!entries.length) return null;
        return <details key={category} open={category !== 'unknown'} className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">{labels[category]} · {entries.length} 项 · {formatBytes(entries.reduce((sum, entry) => sum + entry.size, 0))}</summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{entries.map(entry => <div key={entry.path} className="flex items-start gap-2 rounded p-1">
            <Checkbox aria-label={`选择 ${entry.path}`} disabled={busy || !entry.selectable} checked={selected.has(entry.path)} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked) next.add(entry.path); else next.delete(entry.path); return next; })} />
            <div className="min-w-0 flex-1 text-xs"><p className="break-all">{entry.path}</p><p className="mt-0.5 break-all text-muted-foreground">{formatBytes(entry.size)} · {entry.reason}</p></div>
            {vault.fs.openPath && <Button size="icon" variant="ghost" className="shrink-0" aria-label={`定位 ${entry.path}`} onClick={() => void vault.fs.openPath!(entry.path, true).catch(error => setError(message(error)))}><FolderOpen className="h-3.5 w-3.5" /></Button>}
          </div>)}</div>
        </details>;
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy || !scan.complete} onClick={() => setSelected(new Set(scan.entries.filter(entry => entry.selectable).map(entry => entry.path)))}>选择可清理项</Button>
        <Button size="sm" variant="destructive" disabled={busy || !scan.complete || !selectedEntries.length} onClick={() => setConfirm(true)}><Trash2 className="mr-1.5 h-4 w-4" />清理已选 {selectedEntries.length} 项（{formatBytes(selectedBytes)}）</Button>
      </div>
    </>}
    {result && <div className="space-y-1 text-xs" role="status"><p>成功 {result.removed.length} 项，跳过 {result.skipped.length} 项，失败 {result.failed.length} 项；已移出库内 {formatBytes(result.bytes)}。</p>{result.usesTrash && result.removed.length > 0 && <p className="text-muted-foreground">文件已送入系统回收站；清空回收站后才会释放磁盘空间。</p>}{[...result.skipped, ...result.failed].map(item => <p key={item.path} className="break-all text-muted-foreground">{item.path}：{item.reason}</p>)}</div>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>清理所选文件？</AlertDialogTitle><AlertDialogDescription>将清理 {selectedEntries.length} 项，共 {formatBytes(selectedBytes)}。{vault.fs.trashFile ? '文件会移入系统回收站。' : '当前平台不支持系统回收站，文件将永久删除，无法撤销。'}执行前会重新检查文件与引用；发生变化的项目会跳过。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void clean()}>确认清理</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
