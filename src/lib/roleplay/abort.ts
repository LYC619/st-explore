/** Stop waiting even when the underlying operation cannot cancel; consume late rejection safely. */
export function waitForAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const release = () => signal.removeEventListener('abort', abort);
    const abort = () => { release(); reject(signal.reason ?? new DOMException('操作已取消', 'AbortError')); };
    pending.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
