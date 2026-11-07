import type { WorldCommit } from '../storage/world-commit';
import type { WorldRepo } from '../storage/world-repo';
import type { Intervention, StepResult, WorldState } from './schema';

export type ComputeStep = (state: WorldState, command: Intervention | undefined, signal: AbortSignal) => Promise<StepResult>;
const cancelled = () => new DOMException('推演已暂停', 'AbortError');
export const computeStep: ComputeStep = (state, command, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(cancelled()); return; }
  const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
  const cleanup = () => { worker.terminate(); clearTimeout(timeout); signal.removeEventListener('abort', abort); };
  const abort = () => { cleanup(); reject(cancelled()); };
  const timeout = setTimeout(() => { cleanup(); reject(new Error('本轮推演超时，请重试')); }, 10000);
  worker.onmessage = event => { cleanup(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
  worker.onerror = event => { cleanup(); reject(new Error(event.message || '推演线程未能启动')); };
  signal.addEventListener('abort', abort, { once: true });
  worker.postMessage({ state, command });
});

/** The host is the sole writer. Cancelling discards uncommitted calculations;
 * once persistence starts, that atomic round finishes before navigation. */
export class WorldSession {
  private token = 0;
  private controller?: AbortController;
  private running = false;
  constructor(private repo: WorldRepo, public current: WorldCommit, private compute: ComputeStep = computeStep) {}
  stop() { this.token++; this.controller?.abort(); }
  async step(command?: Intervention): Promise<WorldCommit> {
    if (this.running) throw new Error('本轮尚未结束');
    this.running = true;
    const token = ++this.token, previous = this.current, controller = new AbortController();
    this.controller = controller;
    try {
      const result = await this.compute(previous.state, command, controller.signal);
      if (token !== this.token || controller.signal.aborted) throw cancelled();
      const saved = await this.repo.append(previous, result, 'step', command);
      this.current = saved; return saved;
    } finally { this.running = false; this.controller = undefined; }
  }
}
