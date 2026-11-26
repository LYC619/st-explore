/**
 * IndexedDB storage management utilities
 */

import { tr } from '@/lib/i18n';
import { openDB, ALL_STORES, DB_VERSION, type StoreName } from '@/lib/idb';
import { isRuntimePath, runtimeFileId } from '@/lib/roleplay/paths';
import { checkChain, validCommit, type WorldCommit } from '@/play/storage/world-commit';
import { validWorldMedia } from '@/play/media/asset';

/** 备份文件大小硬上限：正常整库备份远低于此，超过多半是误选了别的大文件或文件损坏，直接拒绝以免 file.text() 撑爆内存。 */
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;

/** 面向用户的备份/恢复错误：message 已是可直接展示的中文说明。 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

interface StoreSpec {
  key: StoreName;
  /** 展示名，用于导入预览与结果提示 */
  label: string;
  /** 单条记录有效性判定：缺关键字段的脏数据会被跳过而不是写入（避免坏记录污染库） */
  isValid: (item: Record<string, unknown>) => boolean;
  prepare?: (item: Record<string, unknown>) => Record<string, unknown>;
}

// Connection profiles live outside the library. Legacy extension settings can
// still contain credentials, so library metadata must not carry them in backups.
function withoutCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:api[_-]?key(?:[_-].*)?|.*[_-]api[_-]?key|authorization|proxy[_-]?password|password|secret(?:[_-].*)?|access[_-]?token|refresh[_-]?token)$/i.test(key))
    .map(([key, item]) => [key, withoutCredentials(item)]));
}

/**
 * 全部业务 store 的元数据单一清单：导出、导入预览、导入写回都由它驱动，
 * 新增 store 只需在此登记一行（且同步 idb.ts 的 ALL_STORES）。顺序与 ALL_STORES 一致。
 */
const STORE_SPECS: readonly StoreSpec[] = [
  // 'books'（书架）已随 2.0 阶段5 退役，不再进备份；旧备份里的 books 数组导入时被忽略
  { key: 'worldbooks', get label() { return tr("世界书"); }, isValid: (w) => !!w.id },
  { key: 'presets', get label() { return tr("预设"); }, isValid: (p) => !!p.id },
  { key: 'cards', get label() { return tr("角色卡"); }, isValid: (c) => !!c.id && !!c.card },
  { key: 'summaries', get label() { return tr("总结"); }, isValid: (s) => !!s.id && typeof s.content === 'string' },
  { key: 'summaryTemplates', get label() { return tr("总结模板"); }, isValid: (t) => !!t.id && typeof t.content === 'string' },
  { key: 'stories', get label() { return tr("故事树"); }, isValid: (s) => !!s.id && Array.isArray(s.nodes) },
  { key: 'characters', get label() { return tr("角色档案"); }, isValid: (c) => !!c.id && !!c.card },
  { key: 'archiveStories', get label() { return tr("归档故事"); }, isValid: (s) => !!s.id && !!s.session },
  { key: 'archiveMeta', get label() { return tr("文件库与游玩设置"); }, isValid: m => typeof m.id === 'string' && !!m.id
    && typeof m.schemaVersion === 'number' && Number.isFinite(m.schemaVersion) && typeof m.updatedAt === 'number',
    prepare: m => withoutCredentials(m) as Record<string, unknown> },
  { key: 'regexes', get label() { return tr("正则规则集"); }, isValid: (r) => !!r.id && Array.isArray(r.rules) },
  { key: 'ratingTemplates', get label() { return tr("评分模板"); }, isValid: (t) => !!t.id && Array.isArray(t.dimensions) },
  { key: 'roleplayFiles', get label() { return tr("游玩记忆与记录"); }, isValid: f => typeof f.storyId === 'string' && typeof f.text === 'string'
    && isRuntimePath(f.path) && f.id === runtimeFileId(f.storyId, f.path) },
  { key: 'worldCommits', get label() { return tr("沙盘世界与回放"); }, isValid: validCommit },
  { key: 'worldMedia', get label() { return tr("世界与剧场素材"); }, isValid: validWorldMedia },
];

/**
 * Estimate IndexedDB storage usage
 */
export async function estimateStorageUsage(): Promise<{
  used: number;
  quota: number;
  percentage: number;
}> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      quota: estimate.quota || 0,
      percentage: estimate.quota ? Math.round(((estimate.usage || 0) / estimate.quota) * 100) : 0,
    };
  }
  return { used: 0, quota: 0, percentage: 0 };
}

/**
 * Export entire IndexedDB as a JSON file for backup.
 * 备份由 STORE_SPECS 驱动，覆盖全部业务 store（worldbooks/presets/cards/summaries/
 * summaryTemplates/stories/characters/archiveStories/regexes），
 * 少备份任何一个都会造成"完整备份"名不副实的数据丢失。
 */
export async function collectFullBackup(): Promise<Record<string, unknown>> {
  const db = await openDB();

  const readAll = (storeName: string) =>
    new Promise<unknown[]>((resolve, reject) => {
      // 某些旧库可能尚未建出对应 store，缺失时返回空数组而非抛错
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });

  const results = await Promise.all(STORE_SPECS.map((s) => readAll(s.key)));

  const backup: Record<string, unknown> = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'silly-tavern-explorer',
  };
  STORE_SPECS.forEach((s, i) => {
    backup[s.key] = s.prepare ? validItems(s, results[i]) : results[i];
  });
  return backup;
}

export async function exportFullBackup(): Promise<void> {
  const backup = await collectFullBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stcb-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 已通过类型/大小/JSON/schema 校验的备份数据，按 store 归类，可直接喂给 previewBackup / importBackup。 */
export interface ParsedBackup {
  version: number;
  exportedAt?: string;
  /** 只含 STORE_SPECS 里的 key（退役的 books 不在其中），缺失视为空 */
  byStore: Partial<Record<StoreName, unknown[]>>;
}

export interface BackupStorePreview {
  key: StoreName;
  label: string;
  /** id 在当前库中不存在、将新增的条数 */
  add: number;
  /** id 已存在于当前库、将被覆盖的条数 */
  overwrite: number;
  /** 缺关键字段被判无效、将跳过不写的条数 */
  skipped: number;
  /** World histories restore as complete chains; newer revisions are removed. */
  remove?: number;
}

export interface BackupPreview {
  version: number;
  exportedAt?: string;
  totalAdd: number;
  totalOverwrite: number;
  totalSkipped: number;
  stores: BackupStorePreview[];
}

export type BackupCounts = Record<StoreName, number>;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** 把 JSON.parse 的 "position N" 报错换算成行列，便于用户定位损坏处。 */
function locateJsonError(err: unknown, text: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/position (\d+)/i);
  if (m) {
    const pos = Number(m[1]);
    const before = text.slice(0, Math.max(0, pos));
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return tr("JSON 解析失败：第 {{v0}} 行第 {{v1}} 列附近（{{v2}}）", { v0: line, v1: col, v2: raw });
  }
  return tr("JSON 解析失败：{{v0}}", { v0: raw });
}

/**
 * 读取并校验备份文件（类型 → 大小 → JSON → schema），任一不过抛 BackupError（message 可直接展示）。
 * 只解析、不写库——写库前先经 previewBackup 让用户确认覆盖范围。
 */
export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  const isJsonName = /\.json$/i.test(file.name);
  const isJsonType = !file.type || file.type.includes('json') || file.type === 'text/plain';
  if (!isJsonName && !isJsonType) {
    throw new BackupError(tr("文件类型不对：请选择 .json 备份文件（当前：{{v0}}）", { v0: file.name || file.type || tr("未知") }));
  }
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupError(
      tr("文件过大（{{v0}}），超过 {{v1}} 上限，已拒绝导入以免撑爆内存", { v0: formatBytes(file.size), v1: formatBytes(MAX_BACKUP_BYTES) }),
    );
  }

  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new BackupError(locateJsonError(e, text));
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BackupError(tr("备份内容不是一个 JSON 对象，格式无效"));
  }
  const obj = data as Record<string, unknown>;
  if (obj.app !== 'silly-tavern-explorer') {
    throw new BackupError(tr("这不像本应用导出的备份（缺少 app 标记），已拒绝导入"));
  }

  const byStore: Partial<Record<StoreName, unknown[]>> = {};
  for (const spec of STORE_SPECS) {
    // 兼容旧版本备份缺字段（v1 仅 books、v2 +worldbooks …），缺失或非数组一律视为空
    byStore[spec.key] = asArray(obj[spec.key]);
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 0,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : undefined,
    byStore,
  };
}

function readKeys(db: IDBDatabase, storeName: string): Promise<Set<unknown>> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve(new Set());
      return;
    }
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result as unknown[]));
    req.onerror = () => reject(req.error);
  });
}

function validItems(spec: StoreSpec, items: unknown[]): Record<string, unknown>[] {
  return items.filter(
    (it): it is Record<string, unknown> =>
      !!it && typeof it === 'object' && spec.isValid(it as Record<string, unknown>),
  ).map(item => spec.prepare ? spec.prepare(item) : item);
}

function backupWorlds(parsed: ParsedBackup): Map<string, WorldCommit[]> {
  const groups = new Map<string, WorldCommit[]>();
  for (const item of parsed.byStore.worldCommits ?? []) {
    if (!validCommit(item)) throw new BackupError(tr("沙盘世界备份含损坏提交，未写入任何数据"));
    const rows = groups.get(item.worldId) ?? []; rows.push(item); groups.set(item.worldId, rows);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.revision - b.revision);
    try { checkChain(rows); } catch { throw new BackupError(tr("沙盘世界历史不完整，未写入任何数据")); }
  }
  return groups;
}

/**
 * 对照当前库统计"这份备份导入后会怎样"：逐 store 给出 新增 / 覆盖（同 id 现有记录将被替换）/ 跳过（无效）条数。
 * 供导入前预览弹窗展示，让用户在写库前看清将覆盖什么。
 */
export async function previewBackup(parsed: ParsedBackup): Promise<BackupPreview> {
  const worlds = backupWorlds(parsed);
  const db = await openDB();
  const stores = await Promise.all(
    STORE_SPECS.map(async (spec) => {
      const items = parsed.byStore[spec.key] ?? [];
      const valid = validItems(spec, items);
      const existing = await readKeys(db, spec.key);
      let overwrite = 0;
      for (const it of valid) {
        if (existing.has((it as { id: unknown }).id)) overwrite++;
      }
      return {
        key: spec.key,
        label: spec.label,
        add: valid.length - overwrite,
        overwrite,
        skipped: items.length - valid.length,
        ...(spec.key === 'worldCommits' ? { remove: [...existing].filter(key => typeof key === 'string'
          && worlds.has(key.split(':')[0]) && !valid.some(item => item.id === key)).length } : {}),
      };
    }),
  );

  return {
    version: parsed.version,
    exportedAt: parsed.exportedAt,
    totalAdd: stores.reduce((n, s) => n + s.add, 0),
    totalOverwrite: stores.reduce((n, s) => n + s.overwrite, 0),
    totalSkipped: stores.reduce((n, s) => n + s.skipped, 0),
    stores,
  };
}

/**
 * 把已校验的备份按 id 合并写回（upsert：同 id 覆盖、其余现有数据保留不动）。
 *
 * 关键：全部 store 放进**同一个读写事务**——任一 put 失败，整个事务 abort、已写入的一并回滚，
 * 绝不出现"写了一半、坏文件污染现有库"的中间态。返回各 store 实际写入条数。
 */
export async function importBackup(parsed: ParsedBackup): Promise<BackupCounts> {
  const worlds = backupWorlds(parsed);
  const db = await openDB();
  const targets = STORE_SPECS.filter((s) => db.objectStoreNames.contains(s.key));
  if (targets.length === 0) {
    throw new BackupError(tr("数据库缺少可写入的对象存储"));
  }

  return new Promise<BackupCounts>((resolve, reject) => {
    const counts = {} as BackupCounts;
    for (const spec of STORE_SPECS) counts[spec.key] = 0;

    let tx: IDBTransaction;
    try {
      tx = db.transaction(
        targets.map((s) => s.key),
        'readwrite',
      );
    } catch (e) {
      reject(e instanceof Error ? e : new BackupError(tr("无法开启写入事务")));
      return;
    }

    tx.oncomplete = () => resolve(counts);
    tx.onerror = () => reject(tx.error ?? new BackupError(tr("恢复失败，事务出错（未改动现有数据）")));
    tx.onabort = () => reject(tx.error ?? new BackupError(tr("恢复失败，事务已回滚（未改动现有数据）")));

    try {
      for (const spec of targets) {
        const store = tx.objectStore(spec.key);
        if (spec.key === 'worldCommits') {
          for (const [worldId, commits] of worlds) {
            const cursor = store.index('worldId').openCursor(IDBKeyRange.only(worldId));
            cursor.onsuccess = () => {
              if (cursor.result) { cursor.result.delete(); cursor.result.continue(); }
              else { for (const commit of commits) store.add(commit); }
            };
            counts[spec.key] += commits.length;
          }
          continue;
        }
        // 未逐条挂 onerror：某条 put 出错会自然冒泡触发事务 abort（正是我们要的整体回滚）
        for (const it of validItems(spec, parsed.byStore[spec.key] ?? [])) {
          store.put(it);
          counts[spec.key]++;
        }
      }
    } catch (e) {
      // put 同步抛错（如含函数等不可结构化克隆的值）：主动 abort，保证本次已写入的一并回滚
      try {
        tx.abort();
      } catch {
        /* 事务可能已在中止 */
      }
      reject(e instanceof Error ? e : new BackupError(tr("恢复失败，写入被中止（未改动现有数据）")));
    }
  });
}

/**
 * Clear all data from IndexedDB（全部业务 store 一并清空）
 */
export async function clearAllData(): Promise<void> {
  const db = await openDB();
  const clearStore = (storeName: string) =>
    new Promise<void>((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve();
        return;
      }
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  await Promise.all(ALL_STORES.map((name) => clearStore(name)));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
