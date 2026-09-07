/**
 * 角色关联文件存取（0830 反馈条目 6）。
 *
 * 真源：ArchiveCharacter.attachments（随 档案.json 整对象往返）；
 * 字节存 `<角色文件夹>/附件/<文件名>`，条目只记相对路径。
 *
 * **客户端专有**。网页版没有文件库（getActiveVault 恒为 null），
 * 而这里收的是 html、视频这类东西——塞进 IndexedDB 当 base64 存不划算，
 * 也没法交给外部程序打开。所以网页版这一区直接说明「需要客户端」，不做半套。
 *
 * 预览分档沿用「其他资产」那套 classifyArchivePreview（图片/JSON/文本/不支持），
 * 不另写一份扩展名表：html 落在 text 档 = 只给源码，不执行页面里的脚本。
 * 音视频与其他二进制归 external 档，交给系统默认程序。
 *
 * 变更函数返回 Partial<ArchiveCharacter> patch，由页面统一 patchCharacter 落库。
 */
import type { ArchiveCharacter, AttachedFile } from '@/types/archive';
import { readCharacterInQueue, updateCharacter } from '@/lib/archive-db';
import type { PersistCharacterPatch } from '@/lib/character-write';
import { getActiveVault } from '@/lib/vault/active';
import type { VaultBackend } from '@/lib/vault/vault-backend';
import { joinPath } from '@/lib/vault/fs';
import { attachmentFileName, resolveAttachmentRelativePath } from '@/lib/vault/character-relative-path';
import { throwFsMutationError } from '@/lib/vault/fs-mutation-error';
import { classifyArchivePreview, type ArchivePreviewKind } from '@/lib/vault/other-assets';
import { uniqueFileName } from '@/lib/portrait-store';

export const ATTACHMENT_DIR = '附件';

/** 展示档位：前三档内部预览（复用其他资产的预览组件），external 只能交给外部程序 */
export type AttachmentTier = 'image' | 'json' | 'text' | 'external';

const MEDIA_EXTENSIONS = new Set([
  'mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'flv',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac',
]);

/** 是不是音视频（external 档里单独认一下，好在列表上给个准确图标） */
export function isMediaAttachment(name: string): boolean {
  return MEDIA_EXTENSIONS.has(name.toLowerCase().split('.').pop() ?? '');
}

/**
 * 文件 → 展示档位。directory/unsupported 都归 external：
 * 前者不该出现（只收文件），后者本来就是「客户端内预览不了」。
 */
export function attachmentTier(name: string, size: number): AttachmentTier {
  const kind: ArchivePreviewKind = classifyArchivePreview({ name, size });
  return kind === 'image' || kind === 'json' || kind === 'text' ? kind : 'external';
}

// ---------- IO ----------

interface VaultCtx {
  vault: VaultBackend;
  /** 角色文件夹相对路径 */
  dir: string;
}

/** 客户端且角色已入库 → vault 上下文；否则 null（网页版无附件功能） */
async function vaultCtx(characterId: string, vault = getActiveVault()): Promise<VaultCtx | null> {
  if (!vault) return null;
  const dir = await vault.pathOf('characters', characterId);
  return dir ? { vault, dir } : null;
}

/** 附件功能是否可用（网页版 false，UI 据此换成说明文案） */
export function attachmentsSupported(): boolean {
  return getActiveVault() !== null;
}

/** 外部打开能力是否可用（内存实现的库也没有，所以按 fs 上有没有这个方法判断） */
export function externalOpenSupported(): boolean {
  return !!getActiveVault()?.fs.openPath;
}

export interface AttachmentView extends AttachedFile {
  tier: AttachmentTier;
  /** 文件还在不在磁盘上（被用户挪走时记录保留，只标缺失） */
  missing: boolean;
  /** 以磁盘为准的体积；缺失时回落到记录里的 size */
  actualSize: number;
  /** 当前角色目录内的解析结果；不作为后续 mutation 的授权输入 */
  resolvedPath?: string;
  characterId: string;
}

/**
 * 读出附件展示视图。**不读文件字节**——只列一次目录清单核对存在与体积，
 * 预览内容等用户点开某一条时再读（视频那种体积不能顺手加载）。
 */
export async function loadAttachmentViews(c: ArchiveCharacter): Promise<AttachmentView[]> {
  const records = c.attachments ?? [];
  if (records.length === 0) return [];
  const ctx = await vaultCtx(c.id);
  const found = ctx
    ? new Map((await ctx.vault.fs.list(joinPath(ctx.dir, ATTACHMENT_DIR)))
      .filter((entry) => !entry.isDir && !entry.isSymlink)
      .map((entry) => [entry.name, entry.size] as const))
    : new Map<string, number>();
  return records.map((record) => {
    const relative = resolveAttachmentRelativePath(record);
    const fileName = relative ? attachmentFileName(record) : undefined;
    const size = fileName ? found.get(fileName) : undefined;
    const actualSize = size ?? record.size;
    return {
      ...record,
      characterId: c.id,
      ...(relative ? { resolvedPath: joinPath(ctx?.dir ?? '', relative) } : {}),
      tier: attachmentTier(fileName ?? record.title, actualSize),
      missing: relative === undefined || size === undefined,
      actualSize,
    };
  });
}

function resolveRecordPath(ctx: VaultCtx, character: ArchiveCharacter | undefined, attachmentId: string) {
  const record = character?.attachments?.find(item => item.id === attachmentId);
  if (!record) throw new Error('附件不存在');
  const relative = resolveAttachmentRelativePath(record);
  if (!relative) throwFsMutationError({ code: 'unsafe-path', path: record.path, message: '附件路径格式无效' }, record.path);
  return { path: joinPath(ctx.dir, relative), record };
}

async function requireAttachmentFile(ctx: VaultCtx, path: string) {
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const entries = await ctx.vault.fs.list(joinPath(ctx.dir, ATTACHMENT_DIR));
  const entry = entries.find(item => item.name === fileName);
  if (!entry) throwFsMutationError({ code: 'not-found', path, message: '附件文件不存在' });
  if (entry.isSymlink) throwFsMutationError({ code: 'unsafe-path', path, message: '附件不能是符号链接' });
  if (entry.isDir) throwFsMutationError({ code: 'not-file', path, message: '附件必须是普通文件' });
  return entry;
}

interface ResolvedAttachment {
  path: string;
  record: AttachedFile;
  ctx: VaultCtx;
  fileName: string;
  size: number;
}

async function withAttachmentFile<T>(
  characterId: string,
  attachmentId: string,
  access: (resolved: ResolvedAttachment) => Promise<T>,
): Promise<T> {
  return readCharacterInQueue(characterId, async (character, { vault }) => {
    if (!vault) throw new Error('当前环境不支持读取关联文件');
    const ctx = await vaultCtx(characterId, vault);
    if (!ctx) throw new Error('角色档案不存在');
    const resolved = resolveRecordPath(ctx, character, attachmentId);
    const entry = await requireAttachmentFile(ctx, resolved.path);
    return access({ ...resolved, ctx, fileName: entry.name, size: entry.size });
  });
}

export async function getAttachmentPath(characterId: string, attachmentId: string): Promise<string> {
  return withAttachmentFile(characterId, attachmentId, async resolved => resolved.path);
}

export async function readAttachment(characterId: string, attachmentId: string): Promise<{ path: string; record: AttachedFile; fileName: string; tier: AttachmentTier; text?: string; base64?: string }> {
  return withAttachmentFile(characterId, attachmentId, async ({ ctx, size, ...resolved }) => {
    const tier = attachmentTier(resolved.fileName, size);
    if (tier === 'external') throw new Error('此文件格式或大小不支持内部预览，请用外部程序打开');
    try {
      if (tier === 'image') return { ...resolved, tier, base64: await ctx.vault.fs.readBinary(resolved.path) };
      return { ...resolved, tier, text: await ctx.vault.fs.readText(resolved.path) };
    } catch (error) {
      throwFsMutationError(error, resolved.path);
    }
  });
}

/** 导入文件到 `<角色文件夹>/附件/`；撞名自动改名，逐个失败只计数不中断 */
export async function addAttachmentFiles(
  c: ArchiveCharacter,
  files: File[],
): Promise<{ patch: Partial<ArchiveCharacter>; ok: number; fail: number }> {
  const ctx = await vaultCtx(c.id);
  if (!ctx) return { patch: {}, ok: 0, fail: files.length };
  const dir = joinPath(ctx.dir, ATTACHMENT_DIR);
  const taken = new Set((await ctx.vault.fs.list(dir)).map((entry) => entry.name));
  const added: AttachedFile[] = [];
  let fail = 0;
  for (const file of files) {
    try {
      const fileName = uniqueFileName(taken, file.name);
      await ctx.vault.fs.writeBinary(joinPath(dir, fileName), await blobToBase64(file));
      taken.add(fileName);
      added.push({
        id: crypto.randomUUID(),
        title: file.name,
        path: joinPath(ATTACHMENT_DIR, fileName),
        pathBase: 'character',
        size: file.size,
        addedAt: Date.now(),
      });
    } catch {
      fail++;
    }
  }
  if (added.length === 0) return { patch: {}, ok: 0, fail };
  return {
    patch: { attachments: [...(c.attachments ?? []), ...added] },
    ok: added.length,
    fail,
  };
}

/**
 * 移除一条附件。deleteFile=true 时文件进系统回收站（捞得回来），
 * false 只撤记录、文件原样留在 附件/ 里。文件缺失或物理删除失败时保留记录。
 */
export async function removeAttachment(
  characterId: string,
  id: string,
  deleteFile: boolean,
  persist: PersistCharacterPatch = updateCharacter,
): Promise<ArchiveCharacter> {
  let deletedPath: string | undefined;
  try {
    const saved = await persist(characterId, async (current, context) => {
      const records = current.attachments ?? [];
      if (!records.some(record => record.id === id)) throw new Error('附件不存在');
      if (deleteFile) {
        const ctx = await vaultCtx(characterId, context.vault);
        if (!ctx) throw new Error('当前环境不支持删除关联文件');
        const { path } = resolveRecordPath(ctx, current, id);
        await requireAttachmentFile(ctx, path);
        const fs = ctx.vault.fs;
        try {
          await (fs.trashFile ? fs.trashFile(path) : fs.removeFile(path));
        } catch (error) {
          throwFsMutationError(error, path);
        }
        deletedPath = path;
      }
      return { attachments: records.filter(record => record.id !== id) };
    });
    if (!saved) throw new Error('角色档案不存在');
    return saved;
  } catch (error) {
    if (deletedPath) {
      throw Object.assign(new Error('文件已删除，但附件记录未能更新。请重试仅移除失效记录。'), {
        code: 'attachment-metadata-failed', characterId, attachmentId: id, path: deletedPath, cause: error,
      });
    }
    throw error;
  }
}

/** 重命名附件的显示名（不动磁盘文件名：外部程序、快捷方式还指着原路径） */
export function renameAttachment(c: ArchiveCharacter, id: string, title: string): Partial<ArchiveCharacter> {
  const next = title.trim();
  if (!next) throw new Error('附件名称不能为空');
  const records = c.attachments ?? [];
  if (!records.some((record) => record.id === id)) throw new Error('附件不存在');
  return { attachments: records.map((record) => (record.id === id ? { ...record, title: next } : record)) };
}

/** 交给系统默认程序打开；网页版/内存库没有这个能力，调用前先看 externalOpenSupported */
export async function openAttachmentExternally(characterId: string, id: string, reveal = false): Promise<void> {
  return withAttachmentFile(characterId, id, async ({ ctx, path }) => {
    if (!ctx.vault.fs.openPath) throw new Error('当前环境不支持调用外部程序');
    try {
      await ctx.vault.fs.openPath(path, reveal);
    } catch (error) {
      throwFsMutationError(error, path);
    }
  });
}

/** Blob → 纯 base64（与 portrait-store 同一条路：FileReader 在浏览器与 jsdom 都有） */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
