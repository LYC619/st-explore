// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_READING_PACK_BYTES, type ParsedReadingPack } from '@/types/reading-pack';
import { buildReadingPack } from '@/lib/reading-pack/export';
import { parseReadingPackFile } from '@/lib/reading-pack/reading-pack-worker-client';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { super(); FakeWorker.instances.push(this); }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
  get requestId(): string { return this.postMessage.mock.calls[0][0].requestId; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const parsed = { media: new Map() } as ParsedReadingPack;
const fakeFile = (buffer = Promise.resolve(new ArrayBuffer(4)), size = 4) => ({
  size, arrayBuffer: vi.fn(() => buffer),
}) as unknown as File;

beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

describe('reading pack worker client', () => {
  it('checks size before reading or spawning', async () => {
    const file = fakeFile(undefined, MAX_READING_PACK_BYTES + 1);
    await expect(parseReadingPackFile(file)).rejects.toMatchObject({ code: 'input-too-large' });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('honors a signal cancelled before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = fakeFile();
    await expect(parseReadingPackFile(file, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels immediately during file reading and never spawns after a late read', async () => {
    const reading = deferred<ArrayBuffer>();
    const controller = new AbortController();
    const promise = parseReadingPackFile(fakeFile(reading.promise), controller.signal);
    const assertion = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await assertion;
    reading.resolve(new ArrayBuffer(4));
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('transfers only this request buffer and terminates on success', async () => {
    const buffer = new ArrayBuffer(4);
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = parseReadingPackFile(fakeFile(Promise.resolve(buffer)), controller.signal);
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const removeListener = vi.spyOn(worker, 'removeEventListener');
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.url.pathname).toMatch(/reading-pack\.worker\.ts$/);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'parse', requestId: worker.requestId, buffer }, [buffer]);
    worker.reply({ type: 'parsed', requestId: 'stale', parsed: null });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply({ type: 'parsed', requestId: worker.requestId, parsed });
    await expect(promise).resolves.toBe(parsed);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(removeListener.mock.calls.map(args => args[0]).sort()).toEqual(['error', 'message', 'messageerror']);
    expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'parse-error', 'worker-error', 'messageerror'])('cleans up on %s', async outcome => {
    const controller = new AbortController();
    const promise = parseReadingPackFile(fakeFile(), controller.signal);
    const assertion = expect(promise).rejects.toMatchObject({
      code: outcome === 'cancel' ? 'cancelled' : outcome === 'parse-error' ? 'entry-too-large' : 'invalid-format',
    });
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    const removeListener = vi.spyOn(worker, 'removeEventListener');
    if (outcome === 'cancel') controller.abort();
    else if (outcome === 'parse-error') worker.reply({
      type: 'error', requestId: worker.requestId, code: 'entry-too-large', message: 'expanded size over limit',
    });
    else worker.dispatchEvent(new Event(outcome === 'worker-error' ? 'error' : 'messageerror'));
    await assertion;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledTimes(3);
  });

  it('releases the abort listener on read failure', async () => {
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    await expect(parseReadingPackFile(fakeFile(Promise.reject(new Error('file failed'))), controller.signal))
      .rejects.toThrow('file failed');
    expect(removeAbort).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('terminates a worker when posting the buffer throws', async () => {
    class BrokenWorker extends FakeWorker { postMessage = vi.fn(() => { throw new Error('post failed'); }); }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(parseReadingPackFile(fakeFile())).rejects.toThrow('post failed');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it.each(['read', 'spawn'])('removes the abort listener when %s throws synchronously', async stage => {
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, 'removeEventListener');
    const file = fakeFile();
    if (stage === 'read') vi.mocked(file.arrayBuffer).mockImplementation(() => { throw new Error('sync failure'); });
    else vi.stubGlobal('Worker', class { constructor() { throw new Error('sync failure'); } });
    await expect(parseReadingPackFile(file, controller.signal)).rejects.toThrow('sync failure');
    expect(removeAbort).toHaveBeenCalledOnce();
  });
});

describe('real worker message handler', () => {
  it('parses a valid request and preserves typed failures', async () => {
    const scope = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() };
    vi.stubGlobal('self', scope);
    await import('@/lib/reading-pack/reading-pack.worker');
    const bytes = buildReadingPack({ characters: [], stories: [], summaries: [], appVersion: 'test' }).bytes;
    scope.onmessage!(new MessageEvent('message', { data: { type: 'parse', requestId: 'valid', buffer: bytes.buffer } }));
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'parsed', requestId: 'valid', parsed: expect.objectContaining({ media: new Map() }),
    }));
    scope.onmessage!(new MessageEvent('message', { data: { type: 'parse', requestId: 'bad', buffer: new ArrayBuffer(4) } }));
    expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'error', requestId: 'bad', code: 'truncated-zip', message: expect.any(String),
    }));
  });
});
