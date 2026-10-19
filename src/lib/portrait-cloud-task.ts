import { downloadPortrait, type PortraitLink } from '@/lib/portrait-cloud';
import { prepareImportedPortraitFile } from '@/lib/portrait-store';
import { updateCharacter, getCharacter } from '@/lib/archive-db';
import { portraitImportSource, hasPortraitSource } from '@/lib/portrait-import-identity';
import { portraitPreviewCache } from '@/lib/portrait-preview-cache';
import { getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import type { ArchiveCharacter } from '@/types/archive';

export interface PortraitCloudTarget {
  characterId: string;
  characterName: string;
  rowId: string | null;
  rowTitle: string;
}
export type PortraitCloudItemStatus = 'pending' | 'downloading' | 'saving' | 'saved' | 'skipped' | 'failed' | 'cancelled';
export interface PortraitCloudTaskItem extends PortraitLink { status: PortraitCloudItemStatus; error?: string; receivedBytes?: number; totalBytes?: number }
export interface PortraitCloudTask {
  target: PortraitCloudTarget;
  epoch: number;
  status: 'running' | 'cancelling' | 'completed' | 'cancelled';
  items: PortraitCloudTaskItem[];
  reason?: string;
}
interface TaskDependencies {
  download(link: PortraitLink, signal: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<File>;
  checkExisting?(target: PortraitCloudTarget, link: PortraitLink): Promise<boolean>;
  save(target: PortraitCloudTarget, file: File, epoch: number, signal: AbortSignal, link: PortraitLink): Promise<ArchiveCharacter | { character: ArchiveCharacter; skipped: boolean }>;
  getEpoch(): number;
  subscribeEpoch(listener: () => void): () => void;
}

/** UI subscriptions never own the operation. Each worker holds at most one image until its save completes. */
export class PortraitCloudTaskStore {
  private snapshot: PortraitCloudTask | null = null;
  private controller?: AbortController;
  private listeners = new Set<() => void>();
  private savedListeners = new Set<(saved: ArchiveCharacter) => void>();
  private unsubscribeEpoch: () => void;
  private firstSuccess?: () => void;

  constructor(private readonly dependencies: TaskDependencies) {
    this.unsubscribeEpoch = dependencies.subscribeEpoch(() => {
      if (this.snapshot?.epoch !== dependencies.getEpoch()) this.cancel('资料库已切换，导入已停止');
    });
  }

  getSnapshot = (): PortraitCloudTask | null => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  subscribeSaves = (listener: (saved: ArchiveCharacter) => void): (() => void) => {
    this.savedListeners.add(listener);
    return () => { this.savedListeners.delete(listener); };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  private setItem(index: number, patch: Partial<PortraitCloudTaskItem>) {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, items: this.snapshot.items.map((item, i) => i === index ? { ...item, ...patch } : item) };
    this.emit();
  }
  start(target: PortraitCloudTarget, links: readonly PortraitLink[], options?: { onFirstSave?: () => void }): void {
    if (this.snapshot?.status === 'running' || this.snapshot?.status === 'cancelling') throw new Error('已有立绘下载任务，请等待完成或停止后再导入');
    if (!links.length || links.length > 1000) throw new Error('请选择 1 到 1000 张立绘');
    this.snapshot = {
      target: { ...target }, epoch: this.dependencies.getEpoch(), status: 'running',
      items: links.map(link => ({ ...link, status: 'pending' })),
    };
    this.firstSuccess = options?.onFirstSave;
    this.run();
  }
  retry(index?: number): void {
    const task = this.snapshot;
    if (!task) return;
    if (task.epoch !== this.dependencies.getEpoch()) throw new Error('资料库已切换，请回到目标角色重新导入');
    if (task.status === 'running' || task.status === 'cancelling') return;
    const retryable = (item: PortraitCloudTaskItem, i: number) => (index === undefined || i === index) && (item.status === 'failed' || item.status === 'cancelled');
    if (!task.items.some(retryable)) return;
    this.snapshot = { ...task, status: 'running', reason: undefined, items: task.items.map((item, i) => retryable(item, i) ? { ...item, status: 'pending', error: undefined, receivedBytes: 0 } : item) };
    this.run();
  }
  cancel(reason = '已停止下载，已保存的图片会保留'): void {
    if (this.snapshot?.status !== 'running') return;
    this.controller?.abort();
    this.snapshot = { ...this.snapshot, status: 'cancelling', reason };
    this.emit();
  }
  dismiss(): void {
    if (this.snapshot?.status === 'running' || this.snapshot?.status === 'cancelling') return;
    this.snapshot = null;
    this.emit();
  }
  dispose(): void {
    this.cancel();
    this.unsubscribeEpoch();
    this.listeners.clear();
    this.savedListeners.clear();
  }
  private run(): void {
    const task = this.snapshot!;
    const controller = new AbortController();
    this.controller = controller;
    const pending = task.items.flatMap((item, index) => item.status === 'pending' ? [index] : []);
    let next = 0;
    const isCurrent = () => task.epoch === this.dependencies.getEpoch();
    const worker = async () => {
      while (next < pending.length && !controller.signal.aborted && isCurrent()) {
        const index = pending[next++];
        const link = task.items[index];
        const target = { ...task.target, rowId: link.rowId === undefined ? task.target.rowId : link.rowId, rowTitle: link.rowTitle ?? task.target.rowTitle };
        this.setItem(index, { status: 'downloading' });
        try {
          if (!link.force && await this.dependencies.checkExisting?.(target, link)) {
            controller.signal.throwIfAborted(); if (!isCurrent()) throw new Error('资料库已切换');
            this.setItem(index, { status: 'skipped', error: undefined }); continue;
          }
          const file = await this.dependencies.download(link, controller.signal, (receivedBytes, totalBytes) => this.setItem(index, { receivedBytes, totalBytes }));
          controller.signal.throwIfAborted();
          if (!isCurrent()) throw new Error('资料库已切换');
          this.setItem(index, { status: 'saving', receivedBytes: file.size });
          const outcome = await this.dependencies.save(target, file, task.epoch, controller.signal, link);
          const skipped = 'character' in outcome && outcome.skipped;
          const saved = 'character' in outcome ? outcome.character : outcome;
          this.setItem(index, { status: skipped ? 'skipped' : 'saved', error: undefined });
          if (!skipped && isCurrent() && this.firstSuccess) { try { this.firstSuccess(); } catch { /* Preferences cannot fail a committed save. */ } finally { this.firstSuccess = undefined; } }
          if (isCurrent()) for (const listener of this.savedListeners) {
            try { listener(saved); } catch { /* An observer cannot fail a committed save. */ }
          }
        } catch (error) {
          this.setItem(index, {
            status: controller.signal.aborted || !isCurrent() ? 'cancelled' : 'failed',
            error: controller.signal.aborted || !isCurrent() ? '已取消' : error instanceof Error ? error.message : '下载失败，请重试',
          });
        }
      }
    };
    this.emit();
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker)).then(() => {
      const current = this.snapshot!;
      this.snapshot = {
        ...current, status: controller.signal.aborted || !isCurrent() ? 'cancelled' : 'completed',
        items: current.items.map(item => item.status === 'pending' ? { ...item, status: 'cancelled', error: '已取消' } : item),
      };
      this.emit();
    });
  }
}

export const portraitCloudTasks = new PortraitCloudTaskStore({
  download: async (link, signal, progress) => {
    const cached = link.force ? undefined : await portraitPreviewCache.reuse(link, signal);
    if (cached) { progress?.(cached.size, cached.size); return cached; }
    return downloadPortrait(link, signal, undefined, progress);
  },
  checkExisting: async (target, link) => {
    const character = await getCharacter(target.characterId); if (!character) throw new Error('目标角色已删除');
    if (target.rowId && !character.portraitRows?.some(row => row.id === target.rowId)) throw new Error('图片保存失败或目标分行已删除');
    return hasPortraitSource(character, portraitImportSource(link.url));
  },
  getEpoch: getVaultEpoch,
  subscribeEpoch: subscribeActiveVault,
  save: async (target, file, epoch, signal, link) => {
    signal.throwIfAborted();
    if (epoch !== getVaultEpoch()) throw new Error('资料库已切换');
    let skipped = false;
    const saved = await updateCharacter(target.characterId, async (current, context) => {
      signal.throwIfAborted();
      if (epoch !== getVaultEpoch()) throw new Error('资料库已切换');
      // Once a save starts it finishes against the captured vault; a switch only stops queued work.
      const outcome = await prepareImportedPortraitFile(current, target.rowId, file, portraitImportSource(link.url), link.force, context.vault);
      skipped = outcome.skipped;
      if (!outcome.mutation) return undefined;
      outcome.mutation.patch.updatedAt = Date.now(); return outcome.mutation;
    });
    if (!saved) throw new Error('目标角色已删除');
    return { character: saved, skipped };
  },
});

export const subscribePortraitCloudSaves = portraitCloudTasks.subscribeSaves;
