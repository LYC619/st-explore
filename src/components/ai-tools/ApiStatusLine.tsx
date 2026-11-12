import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiProfileState } from './useApiProfileState';
import { QuickModelSwitcher } from './QuickModelSwitcher';
import { saveSettingsSection } from '@/lib/settings-navigation';
import { isLLMConfigured } from '@/lib/llm';

/**
 * 所有生成模块共用状态与快速模型切换；连接信息仍在设置维护。
 */
export function ApiStatusLine({ busy = false }: { busy?: boolean }) {
  const navigate = useNavigate();
  const { profiles, activeId } = useApiProfileState();
  const active = profiles.find(profile => profile.id === activeId);
  const configured = !!active && isLLMConfigured(active);

  if (configured) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="w-3.5 h-3.5 text-primary/70 shrink-0" />
        <span>API 已配置</span><QuickModelSwitcher busy={busy} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-md border border-[var(--status-warn-bg)] bg-[var(--status-warn-bg)] px-3 py-2 text-sm">
      <AlertCircle className="w-4 h-4 text-[color:var(--status-warn)] shrink-0" />
      <span>请先配置接口地址和模型，再使用生成功能。</span>
      <QuickModelSwitcher busy={busy} />
      <Button variant="outline" size="sm" className="ml-auto" onClick={() => { saveSettingsSection('ai'); navigate('/settings'); }}>
        去「AI 配置」页配置
      </Button>
    </div>
  );
}
