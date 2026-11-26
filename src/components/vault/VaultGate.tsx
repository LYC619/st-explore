import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
/**
 * 客户端文件库门卫（2.0 阶段7.2c）：
 * 网页版直接放行；客户端先激活文件库再渲染应用，未配置库时全屏引导选目录。
 * 必须在任何页面读数据之前完成激活，否则首屏会先读到 IndexedDB。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bootVault, chooseVaultRoot, type VaultBootState } from '@/lib/vault/bootstrap';
import { isInvalidAppConfigError, repairAppConfig } from '@/lib/vault/tauri-fs';
import { VaultRecycleMaintenance } from './VaultRecycleMaintenance';
import { NEWER_VAULT_MESSAGE } from '@/lib/vault/vault-format';
import { LanguagePicker } from '@/components/settings/LanguagePicker';

export function VaultGate({ children }: { children: React.ReactNode }) {
  useI18n();
  const [state, setState] = useState<VaultBootState | 'booting'>('booting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    bootVault().then(setState);
  }, []);

  const handleChoose = useCallback(async () => {
    setError(null);
    try {
      const picked = await chooseVaultRoot();
      if (picked) setState('ready');
    } catch (reason) {
      const configInvalid = isInvalidAppConfigError(reason);
      if (configInvalid) {
        setState('repair');
      }
      setError(configInvalid
        ? tr("应用配置仍然损坏，请先备份并修复后再选择文件夹。")
        : reason instanceof Error ? (reason.message === NEWER_VAULT_MESSAGE ? tr(NEWER_VAULT_MESSAGE) : reason.message) : tr("无法打开所选文件夹，请重试"));
    }
  }, []);

  const handleRepair = useCallback(async () => {
    setError(null);
    setRepairing(true);
    try {
      const backup = await repairAppConfig();
      setNotice(backup
        ? tr("原配置已备份到：{{v0}}", { v0: backup })
        : tr("配置文件已经可用，无需重置。"));
      setState('unset');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("无法备份并修复应用配置，请重试"));
    } finally {
      setRepairing(false);
    }
  }, []);

  if (state === 'booting') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === 'repair') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md space-y-4 rounded-lg border p-8 text-center">
          <LanguagePicker compact />
          <AlertTriangle className="mx-auto h-10 w-10 text-[color:var(--status-warn)]" />
          <h1 className="text-xl font-semibold">{tr("应用配置需要修复")}</h1>
          <p className="text-sm text-muted-foreground">{tr("STE 无法读取系统配置文件。你的角色、故事和其他库文件不在这个配置文件里，不会被删除或修改。 修复会先在原目录保留一份带时间戳的备份，再重置应用配置；之后需要重新选择当前 STE 库。")}</p>
          <Button onClick={handleRepair} disabled={repairing} className="gap-2">
            {repairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}{tr("备份并修复配置")}</Button>
          {error && <p role="alert" className="break-all text-sm text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  if (state === 'unset' || state === 'newer') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="max-w-md space-y-4 rounded-lg border p-8 text-center">
          <LanguagePicker compact />
          <FolderOpen className="mx-auto h-10 w-10 text-primary" />
          <h1 className="text-xl font-semibold">{tr("选择你的 STE 库文件夹")}</h1>
          {state === 'newer' && <p role="alert" className="text-sm text-destructive">{tr(NEWER_VAULT_MESSAGE)}</p>}
          <p className="text-sm text-muted-foreground">{tr("一个文件夹就是整个库：角色、故事、总结全部以普通文件存放， 可以直接用资源管理器查看、网盘同步、手动备份。 选一个空文件夹开始，或选择已有的 STE 库继续使用。")}</p>
          <Button onClick={handleChoose} className="gap-2">
            <FolderOpen className="h-4 w-4" />{tr("选择文件夹")}</Button>
          {notice && <p role="status" className="break-all text-sm text-muted-foreground">{notice}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return <><VaultRecycleMaintenance />{children}</>;
}
