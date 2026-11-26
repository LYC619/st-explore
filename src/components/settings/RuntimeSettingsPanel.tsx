import { tr } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { useCallback, useEffect, useState } from 'react';
import { Check, Eye, FolderOpen, FolderSearch, KeyRound, Loader2, RefreshCw, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  getHideUnusedLibraryTags,
  getNsfwBlur,
  setHideUnusedLibraryTags,
  setNsfwBlur,
} from '@/lib/local-settings';
import {
  createTauriFs,
  getAppConfig,
  getVaultRoot,
  isTauri,
  pickDirectory,
  setAppConfig,
} from '@/lib/vault/tauri-fs';
import { detectRuntime, RUNTIME_LABEL } from '@/lib/runtime';
import { scanSTUserDir, type STScanResult } from '@/lib/vault/st-import';
import { STAIConfigDialog } from '@/components/tools/STAIConfigDialog';
import { STImportCard } from '@/components/tools/STImportCard';
import {
  chooseVaultForNextBoot,
  selectRegisteredVaultForNextBoot,
  unregisterVault,
} from '@/lib/vault/vault-registry-runtime';
import { loadVaultRegistry } from '@/lib/vault/vault-registry-store';
import type { VaultProfile, VaultRegistry } from '@/lib/vault/vault-registry';
import { LanguagePicker } from './LanguagePicker';

interface STCounts {
  characters: number;
  chats: number;
  worldbooks: number;
  presets: number;
  regexes: number;
  archivedFiles: number;
  relationshipSets: number;
}

function scanCounts(scan: STScanResult): STCounts {
  return {
    characters: scan.characters.length,
    chats: scan.characters.reduce((total, character) => total + character.chats.length, 0) + scan.strayChats.length,
    worldbooks: scan.worldbooks.length,
    presets: scan.presets.length,
    regexes: scan.regex?.count ?? 0,
    archivedFiles: scan.archives.reduce((total, group) => total + group.files.length, 0),
    relationshipSets: scan.relationships.status === 'parsed' ? 1 : 0,
  };
}

function hasSTContent(counts: STCounts): boolean {
  return Object.values(counts).some((count) => count > 0);
}

export function DisplaySettingsPanel() {
  useI18n();
  const [blurNsfw, setBlurNsfw] = useState(() => getNsfwBlur());
  const [hideUnusedTags, setHideUnusedTags] = useState(() => getHideUnusedLibraryTags());

  const handleBlurChange = (checked: boolean) => {
    setBlurNsfw(checked);
    setNsfwBlur(checked);
  };

  const handleHideUnusedTagsChange = (checked: boolean) => {
    setHideUnusedTags(checked);
    setHideUnusedLibraryTags(checked);
  };

  return (
    <section className="rounded-md border border-border p-4 space-y-3">
      <LanguagePicker />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Eye className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{tr("显示偏好")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{tr("角色卡面标记为 NSFW 时，列表和详情默认模糊。")}</p>
          </div>
        </div>
        <Switch
          checked={blurNsfw}
          onCheckedChange={handleBlurChange}
          aria-label={tr("默认模糊 NSFW 卡面")}
        />
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
        <div className="flex min-w-0 items-start gap-3">
          <Tags className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{tr("隐藏未使用标签")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{tr("只精简角色库左侧筛选栏；类型标签仍全部显示，标签管理中的定义不会被删除。")}</p>
          </div>
        </div>
        <Switch
          checked={hideUnusedTags}
          onCheckedChange={handleHideUnusedTagsChange}
          aria-label={tr("隐藏未使用标签")}
        />
      </div>
    </section>
  );
}

export function DirectorySettingsPanel() {
  useI18n();
  const { toast } = useToast();
  const client = isTauri();
  // 「不是桌面端」有两种：网页版和 Android 客户端。文案得分清，否则手机上会说自己是网页版
  const runtime = detectRuntime();
  const [stRoot, setStRoot] = useState<string | null>(null);
  const [vaultRoot, setVaultRootState] = useState<string | null>(null);
  const [vaultRegistry, setVaultRegistry] = useState<VaultRegistry | null>(null);
  const [stCounts, setStCounts] = useState<STCounts | null>(null);
  const [busy, setBusy] = useState<'st' | 'vault' | null>(null);
  const [stConfigOpen, setStConfigOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<VaultProfile | null>(null);

  const refreshPaths = useCallback(async () => {
    if (!client) return;
    const [nextStRoot, nextVaultRoot, nextRegistry] = await Promise.all([
      getAppConfig<string>('stRoot').catch(() => null),
      getVaultRoot().catch(() => null),
      loadVaultRegistry().catch(() => null),
    ]);
    setStRoot(nextStRoot);
    setVaultRootState(nextVaultRoot);
    setVaultRegistry(nextRegistry);
  }, [client]);

  useEffect(() => { void refreshPaths(); }, [refreshPaths]);

  const handleChangeStRoot = async () => {
    if (!client) return;
    setBusy('st');
    try {
      const root = await pickDirectory(
        tr("选择 SillyTavern 目录（安装根目录或 data/default-user）"),
        { persistAuthorization: true, purpose: 'source' },
      );
      if (!root) return;
      const scan = await scanSTUserDir(createTauriFs(root));
      const counts = scanCounts(scan);
      if (!hasSTContent(counts)) {
        toast({
          title: tr("没有找到 ST 内容"),
          description: tr("该目录下没有可识别的角色卡、聊天、世界书、预设或正则。"),
          variant: 'destructive',
        });
        return;
      }
      await setAppConfig('stRoot', root);
      setStRoot(root);
      setStCounts(counts);
      toast({
        title: tr("ST 目录已更新"),
        description: tr("找到 {{v0}} 张角色卡、{{v1}} 场聊天、{{v2}} 本世界书。", { v0: counts.characters, v1: counts.chats, v2: counts.worldbooks }),
      });
    } catch (error) {
      toast({
        title: tr("更新 ST 目录失败"),
        description: error instanceof Error ? error.message : tr("无法读取所选目录"),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleChangeVaultRoot = async () => {
    if (!client) return;
    setBusy('vault');
    try {
      const picked = await chooseVaultForNextBoot();
      if (!picked) return;
      setVaultRootState(picked.path);
      setVaultRegistry(await loadVaultRegistry().catch(() => null));
      toast({ title: tr("库目录已切换"), description: tr("应用将重新载入并使用新目录；旧目录不会自动迁移或修改。") });
      window.location.reload();
    } catch (error) {
      toast({
        title: tr("切换库目录失败"),
        description: error instanceof Error ? error.message : tr("无法激活所选目录"),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleActivateRegisteredVault = async (id: string) => {
    setBusy('vault');
    try {
      const next = await selectRegisteredVaultForNextBoot(id);
      if (!next) throw new Error(tr("所选库已不在注册表中，请刷新设置后重试"));
      window.location.reload();
    } catch (error) {
      toast({
        title: tr("切换已注册库失败"),
        description: error instanceof Error ? error.message : tr("无法激活所选目录"),
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveRegisteredVault = async (profile: VaultProfile) => {
    setBusy('vault');
    try {
      await unregisterVault(profile.id);
      setVaultRegistry(await loadVaultRegistry().catch(() => null));
      toast({ title: tr("已从列表移除「{{v0}}」", { v0: profile.name }), description: tr("磁盘上的库文件夹保持原样，重新「更换库目录」选回来即可。") });
    } catch (error) {
      toast({
        title: tr("移除失败"),
        description: error instanceof Error ? error.message : tr("无法移除该库"),
        variant: 'destructive',
      });
    } finally {
      setPendingRemoval(null);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <FolderSearch className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{tr("SillyTavern 目录")}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {stRoot
                  ? tr("已接入，可直接重新扫描并选择最新内容。")
                  : tr("尚未接入 SillyTavern 目录；只有云端导出的 zip 也能直接导入。")}
              </p>
            </div>
          </div>
          {stRoot && <Check className="w-4 h-4 text-primary shrink-0" aria-label={tr("已接入")} />}
        </div>
        {stRoot && <p className="text-xs break-all rounded bg-muted/50 px-2.5 py-2">{stRoot}</p>}
        {stCounts && (
          <p className="text-xs text-muted-foreground">{tr("最近扫描：")}{stCounts.characters}{tr(" 张角色卡 · ")}{stCounts.chats}{tr(" 场聊天 · ")}{stCounts.worldbooks}{tr(" 本世界书 · ")}{stCounts.presets}{tr(" 份预设 · ")}{stCounts.regexes}{tr(" 条正则 · ")}{stCounts.archivedFiles}{tr(" 个扩展/媒体文件")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {client && (
            <STImportCard variant="compact" root={stRoot} onChanged={() => void refreshPaths()} />
          )}
          <Button variant="outline" size="sm" onClick={handleChangeStRoot} disabled={!client || busy !== null}>
            {busy === 'st' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FolderOpen className="w-4 h-4 mr-1.5" />}
            {stRoot ? tr("更换 ST 目录") : tr("选择 ST 目录")}
          </Button>
          {client && stRoot && (
            <Button variant="ghost" size="sm" onClick={() => setStConfigOpen(true)}>
              <KeyRound className="w-4 h-4 mr-1.5" />{tr("查看 ST 配置")}</Button>
          )}
          {!client && <span className="text-xs text-muted-foreground self-center">{tr("{{v0}}无法读取本机 ST 目录", { v0: RUNTIME_LABEL[runtime] })}</span>}
        </div>
      </section>

      <section className="rounded-md border border-border p-4 space-y-3">
        <div className="flex items-start gap-3 min-w-0">
          <FolderOpen className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{tr("STE 库目录")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{tr("客户端当前使用的业务数据目录。切换只改变当前库，不自动迁移旧目录内容。")}</p>
          </div>
        </div>
        {vaultRoot && <p className="text-xs break-all rounded bg-muted/50 px-2.5 py-2">{vaultRoot}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleChangeVaultRoot} disabled={!client || busy !== null}>
            {busy === 'vault' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}{tr("更换库目录")}</Button>
          {!client && <span className="text-xs text-muted-foreground">{tr("{{v0}}使用浏览器本地存储", { v0: RUNTIME_LABEL[runtime] })}</span>}
        </div>
      </section>

      {client && vaultRegistry && vaultRegistry.vaults.length > 1 && (
        <section className="rounded-md border border-border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <RefreshCw className="w-4 h-4 mt-0.5 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{tr("已注册的库")}</h3>
              <p className="text-xs text-muted-foreground mt-1">{tr("演示库和私人库各自独立；切换后会重新载入页面，避免旧库缓存混入。移除只是不再记住这个路径，磁盘上的文件夹不动。")}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {vaultRegistry.vaults.map((profile) => {
              const active = profile.id === vaultRegistry.activeId;
              return (
                <div key={profile.id} className="flex items-center gap-1 rounded-md border border-border pr-1">
                  <button
                    type="button"
                    disabled={active || busy !== null}
                    onClick={() => void handleActivateRegisteredVault(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-70"
                  >
                    <span className={active ? 'h-2 w-2 rounded-full bg-primary' : 'h-2 w-2 rounded-full bg-muted-foreground/30'} />
                    <span className="min-w-0 flex-1 truncate font-medium" title={profile.name}>{profile.name}</span>
                    <span className="max-w-[16rem] truncate text-[11px] text-muted-foreground" title={profile.path}>{profile.path}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={active || busy !== null}
                    title={active ? tr("当前正在使用的库不能移除，先切换到别的库") : tr("从列表移除（不删除磁盘文件）")}
                    aria-label={tr("从列表移除 {{v0}}", { v0: profile.name })}
                    onClick={() => setPendingRemoval(profile)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("从列表移除「{{v0}}」？", { v0: pendingRemoval?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{tr("只是不再记住这个路径，")}{pendingRemoval?.path}{tr(" 里的角色、故事和资产一个都不删。 以后用「更换库目录」选回同一个文件夹即可重新加进列表。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingRemoval) void handleRemoveRegisteredVault(pendingRemoval); }}
            >{tr("移除")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {client && <STAIConfigDialog open={stConfigOpen} onOpenChange={setStConfigOpen} />}
    </div>
  );
}
