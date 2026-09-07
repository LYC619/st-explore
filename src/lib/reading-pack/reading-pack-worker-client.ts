import { MAX_READING_PACK_BYTES, type ParsedReadingPack } from '@/types/reading-pack';
import { isReadingPackError, ReadingPackError, type ReadingPackErrorCode } from './import';

export interface ReadingPackWorkerRequest { type: 'parse'; requestId: string; buffer: ArrayBuffer }
export type ReadingPackWorkerResponse =
  | { type: 'parsed'; requestId: string; parsed: ParsedReadingPack }
  | { type: 'error'; requestId: string; code: ReadingPackErrorCode; message: string };

/** Each request owns its file buffer and worker, including all cancellation cleanup. */
export function parseReadingPackFile(file: File, signal?: AbortSignal): Promise<ParsedReadingPack> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      if (worker) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        worker.removeEventListener('messageerror', onError);
        worker.terminate();
        worker = undefined;
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new ReadingPackError('cancelled', '已取消读取阅读包'));
    const onError = (event: Event) => fail(new ReadingPackError(
      'invalid-format', '阅读包解析线程失败' + ('message' in event ? `：${String(event.message)}` : ''),
    ));
    const onMessage = (event: MessageEvent<ReadingPackWorkerResponse>) => {
      const response = event.data;
      if (settled || response?.requestId !== requestId) return;
      if (response.type === 'error') {
        fail(isReadingPackError(response)
          ? new ReadingPackError(response.code, response.message)
          : new ReadingPackError('invalid-format', '阅读包解析线程返回未知错误'));
      } else if (response.type === 'parsed') {
        settled = true;
        cleanup();
        resolve(response.parsed);
      }
    };
    if (signal?.aborted) { onAbort(); return; }
    if (file.size > MAX_READING_PACK_BYTES) {
      fail(new ReadingPackError('input-too-large', `压缩输入字节 ${file.size}，上限 ${MAX_READING_PACK_BYTES}`));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    // arrayBuffer itself is not abortable; reject immediately and discard its eventual result.
    const read = async () => {
      const buffer = await file.arrayBuffer();
      if (settled) return;
      if (signal?.aborted) { onAbort(); return; }
      worker = new Worker(new URL('./reading-pack.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onError);
      worker.postMessage({ type: 'parse', requestId, buffer } satisfies ReadingPackWorkerRequest, [buffer]);
    };
    void read().catch(fail);
  });
}
