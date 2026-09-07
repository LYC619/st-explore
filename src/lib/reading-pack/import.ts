/**
 * 阅读包解析与导入。
 *
 * 两段式，和整库备份（lib/storage-utils）一致：先 parse + preview 让用户看清要写什么、
 * 会覆盖什么，确认了再 apply。理由不只是礼貌——导入会覆盖本地条目，而移动端上
 * 本地条目里攒着用户自己的阅读进度和评分。
 *
 * 去重策略：按 id 匹配，`updatedAt` 新的赢（last-write-wins），但**本地阅读进度永远保留**。
 * 三个考虑：
 * 1. 重复导入同一个包 = 无操作（包里的 updatedAt 不比本地新），不会把用户后来打的分冲掉。
 * 2. 电脑上确实改过内容（updatedAt 更新）时才覆盖，符合「电脑是工作台」的分工。
 * 3. 但 lastFloor/lastViewedAt/lastViewedBranchId 是「这台设备读到哪」，不是内容。
 *    覆盖它们等于把读者的书签撕了，所以无论谁新都保留本地值。
 */
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import type { ArchiveCharacter, ArchiveStory, PortraitRow, StoryBranch } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
import {
  MAX_READING_PACK_BYTES, PACK_CHARACTER_DIR, PACK_MANIFEST_PATH, PACK_MEDIA_DIR,
  MAX_READING_PACK_ENTRIES, MAX_READING_PACK_ENTRY_BYTES,
  MAX_READING_PACK_UNCOMPRESSED_BYTES, MAX_READING_PACK_JSON_BYTES,
  PACK_STORY_DIR, PACK_SUMMARY_DIR, READING_PACK_FORMAT,
  type PackCharacter, type PackPortraitRow, type PackStory, type ParsedReadingPack, type ReadingPackManifest,
} from '@/types/reading-pack';
import { bytesToBase64 } from '@/lib/utils';
import { crc32 } from '@/lib/png-writer';

const READING_PACK_ERROR_CODES = [
  'input-too-large', 'entry-limit', 'entry-too-large', 'uncompressed-limit',
  'invalid-path', 'duplicate-entry', 'unsupported-compression', 'truncated-zip',
  'invalid-format', 'cancelled',
] as const;
export type ReadingPackErrorCode = (typeof READING_PACK_ERROR_CODES)[number];

export class ReadingPackError extends Error {
  constructor(public readonly code: ReadingPackErrorCode, message: string) {
    super(message);
    this.name = 'ReadingPackError';
  }
}

export function isReadingPackError(value: unknown): value is Pick<ReadingPackError, 'code' | 'message'> {
  if (typeof value !== 'object' || value === null) return false;
  const error = value as { code?: unknown; message?: unknown };
  return typeof error.message === 'string'
    && READING_PACK_ERROR_CODES.includes(error.code as ReadingPackErrorCode);
}

export interface UnzipBudget {
  maxInputBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxJsonBytes: number;
}

export const DEFAULT_LIMITS: Readonly<UnzipBudget> = Object.freeze({
  maxInputBytes: MAX_READING_PACK_BYTES,
  maxEntries: MAX_READING_PACK_ENTRIES,
  maxEntryBytes: MAX_READING_PACK_ENTRY_BYTES,
  maxUncompressedBytes: MAX_READING_PACK_UNCOMPRESSED_BYTES,
  maxJsonBytes: MAX_READING_PACK_JSON_BYTES,
});

function checkLimit(value: number, limit: number, code: ReadingPackErrorCode, label: string): void {
  if (value > limit) throw new ReadingPackError(code, `${label} ${value}，上限 ${limit}`);
}

function validatePackEntryName(name: string): string {
  const parts = name.split('/');
  if (/[\\:]/.test(name) || name.includes('\0')
    || parts.some(part => !part || part === '.' || part === '..' || part.length > 255)) {
    throw new ReadingPackError('invalid-path', `不安全条目路径：${name}`);
  }
  if (name === PACK_MANIFEST_PATH) return name;
  if (parts.length !== 2 || ![
    PACK_CHARACTER_DIR, PACK_STORY_DIR, PACK_SUMMARY_DIR, PACK_MEDIA_DIR,
  ].includes(parts[0])) throw new ReadingPackError('invalid-path', `未知条目路径：${name}`);
  return name;
}

function checkEntrySize(path: string, size: number, limits: UnzipBudget): void {
  checkLimit(size, limits.maxEntryBytes, 'entry-too-large', `条目 ${path} 展开字节`);
  if (path.endsWith('.json') && !path.startsWith(`${PACK_MEDIA_DIR}/`)) {
    checkLimit(size, limits.maxJsonBytes, 'entry-too-large', `JSON ${path} 字节`);
  }
}

interface ZipEndRecord { entryCount: number; centralOffset: number; eocdOffset: number }

function readZipEndRecord(bytes: Uint8Array): ZipEndRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50
      || offset + 22 + view.getUint16(offset + 20, true) !== bytes.length) continue;
    const entryCount = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new ReadingPackError('invalid-format', '不支持 ZIP64 阅读包');
    }
    if (view.getUint16(offset + 4, true) !== 0 || view.getUint16(offset + 6, true) !== 0
      || view.getUint16(offset + 8, true) !== entryCount || centralOffset + centralSize !== offset) continue;
    return { entryCount, centralOffset, eocdOffset: offset };
  }
  throw new ReadingPackError('truncated-zip', 'ZIP 缺少完整的中央目录结束记录');
}

interface ZipEntry { size: number; compression: number; checksum: number }

// fflate streams local headers; validate the central directory and their agreement before decoding.
function validateZipCentralDirectory(bytes: Uint8Array, limits: UnzipBudget): Map<string, ZipEntry> {
  const end = readZipEndRecord(bytes);
  checkLimit(end.entryCount, limits.maxEntries, 'entry-limit', '条目数');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, ZipEntry>();
  let offset = end.centralOffset;
  let declaredTotal = 0;
  const localRanges: { start: number; end: number }[] = [];
  for (let index = 0; index < end.entryCount; index++) {
    if (offset + 46 > end.eocdOffset || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ReadingPackError('truncated-zip', 'ZIP 中央目录条目不完整');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end.eocdOffset) throw new ReadingPackError('truncated-zip', 'ZIP 中央目录长度不一致');
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 1 || view.getUint16(offset + 34, true) !== 0
      || [compressedSize, size, localOffset].includes(0xffffffff)) {
      throw new ReadingPackError('invalid-format', '不支持加密、分卷或 ZIP64 阅读包');
    }
    const name = validatePackEntryName(strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength), !(flags & 2048)));
    if (entries.has(name)) throw new ReadingPackError('duplicate-entry', `重复条目 ${name}`);
    if (compression !== 0 && compression !== 8) {
      throw new ReadingPackError('unsupported-compression', `条目 ${name} 使用不支持的 compression ${compression}`);
    }
    checkEntrySize(name, size, limits);
    declaredTotal += size;
    checkLimit(declaredTotal, limits.maxUncompressedBytes, 'uncompressed-limit', '声明累计展开字节');
    if (localOffset + 30 > end.centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new ReadingPackError('truncated-zip', 'ZIP 本地条目头不完整');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > end.centralOffset) {
      throw new ReadingPackError('truncated-zip', `ZIP 条目 ${name} 数据不完整`);
    }
    const localName = strFromU8(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength), !(flags & 2048));
    if (localName !== name || view.getUint16(localOffset + 6, true) !== flags
      || view.getUint16(localOffset + 8, true) !== compression
      || (!(flags & 8) && (view.getUint32(localOffset + 18, true) !== compressedSize
        || view.getUint32(localOffset + 22, true) !== size))) {
      throw new ReadingPackError('invalid-format', `ZIP 条目 ${name} 与中央目录不一致`);
    }
    localRanges.push({ start: localOffset, end: dataStart + compressedSize });
    entries.set(name, { size, compression, checksum: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end.eocdOffset) throw new ReadingPackError('truncated-zip', 'ZIP 中央目录条目数或长度不一致');
  localRanges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < localRanges.length; i++) {
    if (localRanges[i].start < localRanges[i - 1].end) {
      throw new ReadingPackError('invalid-format', 'ZIP 本地条目重叠');
    }
  }
  return entries;
}

export function unzipReadingPack(bytes: Uint8Array, limits: UnzipBudget = DEFAULT_LIMITS): Record<string, Uint8Array> {
  checkLimit(bytes.length, limits.maxInputBytes, 'input-too-large', '压缩输入字节');
  try {
    const directory = validateZipCentralDirectory(bytes, limits);
    const entries = new Map<string, Uint8Array>();
    const seen = new Set<string>();
    let totalBytes = 0;
    let callbackError: unknown;
    const unzip = new Unzip(file => {
      if (callbackError) return;
      const path = validatePackEntryName(file.name);
      if (seen.has(path)) throw new ReadingPackError('duplicate-entry', `重复条目 ${path}`);
      seen.add(path);
      checkLimit(seen.size, limits.maxEntries, 'entry-limit', '实际条目数');
      const declared = directory.get(path);
      if (!declared || declared.compression !== file.compression) {
        throw new ReadingPackError('invalid-format', `条目 ${path} 与中央目录不一致`);
      }
      if (file.originalSize !== undefined) checkEntrySize(path, file.originalSize, limits);
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (callbackError) return;
        try {
          if (error) throw new ReadingPackError('truncated-zip', `条目 ${path} 解压失败：${error.message}`);
          entryBytes += chunk.length;
          totalBytes += chunk.length;
          checkEntrySize(path, entryBytes, limits);
          checkLimit(totalBytes, limits.maxUncompressedBytes, 'uncompressed-limit', '实际累计展开字节');
          // A rejected chunk is never retained or concatenated.
          chunks.push(chunk);
          if (final) {
            if (entryBytes !== declared.size) throw new ReadingPackError('truncated-zip', `条目 ${path} 实际展开大小与声明不一致`);
            const result = new Uint8Array(entryBytes);
            let position = 0;
            for (const part of chunks) { result.set(part, position); position += part.length; }
            if (crc32(result) !== declared.checksum) throw new ReadingPackError('invalid-format', `条目 ${path} 校验和不一致`);
            entries.set(path, result);
            chunks.length = 0;
          }
        } catch (error) { callbackError = error; chunks.length = 0; }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const end = Math.min(offset + 4096, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
      if (callbackError) throw callbackError;
    }
    if (entries.size !== seen.size || seen.size !== directory.size) {
      throw new ReadingPackError('truncated-zip', 'ZIP 条目未完整解压或中央目录数量不一致');
    }
    return Object.fromEntries(entries);
  } catch (error) {
    if (isReadingPackError(error)) throw error;
    throw new ReadingPackError('invalid-format', `无法解压：${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonEntry<T>(bytes: Uint8Array, path: string, limits: UnzipBudget): T {
  checkLimit(bytes.length, limits.maxJsonBytes, 'entry-too-large', `JSON ${path} 字节`);
  try {
    return JSON.parse(strFromU8(bytes)) as T;
  } catch (e) {
    throw new ReadingPackError('invalid-format', `包内 ${path} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 解析包字节。只解析不写库。 */
export function parseReadingPackBytes(bytes: Uint8Array, limits: UnzipBudget = DEFAULT_LIMITS): ParsedReadingPack {
  const entries = unzipReadingPack(bytes, limits);

  const manifestBytes = entries[PACK_MANIFEST_PATH];
  if (!manifestBytes) throw new ReadingPackError('invalid-format', '包里没有 manifest.json，不像阅读包');

  const manifest = parseJsonEntry<ReadingPackManifest>(manifestBytes, PACK_MANIFEST_PATH, limits);
  if (!manifest || manifest.app !== 'silly-tavern-explorer' || manifest.kind !== 'reading-pack') {
    throw new ReadingPackError('invalid-format', '这不像本应用导出的阅读包（缺少标记），已拒绝导入');
  }
  if (typeof manifest.format !== 'number' || manifest.format > READING_PACK_FORMAT) {
    throw new ReadingPackError(
      'invalid-format',
      `包的格式版本（${manifest.format}）比当前版本（${READING_PACK_FORMAT}）新，请先升级应用`,
    );
  }

  const characters: PackCharacter[] = [];
  const stories: PackStory[] = [];
  const summaries: SummaryItem[] = [];
  const media = new Map<string, Uint8Array>();

  for (const [path, data] of Object.entries(entries)) {
    if (path === PACK_MANIFEST_PATH) continue;
    if (path.startsWith(`${PACK_MEDIA_DIR}/`)) { media.set(path, data); continue; }
    if (!path.endsWith('.json')) continue;
    if (path.startsWith(`${PACK_CHARACTER_DIR}/`)) characters.push(parseJsonEntry(data, path, limits));
    else if (path.startsWith(`${PACK_STORY_DIR}/`)) stories.push(parseJsonEntry(data, path, limits));
    else if (path.startsWith(`${PACK_SUMMARY_DIR}/`)) summaries.push(parseJsonEntry(data, path, limits));
  }

  return { manifest, characters, stories, summaries, media };
}

// ---------- 预览 ----------

export interface ReadingPackPreviewRow {
  id: string;
  label: string;
  action: 'add' | 'overwrite' | 'skip';
  /** action=skip 的原因（本地更新） */
  reason?: string;
}

export interface ReadingPackPreview {
  manifest: ReadingPackManifest;
  characters: ReadingPackPreviewRow[];
  stories: ReadingPackPreviewRow[];
  summaries: ReadingPackPreviewRow[];
  totals: { add: number; overwrite: number; skip: number };
}

interface ExistingIndex {
  characters: Map<string, number>;
  stories: Map<string, number>;
  summaries: Map<string, number>;
}

/** id → 本地 updatedAt。缺失=本地没有。 */
export function buildExistingIndex(
  characters: Pick<ArchiveCharacter, 'id' | 'updatedAt'>[],
  stories: Pick<ArchiveStory, 'id' | 'updatedAt'>[],
  summaries: Pick<SummaryItem, 'id' | 'updatedAt'>[],
): ExistingIndex {
  return {
    characters: new Map(characters.map((c) => [c.id, c.updatedAt])),
    stories: new Map(stories.map((s) => [s.id, s.updatedAt])),
    summaries: new Map(summaries.map((s) => [s.id, s.updatedAt])),
  };
}

export function decide(
  incomingUpdatedAt: number,
  existing: number | undefined,
): { action: 'add' | 'overwrite' | 'skip'; reason?: string } {
  if (existing === undefined) return { action: 'add' };
  // 相等也跳过：重复导入同一个包应该是无操作
  if (incomingUpdatedAt <= existing) {
    return { action: 'skip', reason: '本地版本不更旧，保留本地' };
  }
  return { action: 'overwrite' };
}

export function previewReadingPack(pack: ParsedReadingPack, existing: ExistingIndex): ReadingPackPreview {
  const totals = { add: 0, overwrite: 0, skip: 0 };

  const characters = pack.characters.map((c) => {
    const d = decide(c.updatedAt, existing.characters.get(c.id));
    totals[d.action]++;
    return { id: c.id, label: c.displayMeta?.name ?? c.name, ...d };
  });
  const stories = pack.stories.map((s) => {
    const d = decide(s.updatedAt, existing.stories.get(s.id));
    totals[d.action]++;
    return { id: s.id, label: s.title, ...d };
  });
  const summaries = pack.summaries.map((s) => {
    const d = decide(s.updatedAt, existing.summaries.get(s.id));
    totals[d.action]++;
    return { id: s.id, label: s.title, ...d };
  });

  return { manifest: pack.manifest, characters, stories, summaries, totals };
}

// ---------- 还原成库内实体 ----------

/** 把包内角色还原成 ArchiveCharacter：media 路径换回 base64 */
export type CharacterLocalFields = Pick<
  ArchiveCharacter, 'attachments' | 'assets' | 'unresolvedAssets' | 'sourcePath'
>;

export function pickCharacterLocalFields(local: ArchiveCharacter): CharacterLocalFields {
  return {
    attachments: local.attachments,
    assets: local.assets,
    unresolvedAssets: local.unresolvedAssets,
    sourcePath: local.sourcePath,
  };
}

function restoreCharacterMedia(
  pack: ParsedReadingPack,
  cardMediaPath: string | undefined,
  portraitRows: PackPortraitRow[] | undefined,
): Pick<ArchiveCharacter, 'pngBase64' | 'portraitRows'> {
  const cardBytes = cardMediaPath?.startsWith(`${PACK_MEDIA_DIR}/`) ? pack.media.get(cardMediaPath) : undefined;
  const restoredRows: PortraitRow[] | undefined = portraitRows?.map((row) => ({
    id: row.id,
    title: row.title,
    items: row.items.map((item) => {
      const bytes = item.mediaPath?.startsWith(`${PACK_MEDIA_DIR}/`) ? pack.media.get(item.mediaPath) : undefined;
      return {
        id: item.id,
        source: item.source,
        name: item.name,
        // 图片缺失（客户端立绘只存了文件名，或包被裁过）时条目照样留下，
        // 界面上会显示成缺图——比静默丢掉整行好。
        dataBase64: bytes ? bytesToBase64(bytes) : undefined,
        mime: item.mime,
        addedAt: item.addedAt,
      };
    }),
  }));

  return {
    pngBase64: cardBytes ? bytesToBase64(cardBytes) : undefined,
    portraitRows: restoredRows,
  };
}

export function restoreCharacter(
  pack: ParsedReadingPack,
  packChar: PackCharacter,
  local?: ArchiveCharacter,
): ArchiveCharacter {
  const {
    attachments: _attachments, assets: _assets, unresolvedAssets: _unresolvedAssets,
    sourcePath: _sourcePath, pngBase64: _pngBase64, cardMediaPath, portraitRows, ...content
  } = packChar as PackCharacter & Partial<CharacterLocalFields> & { pngBase64?: string };
  return {
    ...content,
    ...restoreCharacterMedia(pack, cardMediaPath, portraitRows),
    ...(local === undefined ? {} : pickCharacterLocalFields(local)),
  };
}

function clampBranchFloor(floor: number | undefined, messageCount: number): number | undefined {
  if (typeof floor !== 'number' || !Number.isFinite(floor) || messageCount === 0) return undefined;
  return Math.max(1, Math.min(Math.trunc(floor), messageCount));
}

export function mergeStoryProgress(incoming: ArchiveStory, local?: ArchiveStory): ArchiveStory {
  const progress = local ?? incoming;
  const restored: ArchiveStory = {
    ...incoming,
    lastFloor: clampBranchFloor(progress.lastFloor, incoming.session.messages.length),
    lastViewedAt: progress.lastViewedAt,
  };
  const localBranches = new Map((local?.branches ?? []).map((branch) => [branch.id, branch]));
  restored.branches = incoming.branches?.map((branch): StoryBranch => {
    const localBranch = localBranches.get(branch.id);
    return { ...branch, lastFloor: clampBranchFloor(
      localBranch === undefined ? branch.lastFloor : localBranch.lastFloor,
      branch.session.messages.length,
    ) };
  });

  const candidate = progress.lastViewedBranchId;
  restored.lastViewedBranchId = candidate && restored.branches?.some((branch) => branch.id === candidate)
    ? candidate
    : undefined;
  return restored;
}

/**
 * 把包内故事还原成 ArchiveStory。
 * local 是本地同 id 的现有故事（可能没有）——阅读进度从它那儿继承。
 */
export function restoreStory(packStory: PackStory, local?: ArchiveStory): ArchiveStory {
  const { sourcePath: _sourcePath, writebacks: _writebacks, assets: _assets,
    unresolvedAssets: _unresolvedAssets, ...content } = packStory as ArchiveStory;
  return mergeStoryProgress({
    ...content,
    ...(local === undefined ? {} : {
      sourcePath: local.sourcePath, writebacks: local.writebacks,
      assets: local.assets, unresolvedAssets: local.unresolvedAssets,
    }),
  }, local);
}
