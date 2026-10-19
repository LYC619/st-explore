import type { PortraitRow } from '@/types/archive';
import type { VaultFs } from '@/lib/vault/fs';
import { joinPath } from '@/lib/vault/fs';
import { isCharacterRelativeSafePath, isSafeFileSegment } from '@/lib/vault/character-relative-path';
import { safeName } from '@/lib/vault/naming';
import { buildPortraitSnapshot } from '@/lib/portrait-snapshot';
import { finalizeRetainedFiles } from '@/lib/vault/file-maintenance';

export interface PortraitMutationJournal {
  version: 1;
  operationId: string;
  characterId: string;
  status: 'prepared' | 'committed';
  beforeRows: PortraitRow[];
  afterRows: PortraitRow[];
  createdFiles: string[];
  cleanupFiles: string[];
  createdAt: number;
  /** Deletions defer all source file handling until the profile is durably saved. */
  deletion?: { deleteFiles: boolean };
}

export interface JournalRecoveryReport {
  operationId: string;
  action: 'finalized' | 'rolled-back' | 'blocked';
  warnings: string[];
}

const JOURNAL_DIR = '.ste-control/portrait-journal';
const PROFILE_FILE = '档案.json';

const activeOperations = new WeakMap<VaultFs, Set<string>>();

function operationKey(characterId: string, operationId: string): string {
  return `${characterId}\u0000${operationId}`;
}

export function beginPortraitOperation(fs: VaultFs, characterId: string, operationId: string): void {
  let active = activeOperations.get(fs);
  if (!active) {
    active = new Set<string>();
    activeOperations.set(fs, active);
  }
  active.add(operationKey(characterId, operationId));
}

export function endPortraitOperation(fs: VaultFs, characterId: string, operationId: string): void {
  activeOperations.get(fs)?.delete(operationKey(characterId, operationId));
}

export function isPortraitOperationActive(fs: VaultFs, characterId: string, operationId: string): boolean {
  return activeOperations.get(fs)?.has(operationKey(characterId, operationId)) ?? false;
}

function journalFile(characterDir: string, operationId: string): string {
  return joinPath(characterDir, JOURNAL_DIR, `${operationId}.json`);
}

function rowsAreValid(value: unknown): value is PortraitRow[] {
  if (!Array.isArray(value)) return false;
  return value.every((row) => typeof row === 'object' && row !== null
    && typeof (row as PortraitRow).id === 'string'
    && typeof (row as PortraitRow).title === 'string'
    && Array.isArray((row as PortraitRow).items)
    && (row as PortraitRow).items.every((item) => typeof item === 'object' && item !== null
      && typeof item.id === 'string'
      && (item.source === 'manual' || item.source === 'replaced')
      && (item.fileName === undefined || typeof item.fileName === 'string' && isSafeFileSegment(item.fileName))
      && typeof item.addedAt === 'number' && Number.isFinite(item.addedAt)));
}

function mediaPathIsSafe(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return isCharacterRelativeSafePath(path, 'portrait')
    && parts.length === 3
    && isSafeFileSegment(parts[1])
    && isSafeFileSegment(parts[2]);
}

function journalIsValid(value: unknown, characterId: string): value is PortraitMutationJournal {
  if (typeof value !== 'object' || value === null) return false;
  const journal = value as Partial<PortraitMutationJournal>;
  if (!(journal.version === 1
    && typeof journal.operationId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(journal.operationId)
    && journal.characterId === characterId
    && (journal.status === 'prepared' || journal.status === 'committed')
    && rowsAreValid(journal.beforeRows)
    && rowsAreValid(journal.afterRows)
    && Array.isArray(journal.createdFiles)
    && journal.createdFiles.every(mediaPathIsSafe)
    && Array.isArray(journal.cleanupFiles)
    && journal.cleanupFiles.every(mediaPathIsSafe)
    && (journal.deletion === undefined || typeof journal.deletion === 'object' && journal.deletion !== null
      && typeof journal.deletion.deleteFiles === 'boolean' && journal.createdFiles.length === 0)
    && typeof journal.createdAt === 'number' && Number.isFinite(journal.createdAt))) return false;
  const beforeFiles = referencedMedia(journal.beforeRows!);
  const afterFiles = referencedMedia(journal.afterRows!);
  const beforeKeys = new Set([...beforeFiles].map(path => path.toLowerCase()));
  const afterKeys = new Set([...afterFiles].map(path => path.toLowerCase()));
  if (portraitRowsEqual(journal.beforeRows!, journal.afterRows!)) return false;
  const created = new Set(journal.createdFiles!);
  const cleanup = new Set(journal.cleanupFiles!);
  const expectedCleanup = [...beforeFiles].filter(path => !afterKeys.has(path.toLowerCase()));
  const newReferences = [...afterFiles].filter(path => !beforeKeys.has(path.toLowerCase()));
  // Journal contents do not grant deletion authority over arbitrary media or user strays.
  const ownedName = new RegExp(`^\\.ste-portrait-${journal.operationId}-\\d+\\.(?:tmp|png|jpe?g|webp|gif)$`, 'i');
  return created.size === journal.createdFiles!.length
    && new Set([...created].map(path => path.toLowerCase())).size === created.size
    && cleanup.size === journal.cleanupFiles!.length
    && expectedCleanup.length === cleanup.size && expectedCleanup.every(path => cleanup.has(path))
    && newReferences.every(path => created.has(path))
    && [...created].every(path => !beforeKeys.has(path.toLowerCase()) && ownedName.test(path.split('/')[2])
      && (path.endsWith('.tmp') || afterFiles.has(path)));
}

function referencedMedia(rows: PortraitRow[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) {
    const rowDirectory = safeName(row.title, '未命名行');
    for (const item of row.items) {
      if (item.fileName && isSafeFileSegment(item.fileName)) {
        paths.add(`立绘/${rowDirectory}/${item.fileName}`);
      }
    }
  }
  return paths;
}

export async function writePortraitJournal(
  characterDir: string,
  fs: VaultFs,
  journal: PortraitMutationJournal,
): Promise<void> {
  if (!journalIsValid(journal, journal.characterId)) throw new Error('立绘 journal 内容无效');
  await fs.mkdir(joinPath(characterDir, JOURNAL_DIR));
  await fs.writeText(journalFile(characterDir, journal.operationId), JSON.stringify(journal, null, 2));
}

export async function setPortraitJournalStatus(
  characterDir: string,
  fs: VaultFs,
  journal: PortraitMutationJournal,
  status: PortraitMutationJournal['status'],
): Promise<void> {
  await writePortraitJournal(characterDir, fs, { ...journal, status });
}

async function removePathIfPresent(fs: VaultFs, characterDir: string, relative: string): Promise<void> {
  if (!(await fs.stat(joinPath(characterDir, relative))).exists) return;
  await fs.removeFile(joinPath(characterDir, relative));
}

async function cleanJournalFiles(
  fs: VaultFs,
  characterDir: string,
  paths: string[],
  referenced: Set<string>,
): Promise<string[]> {
  const warnings: string[] = [];
  const referencedKeys = new Set([...referenced].map(path => path.toLowerCase()));
  for (const relative of paths) {
    if (!mediaPathIsSafe(relative) || referencedKeys.has(relative.toLowerCase())) continue;
    try {
      await removePathIfPresent(fs, characterDir, relative);
    } catch (error) {
      warnings.push(`清理立绘文件失败 ${relative}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return warnings;
}

async function readJournal(
  characterDir: string,
  characterId: string,
  fs: VaultFs,
  name: string,
): Promise<PortraitMutationJournal | undefined> {
  if (!name.endsWith('.json')) return undefined;
  const operationId = name.slice(0, -'.json'.length);
  if (!/^[0-9a-f-]{36}$/i.test(operationId)) return undefined;
  try {
    const value: unknown = JSON.parse(await fs.readText(joinPath(characterDir, JOURNAL_DIR, name)));
    return journalIsValid(value, characterId) && value.operationId === operationId ? value : undefined;
  } catch {
    return undefined;
  }
}

async function recoverOneJournal(
  characterDir: string,
  characterId: string,
  fs: VaultFs,
  journal: PortraitMutationJournal,
): Promise<JournalRecoveryReport> {
  const warnings: string[] = [];
  const operationId = journal.operationId;
  if (!journalIsValid(journal, characterId)) {
    return { operationId, action: 'blocked', warnings: ['portrait-recovery-required: journal 路径或归属无效，未删除任何媒体'] };
  }
  let currentRows: PortraitRow[];
  let currentId: string | undefined;
  try {
    const profile = JSON.parse(await fs.readText(joinPath(characterDir, PROFILE_FILE))) as {
      id?: string; portraitRows?: PortraitRow[]; portraitCurrentId?: string;
    };
    if (profile.id !== characterId || !rowsAreValid(profile.portraitRows ?? [])) throw new Error('档案身份或立绘字段无效');
    currentRows = profile.portraitRows ?? [];
    currentId = profile.portraitCurrentId;
  } catch (error) {
    return { operationId: journal.operationId, action: 'blocked', warnings: [`portrait-recovery-required: 无法读取真实档案：${error instanceof Error ? error.message : String(error)}`] };
  }

  const current = JSON.stringify(currentRows);
  const before = JSON.stringify(journal.beforeRows);
  const after = JSON.stringify(journal.afterRows);
  if (current !== before && current !== after) {
    return { operationId: journal.operationId, action: 'blocked', warnings: ['portrait-recovery-required: 档案同时偏离变更前和变更后状态'] };
  }

  if (current === before) {
    warnings.push(...await cleanJournalFiles(fs, characterDir, journal.createdFiles, referencedMedia(currentRows)));
    if (warnings.length === 0) {
      try { await removePathIfPresent(fs, characterDir, joinPath(JOURNAL_DIR, `${journal.operationId}.json`)); }
      catch (error) { warnings.push(`移除 portrait journal 失败：${error instanceof Error ? error.message : String(error)}`); }
    }
    return { operationId: journal.operationId, action: 'rolled-back', warnings };
  }

  try {
    const beforeKeys = new Set([...referencedMedia(journal.beforeRows)].map(path => path.toLowerCase()));
    for (const path of referencedMedia(currentRows)) {
      if (beforeKeys.has(path.toLowerCase())) continue;
      const stat = await fs.stat(joinPath(characterDir, path));
      if (!stat.exists || stat.isDir) throw new Error(`新立绘文件缺失或无效：${path}`);
    }
  } catch (error) {
    return { operationId: journal.operationId, action: 'blocked', warnings: [
      `portrait-recovery-required: ${error instanceof Error ? error.message : String(error)}`,
    ] };
  }

  try {
    if (journal.status !== 'committed') await setPortraitJournalStatus(characterDir, fs, journal, 'committed');
  } catch (error) {
    warnings.push(`标记 portrait journal 已提交失败：${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await fs.writeText(joinPath(characterDir, '立绘', '立绘.json'), JSON.stringify(buildPortraitSnapshot(currentRows, currentId), null, 2));
  } catch (error) {
    warnings.push(`立绘快照更新失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (journal.deletion) {
    try {
      await finalizeRetainedFiles(fs, {
        operationId, store: 'characters', id: characterId,
        paths: journal.cleanupFiles.map(path => joinPath(characterDir, path)),
        deleteFiles: journal.deletion.deleteFiles,
      });
      const removedRows = journal.beforeRows.filter(row => !currentRows.some(current => current.id === row.id));
      for (const row of removedRows) await fs.removeEmptyDir(joinPath(characterDir, '立绘', safeName(row.title, '未命名行')));
    } catch (error) {
      warnings.push(`处理删除后的立绘文件失败：${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push(...await cleanJournalFiles(fs, characterDir, [...journal.createdFiles, ...journal.cleanupFiles], referencedMedia(currentRows)));
  }
  if (warnings.length === 0) {
    try { await removePathIfPresent(fs, characterDir, joinPath(JOURNAL_DIR, `${journal.operationId}.json`)); }
    catch (error) { warnings.push(`移除 portrait journal 失败：${error instanceof Error ? error.message : String(error)}`); }
  }
  return { operationId: journal.operationId, action: 'finalized', warnings };
}

export async function recoverPortraitJournal(
  characterDir: string,
  characterId: string,
  fs: VaultFs,
  journal: PortraitMutationJournal,
): Promise<JournalRecoveryReport> {
  return recoverOneJournal(characterDir, characterId, fs, journal);
}

export async function recoverCharacterJournals(
  characterDir: string,
  characterId: string,
  fs: VaultFs,
): Promise<JournalRecoveryReport[]> {
  const entries = await fs.list(joinPath(characterDir, JOURNAL_DIR));
  const reports: JournalRecoveryReport[] = [];
  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith('.json')) continue;
    const journal = await readJournal(characterDir, characterId, fs, entry.name);
    if (!journal) {
      reports.push({ operationId: entry.name, action: 'blocked', warnings: ['portrait-recovery-required: journal 格式无效，未删除任何媒体'] });
      continue;
    }
    if (isPortraitOperationActive(fs, characterId, journal.operationId)) continue;
    reports.push(await recoverOneJournal(characterDir, characterId, fs, journal));
  }
  return reports;
}

export function portraitMediaPath(rowTitle: string, fileName: string): string {
  if (!isSafeFileSegment(rowTitle) || !isSafeFileSegment(fileName)) throw new Error('立绘路径片段无效');
  return `立绘/${rowTitle}/${fileName}`;
}

export function portraitRowsEqual(a: PortraitRow[], b: PortraitRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
