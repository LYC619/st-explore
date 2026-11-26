import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { API_CONFIG_SYNC_EVENT, getApiConfigSyncState } from '@/lib/vault/sensitive-config';

/** Report background persistence failures even when the settings page is closed. */
export function ApiConfigSyncObserver() {
  useI18n();
  useEffect(() => {
    const report = () => {
      const state = getApiConfigSyncState();
      if (['read-failed', 'save-failed', 'changed'].includes(state.status)) {
        toast({ title: tr("AI 连接需要处理"), description: tr("{{v0}} 可在设置 → AI 服务配置中重试。", { v0: state.message }), variant: 'destructive' });
      }
    };
    report();
    window.addEventListener(API_CONFIG_SYNC_EVENT, report);
    return () => window.removeEventListener(API_CONFIG_SYNC_EVENT, report);
  }, []);
  return null;
}
