/**
 * VaultFs 的 Tauri 实现 + 客户端环境探测 + 库根/应用配置读写。
 * 仅此文件 import @tauri-apps/*；网页版打包也会带上这些模块但永不调用（isTauri 短路）。
 */
import { invoke } from '@tauri-apps/api/core';
import { Channel } from '@tauri-apps/api/core';
import type { VaultEntry, VaultFs, VaultStat } from './fs';
import type { STImportControls } from './st-import-progress';
import { createFsMutationError, throwFsMutationError } from './fs-mutation-error';

/**
 * 是否运行在 Tauri 客户端里（网页版、Android 客户端均为 false）。
 *
 * 实现搬到了 @/lib/runtime（那里还有 isCapacitor / detectRuntime）。这里保留转发：
 * 二十多个文件从本模块导入它，为了换个导入路径去动那些文件不值得。
 */
export { isTauri } from '@/lib/runtime';
import { isTauri } from '@/lib/runtime';

interface RawEntry {
  name: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified_at: number | null;
}

interface RawStat {
  exists: boolean;
  is_dir: boolean;
  size?: number;
  modified_at?: number | null;
}

function safeRelativePath(path: string): string {
  if (path.includes('\\') || path.includes(':') || path.startsWith('/')
    || Array.from(path).some(char => char.charCodeAt(0) < 32)) {
    throwFsMutationError(createFsMutationError('unsafe-path', path, `不安全的相对路径: ${path}`));
  }
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throwFsMutationError(createFsMutationError('unsafe-path', path, `不安全的相对路径: ${path}`));
  }
  return parts.join('/');
}

/** 以 root 为库根的真实磁盘实现；root 为绝对路径（来自目录选择器） */
export function createTauriFs(root: string): VaultFs {
  const args = (path: string) => ({ root, path: safeRelativePath(path) });
  const mutate = async (command: string, path: string, extra: Record<string, unknown> = {}): Promise<void> => {
    try {
      if (!path) throwFsMutationError(createFsMutationError('unsafe-path', path, '普通文件路径不能为空'));
      await invoke(command, { ...args(path), ...extra });
    } catch (error) {
      throwFsMutationError(error, path);
    }
  };
  return {
    async list(dir): Promise<VaultEntry[]> {
      const entries = await invoke<RawEntry[]>('vault_list_dir', args(dir));
      return entries.map((e) => ({
        name: e.name,
        isDir: e.is_dir,
        isSymlink: e.is_symlink,
        size: e.size,
        ...(e.modified_at == null ? {} : { modifiedAt: e.modified_at }),
      }));
    },
    readText: (path) => invoke('vault_read_text', args(path)),
    writeText: (path, content) => invoke('vault_write_text', { ...args(path), content }),
    readBinary: (path) => invoke('vault_read_binary', args(path)),
    writeBinary: (path, base64) => invoke('vault_write_binary', { ...args(path), base64 }),
    removeFile: (path) => mutate('vault_remove_file', path),
    trashFile: (path) => mutate('vault_trash_file', path),
    openPath: (path, reveal = false) => invoke('vault_open_path', { ...args(path), reveal }),
    removeEmptyDir: (path) => invoke('vault_remove_empty_dir', args(path)),
    rename: (from, to) => invoke('vault_rename', { root, from: safeRelativePath(from), to: safeRelativePath(to) }),
    mkdir: (path) => invoke('vault_mkdir', args(path)),
    async stat(path): Promise<VaultStat> {
      const value = await invoke<RawStat>('vault_stat', args(path));
      return { exists: value.exists, isDir: value.is_dir, ...(value.size === undefined ? {} : { size: value.size }),
        ...(value.modified_at == null ? {} : { modifiedAt: value.modified_at }) };
    },
  };
}

/** 按绝对路径读文本（库外文件，如 ST 目录里的聊天；7.4 检查更新用） */
export function readAbsText(path: string): Promise<string> {
  return invoke('vault_read_abs_text', { path });
}

export interface PickedChatFile {
  name: string;
  base64: string;
}

/**
 * 客户端原生「选一个聊天文件」；网页版和 Android 客户端返回 null，
 * 由调用方回退到隐藏 <input type=file>。
 *
 * TODO(capacitor): Android 上隐藏 input 其实能用（系统文件选择器会弹），
 * 所以这条回退是通的，不必急着接 @capacitor/filesystem。真要改的是导入之后往哪写
 * ——那部分卡在库后端上，见 vault/bootstrap.ts 的 TODO。
 */
export async function pickChatFile(): Promise<PickedChatFile | null> {
  if (!isTauri()) return null;
  return (await invoke<{ name: string; base64: string } | null>('pick_chat_file')) ?? null;
}

/** 客户端原生文件选择器；网页版和 Android 客户端返回 null，由调用方回退隐藏 input。 */
export async function pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ multiple: false, directory: false, filters });
  return typeof selected === 'string' ? selected : null;
}

/** 按绝对路径写文本（7.5 写回 ST 用；Rust 侧临时文件+rename 原子写） */
export function writeAbsText(path: string, content: string): Promise<void> {
  return invoke('vault_write_abs_text', { path, content });
}

/** Select and write one export in Rust; an ordinary Save dialog does not authorize a vault root. */
export function saveTextExport(output: { fileName: string; extension: string; content: string }): Promise<boolean> {
  return invoke('save_text_export', output);
}

export function saveBinaryExport(output: { fileName: string; extension: 'png'; base64: string }): Promise<boolean> {
  return invoke('save_binary_export', output);
}

/** 按绝对路径写二进制（阅读包导出用）。载荷走 base64——zip 塞不进 String。 */
export function writeAbsBytes(path: string, bytes: Uint8Array): Promise<void> {
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return invoke('vault_write_abs_binary', { path, base64: btoa(bin) });
}

// ---- 应用配置（系统配置目录 config.json，不进库；API Key 后续同通道）----

export async function getAppConfig<T>(key: string): Promise<T | null> {
  return (await invoke<T | null>('config_get', { key })) ?? null;
}

export async function setAppConfig(key: string, value: unknown): Promise<void> {
  await invoke('config_set', { key, value });
}

const INVALID_APP_CONFIG_PREFIX = 'STE_CONFIG_INVALID:';

export function isInvalidAppConfigError(error: unknown): boolean {
  return String(error).includes(INVALID_APP_CONFIG_PREFIX);
}

/** 仅在配置无法解析时调用：Rust 侧先生成同目录备份，再把 config.json 重置为空对象。 */
export async function repairAppConfig(): Promise<string | null> {
  return (await invoke<string | null>('config_repair')) ?? null;
}

const VAULT_ROOT_KEY = 'vaultRoot';

export function getVaultRoot(): Promise<string | null> {
  return getAppConfig<string>(VAULT_ROOT_KEY);
}

export async function setVaultRoot(path: string): Promise<void> {
  await setAppConfig(VAULT_ROOT_KEY, path);
}

export interface PreparedSTBackup {
  root: string;
  displayName: string;
  /** 解压时跳过的 secrets.json 数量；>0 时界面上要如实说明「这个没读」。 */
  skippedSecrets: number;
}

/** Rust 侧 ExtractProgress 的镜像；stage 与 STImportPhase 的前两档同名。 */
interface RawExtractProgress {
  stage: 'validate' | 'extract';
  done: number;
  total: number;
  label: string;
}

/**
 * 选择并解压一个 SillyTavern zip；返回只在本次导入期间有效的临时根目录。
 *
 * 用户在文件对话框点取消、或解压中途点取消，都返回 null —— 两种都是用户主动收场，
 * 不该弹错误提示。解压半截的临时目录由 Rust 侧清掉。
 */
let backupPreparation: Promise<unknown> = Promise.resolve();
const pendingBackupCleanup = new Set<string>();
const backupCleanupInFlight = new Map<string, Promise<void>>();

export function pickSTBackupImport(
  controls: STImportControls = {},
): Promise<PreparedSTBackup | null> {
  const run = backupPreparation.then(async () => {
    if (controls.signal?.aborted) return null;
    for (const root of pendingBackupCleanup) await cleanupSTBackupImport(root);
    if (controls.signal?.aborted) return null;
    return prepareSTBackupImport(controls);
  });
  // The native cancellation flag belongs to one preparation at a time, including after unmount.
  backupPreparation = run.catch(() => {});
  return run;
}

async function prepareSTBackupImport(controls: STImportControls): Promise<PreparedSTBackup | null> {
  const { onProgress, signal } = controls;
  const onProgressChannel = new Channel<RawExtractProgress>();
  if (onProgress) {
    onProgressChannel.onmessage = (message) => {
      onProgress({
        phase: message.stage,
        done: message.done,
        total: message.total,
        label: message.label,
      });
    };
  }
  // 取消要能打断已经在跑的解压：置 Rust 侧旗标，解压循环下一条就退出。
  let cancellation: Promise<unknown> | undefined;
  const abort = () => {
    cancellation ??= invoke('cancel_st_backup_import').catch(() => {});
  };
  signal?.addEventListener('abort', abort);
  try {
    const value = await invoke<{ root: string; display_name: string; skipped_secrets: number } | null>(
      'prepare_st_backup_import',
      { onProgress: onProgressChannel },
    );
    return value
      ? { root: value.root, displayName: value.display_name, skippedSecrets: value.skipped_secrets ?? 0 }
      : null;
  } finally {
    signal?.removeEventListener('abort', abort);
    await cancellation;
  }
}

/** 清理 pickSTBackupImport 创建的一次性临时根目录。 */
export function cleanupSTBackupImport(root: string): Promise<void> {
  const pending = backupCleanupInFlight.get(root);
  if (pending) return pending;
  pendingBackupCleanup.add(root);
  const cleanup = invoke<void>('cleanup_st_backup_import', { root })
    .then(() => { pendingBackupCleanup.delete(root); })
    .finally(() => { backupCleanupInFlight.delete(root); });
  backupCleanupInFlight.set(root, cleanup);
  return cleanup;
}

/** 弹系统目录选择器；用户取消返回 null */
export async function pickDirectory(
  title: string,
  options: { persistAuthorization?: boolean } = {},
): Promise<string | null> {
  return (await invoke<string | null>('vault_pick_authorized_directory', {
    title,
    persistent: options.persistAuthorization ?? false,
  })) ?? null;
}
