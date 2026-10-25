import { useEffect, useSyncExternalStore } from 'react';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { recycleExpiredFiles } from '@/lib/vault/file-maintenance';
import { useToast } from '@/hooks/use-toast';

/** Check after the first screen and hourly while this vault remains open. */
export function VaultRecycleMaintenance() {
  const epoch = useSyncExternalStore(subscribeActiveVault, getVaultEpoch, getVaultEpoch);
  const { toast } = useToast();
  useEffect(() => {
    const vault = getActiveVault();
    if (!vault?.fs.trashFile) return;
    let active = true, busy = false, reported = false;
    const run = async () => {
      if (!active || busy || getVaultEpoch() !== epoch) return;
      busy = true;
      try {
        const result = await recycleExpiredFiles(vault);
        if (active && getVaultEpoch() === epoch && result.failed.length && !reported) {
          reported = true;
          toast({ title: '部分到期文件暂未移入系统回收站', description: '文件仍保留在库内，可到设置的文件检查中查看；稍后会重试。' });
        }
      } catch (error) {
        if (active && getVaultEpoch() === epoch && !reported) {
          reported = true;
          toast({ title: '自动回收暂未完成，文件继续保留', description: error instanceof Error ? error.message : String(error) });
        }
      } finally { busy = false; }
    };
    const first = setTimeout(() => void run(), 5_000);
    const timer = setInterval(() => void run(), 60 * 60 * 1000);
    return () => { active = false; clearTimeout(first); clearInterval(timer); };
  }, [epoch, toast]);
  return null;
}
