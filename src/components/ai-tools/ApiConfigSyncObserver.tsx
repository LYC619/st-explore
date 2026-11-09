import { useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { API_CONFIG_SYNC_EVENT, getApiConfigSyncState } from '@/lib/vault/sensitive-config';

/** Report background persistence failures even when the settings page is closed. */
export function ApiConfigSyncObserver() {
  useEffect(() => {
    const report = () => {
      const state = getApiConfigSyncState();
      if (['read-failed', 'save-failed', 'changed'].includes(state.status)) {
        toast({ title: 'AI 连接需要处理', description: `${state.message} 可在设置 → AI 服务配置中重试。`, variant: 'destructive' });
      }
    };
    report();
    window.addEventListener(API_CONFIG_SYNC_EVENT, report);
    return () => window.removeEventListener(API_CONFIG_SYNC_EVENT, report);
  }, []);
  return null;
}
