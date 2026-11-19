/** 同一 key 的任务严格串行，不同 key 可并行。失败不会阻断后续任务。 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly readGates = new Map<string, Promise<void>>();

  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.readGates.delete(key);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.then(() => {}, () => {});
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }

  /** Concurrent reads share a gate; the next writer waits for the whole group. */
  read<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const gate = this.readGates.get(key) ?? previous;
    this.readGates.set(key, gate);
    const run = gate.then(task);
    const tail = Promise.allSettled([previous, run]).then(() => {});
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
        if (this.readGates.get(key) === gate) this.readGates.delete(key);
      }
    });
    return run;
  }
}
