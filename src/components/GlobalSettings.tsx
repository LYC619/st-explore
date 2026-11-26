import { tr, getLocale, formatList } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/react';
import { FileMaintenancePanel } from '@/components/settings/FileMaintenancePanel';
import { RecycleBinPanel } from '@/components/settings/RecycleBinPanel';
import { useState, useEffect } from 'react';
import { HardDrive, Download, Upload, Trash2, AlertCircle, RotateCcw, Info, ExternalLink, Eraser, Package } from 'lucide-react';
import { ReadingPackImportDialog } from '@/components/settings/ReadingPackImportDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
  estimateStorageUsage,
  exportFullBackup,
  parseBackupFile,
  previewBackup,
  importBackup,
  clearAllData,
  formatBytes,
  type ParsedBackup,
  type BackupPreview,
} from '@/lib/storage-utils';
import { clearAllTempCache } from '@/lib/session-storage';
import { getAllCharacters, getAllArchiveStories } from '@/lib/archive-db';
import { getAllWorldBooks } from '@/lib/worldbook-db';
import { resetAllTours } from '@/lib/tour-steps';
import { BUILD_INFO, formatBuildInfo } from '@/lib/build-info';
import { getEnvironmentInfo, openLogDirectory, type EnvironmentInfo } from '@/lib/diagnostics';
import { isTauri } from '@/lib/runtime';

export const APP_VERSION = 'v0.9.9';

interface StorageDetail {
  label: string;
  count: number;
  size: number;
  detail?: string;
}

interface DataSettingsPanelProps {
  onDataChanged?: () => void;
}

/**
 * 数据与存储面板（阶段9.9 从顶栏 Sheet 弹窗改造为设置页的一个区块）。
 */
export function DataSettingsPanel({ onDataChanged }: DataSettingsPanelProps) {
  const locale = useI18n();
  const { toast } = useToast();
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ parsed: ParsedBackup; preview: BackupPreview } | null>(null);
  const [packImportOpen, setPackImportOpen] = useState(false);
  const [storage, setStorage] = useState({ used: 0, quota: 0, percentage: 0 });
  const [details, setDetails] = useState<StorageDetail[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshStorage = async () => {
    const info = await estimateStorageUsage();
    setStorage(info);

    // Detailed breakdown
    const breakdownItems: StorageDetail[] = [];

    try {
      const characters = await getAllCharacters();
      let totalCharSize = 0;
      const charDetails = characters.map(c => {
        const size = new Blob([JSON.stringify(c)]).size;
        totalCharSize += size;
        return `${c.name} — ${formatBytes(size)}`;
      });
      breakdownItems.push({
        label: tr("角色档案"),
        count: characters.length,
        size: totalCharSize,
        detail: charDetails.join('\n'),
      });
    } catch { /* ignore */ }

    try {
      const stories = await getAllArchiveStories();
      let totalStorySize = 0;
      const storyDetails = stories.map(s => {
        const size = new Blob([JSON.stringify(s)]).size;
        totalStorySize += size;
        const branchNote = s.branches?.length ? tr("，{{v0}} 条分支", { v0: s.branches.length }) : '';
        return tr("{{v0}} — {{v1}}, {{v2}} 楼{{v3}}", { v0: s.title, v1: formatBytes(size), v2: s.session.messages.length, v3: branchNote });
      });
      breakdownItems.push({
        label: tr("归档故事"),
        count: stories.length,
        size: totalStorySize,
        detail: storyDetails.join('\n'),
      });
    } catch { /* ignore */ }

    try {
      const wbs = await getAllWorldBooks();
      let totalWbSize = 0;
      const wbDetails = wbs.map(wb => {
        const size = new Blob([JSON.stringify(wb)]).size;
        totalWbSize += size;
        const entryCount = wb.worldbook ? Object.keys(wb.worldbook.entries).length : 0;
        return tr("{{v0}} — {{v1}}, {{v2}} 个条目", { v0: wb.title, v1: formatBytes(size), v2: entryCount });
      });
      breakdownItems.push({
        label: tr("世界书"),
        count: wbs.length,
        size: totalWbSize,
        detail: wbDetails.join('\n'),
      });
    } catch { /* ignore */ }

    // Estimate localStorage usage
    let lsSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        lsSize += (localStorage.getItem(key) || '').length * 2; // UTF-16
      }
    }
    breakdownItems.push({
      label: tr("AI 配置及缓存、正则规则、设置"),
      count: localStorage.length,
      size: lsSize,
    });

    setDetails(breakdownItems);
  };

  useEffect(() => {
    void refreshStorage();
  }, [locale]);

  const handleExport = async () => {
    try {
      setLoading(true);
      await exportFullBackup();
      toast({ title: tr("备份成功"), description: tr("已导出完整备份（角色/故事/世界书/预设/正则/总结/故事树/沙盘世界）") });
    } catch (err) {
      toast({
        title: tr("导出备份失败"),
        description: tr("{{v0}}；请检查磁盘剩余空间或浏览器下载权限后重试。", { v0: err instanceof Error ? err.message : tr("无法生成备份文件") }),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // 第一步：仅解析+校验，算出将新增/覆盖/跳过什么，弹预览让用户确认（不写库）
  const handleSelectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选同一文件
    if (!file) return;
    try {
      setLoading(true);
      const parsed = await parseBackupFile(file);
      const preview = await previewBackup(parsed);
      setPendingImport({ parsed, preview });
    } catch (err) {
      toast({
        title: tr("无法读取备份文件"),
        description: err instanceof Error ? err.message : tr("备份文件格式异常或已损坏，请确认选中的是 STE 导出的备份 JSON。"),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // 第二步：用户确认后原子写回（单事务，失败整体回滚，不会写坏现有库）
  const confirmImport = async () => {
    if (!pendingImport) return;
    try {
      setLoading(true);
      const c = await importBackup(pendingImport.parsed);
      const parts: string[] = [];
      if (c.characters > 0) parts.push(tr("{{v0}} 个角色", { v0: c.characters }));
      if (c.archiveStories > 0) parts.push(tr("{{v0}} 个故事", { v0: c.archiveStories }));
      if (c.worldbooks > 0) parts.push(tr("{{v0}} 本世界书", { v0: c.worldbooks }));
      if (c.presets > 0) parts.push(tr("{{v0}} 份预设", { v0: c.presets }));
      if (c.cards > 0) parts.push(tr("{{v0}} 张角色卡", { v0: c.cards }));
      if (c.regexes > 0) parts.push(tr("{{v0}} 套正则", { v0: c.regexes }));
      if (c.summaries > 0) parts.push(tr("{{v0}} 份总结", { v0: c.summaries }));
      if (c.summaryTemplates > 0) parts.push(tr("{{v0}} 个总结模板", { v0: c.summaryTemplates }));
      if (c.stories > 0) parts.push(tr("{{v0}} 棵故事树", { v0: c.stories }));
      toast({
        title: tr("恢复成功"),
        description: parts.length ? tr("已写入 {{v0}}", { v0: formatList(parts) }) : tr("备份中没有可导入的数据"),
      });
      await refreshStorage();
      onDataChanged?.();
    } catch (err) {
      toast({
        title: tr("恢复失败"),
        description: err instanceof Error ? err.message : tr("写入失败，现有数据未改动"),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setPendingImport(null);
    }
  };

  const handleClear = async () => {
    try {
      setLoading(true);
      await clearAllData();
      toast({ title: tr("已清空"), description: tr("所有本地数据已删除（角色/故事/世界书/预设/正则/总结）") });
      await refreshStorage();
      onDataChanged?.();
    } catch (err) {
      toast({
        title: tr("清空数据失败"),
        description: tr("{{v0}}；请关闭其他已打开的 STE 窗口或标签页后重试。", { v0: err instanceof Error ? err.message : tr("未能完成清空") }),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setClearDialogOpen(false);
    }
  };

  const handleClearTempCache = () => {
    clearAllTempCache();
    toast({
      title: tr("已清除临时缓存"),
      description: tr("页面间的临时编辑态已清空（角色库与故事等已保存数据不受影响）。重新进入对应页面即可。"),
    });
    refreshStorage();
  };

  return (
    <>
      <div className="space-y-6">
            {/* Storage Overview */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="w-4 h-4" />{tr("存储概览")}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{tr("总存储用量")}</span>
                  <span className="font-medium">
                    {formatBytes(storage.used)}
                    {storage.quota > 0 && ` / ${formatBytes(storage.quota)}`}
                  </span>
                </div>
                <Progress value={storage.percentage} className="h-2" />
                {storage.percentage > 80 && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="w-3 h-3" />{tr("存储空间即将用满，建议备份后清理旧数据")}</div>
                )}
              </div>

              {/* Detail breakdown */}
              {details.length > 0 && (
                <div className="space-y-2 text-xs">
                  {details.map((d, i) => (
                    <div key={i} className="p-2 rounded-md bg-muted/50 space-y-1">
                      <div className="flex justify-between font-medium">
                        <span>{d.label}</span>
                        <span>{d.count}{tr(" 项 · ")}{formatBytes(d.size)}</span>
                      </div>
                      {d.detail && (
                        <div className="text-muted-foreground whitespace-pre-wrap max-h-24 overflow-auto text-[11px] leading-relaxed">
                          {d.detail}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={handleExport}
                  disabled={loading}
                >
                  <Upload className="w-4 h-4" />{tr("导出完整备份")}</Button>

                <label>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleSelectImportFile}
                    disabled={loading}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 cursor-pointer"
                    asChild
                    disabled={loading}
                  >
                    <span>
                      <Download className="w-4 h-4" />{tr("从备份恢复")}</span>
                  </Button>
                </label>

                {/* 阅读包与整库备份是两件事：备份是「同一个库的存档还原」，
                    阅读包是「把选中的故事搬到另一台设备上读」。放在一起是因为
                    用户找「数据怎么进来」时会先翻这一页。 */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => setPackImportOpen(true)}
                  disabled={loading}
                >
                  <Package className="w-4 h-4" />{tr("导入阅读包")}</Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={handleClearTempCache}
                  disabled={loading}
                >
                  <Eraser className="w-4 h-4" />{tr("清除临时缓存")}</Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                  onClick={() => setClearDialogOpen(true)}
                  disabled={loading}
                >
                  <Trash2 className="w-4 h-4" />{tr("清空所有数据")}</Button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{tr("「清除临时缓存」只清页面间的临时编辑态，常用于切页后内容异常时自救，不影响已保存数据； 「清空所有数据」会永久删除全部角色、故事、世界书、预设、正则、总结与沙盘世界，请先备份。")}</p>
            </div>

      </div>

      <FileMaintenancePanel />
      <RecycleBinPanel />

      {/* 恢复备份前的预览确认：先看清将新增/覆盖什么，再决定写不写 */}
      <AlertDialog open={!!pendingImport} onOpenChange={(v) => { if (!v) setPendingImport(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("确认恢复备份")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("按 id 合并写入：下方「覆盖」的条目会用备份内容替换当前同 id 记录，其余现有数据保留不动。整个过程要么全部成功、要么全部不改（失败自动回滚）。 沙盘世界按整条历史恢复，同一世界较新的轮次会撤回到备份时刻；也可从世界列表导入独立备份，保留为新世界。")}</AlertDialogDescription>
          </AlertDialogHeader>

          {pendingImport && (
            <div className="space-y-2">
              {pendingImport.preview.exportedAt && (
                <p className="text-xs text-muted-foreground">{tr("备份导出于 ")}{new Date(pendingImport.preview.exportedAt).toLocaleString(getLocale())}
                </p>
              )}
              <div className="space-y-1.5 text-xs max-h-56 overflow-auto">
                {pendingImport.preview.stores
                  .filter((s) => s.add + s.overwrite + s.skipped > 0)
                  .map((s) => (
                    <div key={s.key} className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                      <span className="font-medium">{s.label}</span>
                      <span className="flex gap-2.5">
                        {s.add > 0 && <span className="text-[color:var(--status-ok)]">{tr("新增 ")}{s.add}</span>}
                        {s.overwrite > 0 && <span className="text-[color:var(--status-warn)]">{tr("覆盖 ")}{s.overwrite}</span>}
                        {s.skipped > 0 && <span className="text-muted-foreground">{tr("跳过 ")}{s.skipped}</span>}
                        {(s.remove ?? 0) > 0 && <span className="text-[color:var(--status-warn)]">{tr("撤回 ")}{s.remove}</span>}
                      </span>
                    </div>
                  ))}
                {pendingImport.preview.totalAdd + pendingImport.preview.totalOverwrite + pendingImport.preview.totalSkipped === 0 && (
                  <p className="text-muted-foreground">{tr("备份中没有可导入的有效数据。")}</p>
                )}
              </div>
              {pendingImport.preview.totalOverwrite > 0 && (
                <div className="flex items-start gap-1.5 text-xs text-[color:var(--status-warn)]">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{tr("将覆盖 ")}{pendingImport.preview.totalOverwrite}{tr(" 条现有记录（同 id）。如需保险，可先取消、「导出完整备份」留档后再恢复。")}</span>
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmImport}
              disabled={!pendingImport || pendingImport.preview.totalAdd + pendingImport.preview.totalOverwrite === 0}
            >{tr("确认恢复")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("确认清空所有数据")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("此操作不可撤销，所有本地数据（角色/故事/世界书/预设/正则/总结/沙盘世界）将被永久删除。建议先导出备份。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleClear}>{tr("确认清空")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReadingPackImportDialog
        open={packImportOpen}
        onOpenChange={setPackImportOpen}
        onImported={() => {
          void refreshStorage();
          onDataChanged?.();
        }}
      />
    </>
  );
}

export function AboutSettingsPanel() {
  useI18n();
  const { toast } = useToast();
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void getEnvironmentInfo().then(info => { if (!cancelled) setEnvironment(info); }).catch(() => {
      if (!cancelled) setEnvironment({status:'unknown',nominalPath:'',resolvedPath:null,packageIdentity:null,logAvailable:false});
    });
    return () => { cancelled = true; };
  }, []);

  const handleResetOnboarding = () => {
    // resetAllTours 已按库清理，并顺带清掉升级前遗留的无后缀键。
    // 原先这里还删了 'st-explorer-onboarding-dismissed'，那个键全仓无人读写，是死键。
    resetAllTours();
    toast({ title: tr("已重置"), description: tr("下次访问各页面时将重新显示引导（仅当前库）") });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <RotateCcw className="w-4 h-4" />{tr("引导与帮助")}</h3>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={handleResetOnboarding}
        >
          <RotateCcw className="w-4 h-4" />{tr("重新体验新手引导")}</Button>
      </section>

      <section className="space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Info className="w-4 h-4" />{tr("关于")}</h3>
        <div className="text-sm space-y-1">
          <p className="font-medium">ST Explorer</p>
          <p className="text-muted-foreground text-xs break-words" data-build-identity>{formatBuildInfo(BUILD_INFO, APP_VERSION.slice(1))}</p>
          {isTauri() && <div className="space-y-2 pt-2 text-xs">
            {/* Both environment signals missed Codex redirection in the isolated check.
                Keep collecting diagnostics without presenting an unvalidated location verdict. */}
            <Button variant="outline" size="sm" disabled={!environment?.logAvailable} onClick={() => {
              void openLogDirectory().catch(() => toast({title:tr("无法打开日志文件夹"),description:tr("请稍后重试。"),variant:'destructive'}));
            }}>{tr("打开日志文件夹")}</Button>
            <p className="text-muted-foreground">{tr("日志只记运行状态和错误类别，不记录聊天内容、角色设定或密钥。")}</p>
            {environment && !environment.logAvailable && <p className="text-muted-foreground">{tr("本次运行未能创建日志文件。")}</p>}
          </div>}
          <a
            href="https://github.com/LYC619/st-explore"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            GitHub
          </a>
          <div className="flex flex-wrap gap-4 py-2 text-xs text-primary"><a className="underline" href={`https://github.com/LYC619/st-explore/blob/HEAD/docs/USAGE${getLocale() === 'zh-CN' ? '.zh-CN' : ''}.md`} target="_blank" rel="noopener noreferrer">{tr('使用指南')}</a><a className="underline" href={`https://github.com/LYC619/st-explore/blob/HEAD/docs/DEPLOYMENT${getLocale() === 'zh-CN' ? '.zh-CN' : ''}.md`} target="_blank" rel="noopener noreferrer">{tr('部署说明')}</a></div><p className="text-xs text-muted-foreground">AGPL-3.0-only</p>
        </div>
      </section>
    </div>
  );
}
