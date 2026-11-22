/**
 * SillyTavern 接入流程协调器。
 * 目录选择与导入执行留在这里，扫描选择和结果展示由独立弹窗负责。
 */
import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, FolderSearch, Loader2 } from 'lucide-react';
import { STImportProgressDialog } from '@/components/tools/st-import/STImportProgressDialog';
import { STImportResultDialog } from '@/components/tools/st-import/STImportResultDialog';
import { STImportSelectionDialog } from '@/components/tools/st-import/STImportSelectionDialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  createAllImportPicks,
  createEmptyImportPicks,
  IMPORT_POLICY_SUMMARY,
  type STImportPicks,
} from '@/lib/vault/st-import-presentation';
import { isSTImportAborted, type STImportProgress } from '@/lib/vault/st-import-progress';
import { importSelected, scanSTUserDir, type STImportSummary, type STScanResult } from '@/lib/vault/st-import';
import {
  cleanupSTBackupImport,
  createTauriFs,
  isTauri,
  pickDirectory,
  pickSTBackupImport,
  setAppConfig,
} from '@/lib/vault/tauri-fs';
import type { VaultFs } from '@/lib/vault/fs';
import { getActiveVault } from '@/lib/vault/active';
import { VAULT_CHANGED_EVENT } from '@/lib/vault/vault-registry-store';

interface ScanState {
  vault: ReturnType<typeof getActiveVault>;
  root: string;
  fs: VaultFs;
  scan: STScanResult;
  sourceLabel?: string;
  skippedSecrets?: number;
  cleanup?: () => Promise<void>;
}

interface STImportCardProps {
  onChanged?: () => void;
  variant?: 'full' | 'compact';
  /** 设置页传入已保存路径时，紧凑按钮直接重扫，不再重复弹目录选择器。 */
  root?: string | null;
}

export function STImportCard({ onChanged, variant = 'full', root }: STImportCardProps) {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [state, renderState] = useState<ScanState | null>(null);
  const stateRef = useRef<ScanState | null>(null);
  const setState = (next: ScanState | null) => { stateRef.current = next; renderState(next); };
  const [picks, setPicks] = useState<STImportPicks>(createEmptyImportPicks());
  const [result, setResult] = useState<STImportSummary | null>(null);
  const [progress, setProgress] = useState<STImportProgress | null>(null);
  const [canceling, setCanceling] = useState(false);
  // 每一轮（解压+扫描、或入库）一个 controller；用 ref 是因为取消按钮要拿到
  // 当前这一轮的那个，而它不该触发重渲染。
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const importingState = useRef<ScanState | null>(null);

  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      abortRef.current?.abort();
      abortRef.current = null;
      const pending = stateRef.current;
      stateRef.current = null;
      if (pending && pending !== importingState.current) {
        void pending.cleanup?.().catch(error => {
          toast({ title: '清理临时导入文件失败', description: String(error), variant: 'destructive' });
        });
      }
    };
    const onVaultChange = () => {
      invalidate();
      renderState(null);
      setResult(null);
      setScanning(false);
      setImporting(false);
      setProgress(null);
      setCanceling(false);
    };
    window.addEventListener(VAULT_CHANGED_EVENT, onVaultChange);
    return () => {
      mounted.current = false;
      window.removeEventListener(VAULT_CHANGED_EVENT, onVaultChange);
      invalidate();
    };
  }, [toast]);

  const notifyChanged = () => {
    try { onChanged?.(); } catch { /* UI 刷新不能把成功导入误报为失败 */ }
  };

  /** 开一轮可取消的流程，返回配好的 controls。 */
  const beginRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    const vault = getActiveVault();
    abortRef.current = controller;
    setCanceling(false);
    setProgress(null);
    const isCurrent = () => mounted.current && abortRef.current === controller && getActiveVault() === vault;
    return {
      signal: controller.signal,
      isCurrent,
      vault,
      onProgress: (next: STImportProgress) => { if (isCurrent()) setProgress(next); },
    };
  };

  const endRun = (controls: ReturnType<typeof beginRun>) => {
    if (!controls.isCurrent()) return;
    abortRef.current = null;
    setCanceling(false);
    setProgress(null);
  };

  const requestCancel = () => {
    setCanceling(true);
    abortRef.current?.abort();
  };

  const closeScan = async (current: ScanState | null) => {
    setState(null);
    if (!current?.cleanup) return;
    try {
      await current.cleanup();
    } catch (err) {
      toast({ title: '清理临时导入文件失败', description: String(err), variant: 'destructive' });
    }
  };

  if (!isTauri()) return null;

  const handlePick = async () => {
    setScanning(true);
    const controls = beginRun();
    try {
      const selectedRoot = root ?? await pickDirectory(
        '选择 SillyTavern 目录（安装根目录或 data/default-user）',
        { persistAuthorization: true, purpose: 'source' },
      );
      if (!selectedRoot || !controls.isCurrent() || controls.signal.aborted) return;
      const fs = createTauriFs(selectedRoot);
      const scan = await scanSTUserDir(fs, controls);
      if (!controls.isCurrent() || controls.signal.aborted) return;
      if (!scan.characters.length && !scan.strayChats.length && !scan.worldbooks.length && !scan.presets.length
        && !scan.regex && !scan.archives.length && scan.relationships.status !== 'parsed') {
        const warningPaths = scan.warnings.slice(0, 3).map((warning) => warning.path).join('；');
        toast({
          title: scan.warnings.length ? '未发现可安全导入的内容' : '没有找到 ST 内容',
          description: scan.warnings.length
            ? `已跳过 ${scan.warnings.length} 项：${warningPaths}${scan.warnings.length > 3 ? '；…' : ''}`
            : '这个文件夹里没有找到角色卡、聊天记录或世界书，请重新定位到 SillyTavern 安装目录或用户目录（如 data/default-user）。',
          variant: 'destructive',
        });
        return;
      }

      await setAppConfig('stRoot', selectedRoot);
      if (!controls.isCurrent() || controls.signal.aborted) return;
      setPicks(createAllImportPicks(scan));
      setState({ root: selectedRoot, fs, scan, vault: controls.vault });
    } catch (err) {
      // 用户自己点的取消，不是故障，不弹错误
      if (controls.isCurrent() && !isSTImportAborted(err)) {
        toast({ title: '扫描失败', description: String(err), variant: 'destructive' });
      }
    } finally {
      if (controls.isCurrent()) setScanning(false);
      endRun(controls);
    }
  };

  const handlePickBackup = async () => {
    setScanning(true);
    const controls = beginRun();
    let prepared: Awaited<ReturnType<typeof pickSTBackupImport>> = null;
    let transferred = false;
    try {
      prepared = await pickSTBackupImport(controls);
      // null = 用户在文件对话框点了取消，或解压中途点了取消，两种都静默收场
      if (!prepared || !controls.isCurrent() || controls.signal.aborted) return;
      const fs = createTauriFs(prepared.root);
      const scan = await scanSTUserDir(fs, controls);
      if (!controls.isCurrent() || controls.signal.aborted) return;
      if (!scan.characters.length && !scan.strayChats.length && !scan.worldbooks.length && !scan.presets.length
        && !scan.regex && !scan.archives.length && scan.relationships.status !== 'parsed') {
        throw new Error('没有找到可导入的 SillyTavern 内容');
      }
      setPicks(createAllImportPicks(scan));
      setState({
        vault: controls.vault,
        root: prepared.root,
        fs,
        scan,
        sourceLabel: prepared.displayName,
        skippedSecrets: prepared.skippedSecrets,
        cleanup: () => cleanupSTBackupImport(prepared!.root),
      });
      transferred = true;
    } catch (err) {
      if (String(err).includes('STE_ST_IMPORT_CLEANUP_FAILED:')) {
        toast({ title: '清理临时导入文件失败', description: String(err), variant: 'destructive' });
      } else if (controls.isCurrent() && !isSTImportAborted(err)) {
        toast({ title: '读取 SillyTavern 备份失败', description: String(err), variant: 'destructive' });
      }
    } finally {
      if (prepared && !transferred) {
        try { await cleanupSTBackupImport(prepared.root); }
        catch (err) {
          toast({ title: '清理临时导入文件失败', description: String(err), variant: 'destructive' });
        }
      }
      if (controls.isCurrent()) setScanning(false);
      endRun(controls);
    }
  };

  const handleImport = async () => {
    if (!state) return;
    const current = state;
    if (current.vault !== getActiveVault()) { await closeScan(current); return; }
    importingState.current = current;
    setImporting(true);
    const controls = beginRun();
    try {
      const { scan } = current;
      const summary = await importSelected(current.fs, {
        stRoot: current.root,
        sourceLabel: current.sourceLabel,
        characters: scan.characters.filter((character) => picks.chars.has(character.pngPath)),
        strayChats: scan.strayChats.filter((chat) => picks.strays.has(chat.path)),
        worldbooks: scan.worldbooks.filter((worldbook) => picks.wbs.has(worldbook.path)),
        presets: scan.presets.filter((preset) => picks.presets.has(preset.path)),
        regex: picks.regex ? scan.regex : null,
        archives: scan.archives.filter((group) => picks.archives.has(group.kind)),
        relationships: picks.settingsRelations ? scan.relationships : undefined,
        scanWarnings: scan.warnings,
      }, controls);
      if (!controls.isCurrent()) return;
      const parts = [
        `角色 ${summary.characters}`,
        `故事 ${summary.stories}`,
        `世界书 ${summary.worldbooks}`,
        `预设 ${summary.presets}`,
      ];
      if (summary.regexes) parts.push(`正则规则集 ${summary.regexes}`);
      if (summary.archivedFiles) parts.push(`其他资产 ${summary.archivedFiles} 个文件`);
      if (summary.relationships) parts.push(`恢复关联 ${summary.relationships}`);
      if (summary.unresolvedRelationships.length) parts.push(`未解析关联 ${summary.unresolvedRelationships.length}`);
      if (summary.skipped) parts.push(`跳过已导入 ${summary.skipped}`);
      if (summary.failed) parts.push(`处理失败 ${summary.failed}`);
      setState(null);
      // 中途取消也算走完一轮：已写入的部分要照常汇报，不能装作没发生
      toast({
        title: summary.aborted
          ? '导入已停止，已写入的内容已保留'
          : (current.sourceLabel ? `${current.sourceLabel}导入完成` : '导入完成'),
        description: parts.join('，'),
      });
      setResult(summary);
    } catch (err) {
      if (controls.isCurrent()) toast({ title: '导入失败', description: String(err), variant: 'destructive' });
    } finally {
      try { await current.cleanup?.(); } catch (err) {
        toast({ title: '清理临时导入文件失败', description: String(err), variant: 'destructive' });
      }
      if (importingState.current === current) importingState.current = null;
      if (controls.isCurrent()) {
        setState(null);
        setImporting(false);
      }
      endRun(controls);
    }
  };

  const handleResultClose = () => {
    setResult(null);
    // 首页会在这里刷新。把通知延后到结果弹窗关闭，避免父级因 stRoot 已配置而卸载
    // 当前卡片，导致用户刚打开的处理明细随组件一起消失。
    notifyChanged();
  };

  return (
    <>
      {variant === 'full' ? (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <FolderSearch className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 basis-[14rem] grow">
            <p className="text-sm font-medium">接入 SillyTavern</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              指定 ST 目录，按类别选择角色、聊天、世界书、预设、正则、扩展和媒体。{IMPORT_POLICY_SUMMARY}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handlePick} disabled={scanning || importing}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FolderSearch className="mr-1 h-4 w-4" />}
            选择 ST 目录
          </Button>
          <Button variant="outline" size="sm" onClick={handlePickBackup} disabled={scanning || importing}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-1 h-4 w-4" />}
            从 SillyTavern 备份导入
          </Button>
        </Card>
      ) : (
        <>
          {root && (
            <Button variant="outline" size="sm" onClick={handlePick} disabled={scanning || importing}>
              {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FolderSearch className="mr-1 h-4 w-4" />}
              重新扫描并选择
            </Button>
          )}
          {/* 云端/别机导出的 zip 不需要先接目录，设置页也要给这个入口（0826 反馈 1） */}
          <Button variant="outline" size="sm" onClick={handlePickBackup} disabled={scanning || importing}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArchiveRestore className="mr-1 h-4 w-4" />}
            从 SillyTavern 备份导入
          </Button>
        </>
      )}

      {state && (
        <STImportSelectionDialog
          root={state.root}
          scan={state.scan}
          picks={picks}
          importing={importing}
          progress={importing ? progress : null}
          canceling={canceling}
          skippedSecrets={state.skippedSecrets}
          onPicksChange={setPicks}
          onCancel={() => {
            // 导入中 = 中断本次写入；还没开始 = 关掉弹窗并清临时目录
            if (importing) requestCancel();
            else void closeScan(state);
          }}
          onImport={handleImport}
        />
      )}
      {/* 解压/扫描阶段：选择弹窗还没出来，用独立进度弹窗顶上 */}
      {!state && !importing && (
        <STImportProgressDialog progress={progress} canceling={canceling} onCancel={requestCancel} />
      )}
      <STImportResultDialog result={result} onClose={handleResultClose} />
    </>
  );
}
