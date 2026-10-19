import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { CloudDownload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { portraitCloudTasks, type PortraitCloudTask } from '@/lib/portrait-cloud-task';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';

export function PortraitCloudTaskProgress({ task }: { task: PortraitCloudTask }) {
  const busy = task.status === 'running' || task.status === 'cancelling';
  const saved = task.items.filter(item => item.status === 'saved').length;
  const skipped = task.items.filter(item => item.status === 'skipped').length;
  const failed = task.items.filter(item => item.status === 'failed' || item.status === 'cancelled');
  const processed = saved + skipped + failed.length;
  const bytes = task.items.reduce((sum, item) => sum + (item.receivedBytes ?? 0), 0);
  const totalKnown = task.items.filter(item => item.status !== 'skipped').every(item => item.totalBytes !== undefined);
  const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return <div className="space-y-2 text-sm">
    <p role="status" aria-live="polite">
      {task.status === 'running' ? '正在导入立绘' : task.status === 'cancelling' ? '正在停止，等待已开始的保存完成' : task.status === 'cancelled' ? '立绘导入已停止' : failed.length ? '立绘导入完成，部分图片未保存' : '立绘导入完成'}
      {' · '}{saved}/{task.items.length} 张已保存
      {' · '}{skipped} 跳过 · {failed.length} 未保存 · {task.items.length - processed} 待处理
    </p>
    <p className="text-xs text-muted-foreground">{task.target.characterName} · {[...new Set(task.items.map(item => item.rowTitle ?? task.target.rowTitle))].join('、')}</p>
    <progress className="h-1.5 w-full accent-primary" value={processed} max={task.items.length} aria-label="立绘保存进度" />
    <p className="text-xs text-muted-foreground">已接收 {formatBytes(bytes)} · {totalKnown ? `总大小 ${formatBytes(task.items.reduce((sum, item) => sum + (item.totalBytes ?? 0), 0))}` : '总大小未知'}</p>
    {task.reason && <p className="text-xs text-muted-foreground">{task.reason}</p>}
    {failed.length > 0 && <details className="text-xs"><summary className="cursor-pointer">查看 {failed.length} 项未保存记录</summary><ul className="mt-1 max-h-32 space-y-1 overflow-auto">{task.items.map((item, index) => (item.status === 'failed' || item.status === 'cancelled') && <li key={index} className="flex flex-wrap items-center gap-2">{item.name}：{item.error}
      {!busy && task.epoch === getVaultEpoch() && <Button variant="outline" size="sm" onClick={() => portraitCloudTasks.retry(index)}>重试此项</Button>}</li>)}</ul></details>}
    <div className="flex justify-end gap-2">
      {busy ? <Button variant="outline" size="sm" disabled={task.status === 'cancelling'} onClick={() => portraitCloudTasks.cancel()}>停止下载</Button>
        : failed.length > 0 && task.epoch === getVaultEpoch() && <Button variant="outline" size="sm" onClick={() => portraitCloudTasks.retry()}>重试未保存项</Button>}
    </div>
  </div>;
}

/** Mount inside the app router so navigation never disposes an in-progress task. */
export function PortraitCloudTasks() {
  const task = useSyncExternalStore(portraitCloudTasks.subscribe, portraitCloudTasks.getSnapshot);
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch);
  if (!task || task.epoch !== epoch) return null;
  const busy = task.status === 'running' || task.status === 'cancelling';
  return <aside aria-label="立绘下载任务" className="w-80 max-w-full shrink-0 rounded-lg border bg-background p-3 shadow-lg">
    <div className="mb-2 flex items-center gap-2 text-sm font-medium"><CloudDownload className="h-4 w-4" /><span className="flex-1">立绘下载</span><Link className="text-xs text-primary hover:underline" to={`/character/${encodeURIComponent(task.target.characterId)}`}>查看角色</Link>{!busy && <button aria-label="关闭下载状态" onClick={() => portraitCloudTasks.dismiss()}><X className="h-4 w-4" /></button>}</div>
    <PortraitCloudTaskProgress task={task} />
  </aside>;
}
