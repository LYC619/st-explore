import { tr } from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVaultEpoch } from '@/lib/vault/active';

interface Options<T> { value: T; dirty: boolean; enabled: boolean; scope: string; save: (value: T) => Promise<void> }

/** One writer per editor. Acknowledges snapshots, never a newer edit. */
export function useWorldbookAutosave<T>(options: Options<T>) {
  const latest = useRef(options); latest.current = options;
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<Error | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const runningScope = useRef<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const acknowledged = useRef<{ value: T; scope: string }>();
  const epoch = useRef(getVaultEpoch());
  const mounted = useRef(true);

  const flush = useCallback((force = false): Promise<void> => {
    clearTimeout(timer.current);
    if (running.current) {
      const requestedScope = latest.current.scope;
      if (runningScope.current === requestedScope) return running.current;
      // An explicit replacement owns a different draft. Its caller must wait for
      // that draft's write, not mistake the previous asset's completion for it.
      const resume = () => latest.current.scope === requestedScope ? flush(force) : Promise.resolve();
      return running.current.then(resume, resume);
    }
    const start = latest.current;
    if (!force && (!start.dirty || (acknowledged.current?.scope === start.scope && acknowledged.current.value === start.value))) return Promise.resolve();
    const capturedEpoch = epoch.current;
    runningScope.current = start.scope;
    const pending = (async () => {
      await Promise.resolve(); // Publish running before a synchronous guard can reject.
      try {
        if (mounted.current) { setStatus('saving'); setError(null); }
        let next = start;
        while (true) {
          if (getVaultEpoch() !== capturedEpoch) throw new Error(tr("文件库已切换，请重新打开世界书；草稿已保留"));
          await next.save(next.value);
          acknowledged.current = { value: next.value, scope: next.scope };
          if (getVaultEpoch() !== capturedEpoch) throw new Error(tr("文件库已切换，请重新打开世界书；草稿已保留"));
          const current = latest.current;
          if (current.scope !== start.scope || current.value === next.value || !current.dirty) break;
          next = current;
        }
        if (mounted.current) setStatus('saved');
      } catch (reason) {
        const failure = reason instanceof Error ? reason : new Error(String(reason));
        if (mounted.current) { setError(failure); setStatus('error'); }
        throw failure;
      } finally { running.current = null; }
    })();
    running.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    if (!options.dirty) { if (!running.current) setStatus('saved'); return; }
    if (!options.enabled || (acknowledged.current?.scope === options.scope && acknowledged.current.value === options.value)) return;
    setStatus(current => current === 'saving' ? current : 'pending');
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 600);
    return () => clearTimeout(timer.current);
  }, [options.value, options.dirty, options.enabled, options.scope, flush]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  return { status, error, flush };
}
