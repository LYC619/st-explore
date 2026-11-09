import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/lib/vault/tauri-fs';
import { API_CONFIG_SYNC_EVENT, getApiConfigSyncState, hydrateApiProfilesFromSystem, retryApiProfileSave } from '@/lib/vault/sensitive-config';

/** Persistence failures must remain visible after a toast disappears. No credentials in status. */
export function ApiConfigSyncNotice() {
  const [state, setState] = useState(getApiConfigSyncState);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => setState(getApiConfigSyncState());
    window.addEventListener(API_CONFIG_SYNC_EVENT, sync);
    return () => window.removeEventListener(API_CONFIG_SYNC_EVENT, sync);
  }, []);
  if (!isTauri()) return null;
  const retry = async () => {
    setBusy(true);
    try { setState(await (state.status === 'save-failed' ? retryApiProfileSave() : hydrateApiProfilesFromSystem())); }
    finally { setBusy(false); }
  };
  return <div className="rounded-md border border-border p-3 text-sm space-y-2">
    {state.message && <p role="status">{state.message}</p>}
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void retry()}>
      {busy ? '正在处理…' : state.status === 'save-failed' ? '重试保存连接' : '重新读取已保存连接'}
    </Button>
  </div>;
}
