import { sha256 } from 'js-sha256';
import type { StoreName } from '@/lib/idb';
import type { BaseRecord, RemoveOptions } from '@/lib/repo/idb-repo';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import { SUMMARY_KIND_LABELS } from '@/types/summary';
import type { VaultBackend } from './vault-backend';
import type { VaultEntry, VaultFs } from './fs';
import { baseName, joinPath, parentDir } from './fs';
import { safeName, ensureUnique } from './naming';
import { isSafeFileSegment, resolveAttachmentRelativePath } from './character-relative-path';
import { parseFrontmatter } from './frontmatter';
import { isRuntimePath, branchKey } from '@/lib/roleplay/paths';
import { getActiveVault, getVaultEpoch } from './active';

export interface ManagedFile { path: string; size: number; version: string }
export interface FileRemovalPreview {
  store: StoreName; id: string; files: ManagedFile[]; count: number; bytes: number; usesTrash: boolean;
}
export type MaintenanceCategory = 'retained' | 'unreferenced' | 'unknown' | 'empty-directory';
export interface FileMaintenanceEntry extends ManagedFile {
  category: MaintenanceCategory; reason: string; selectable: boolean;
}
export interface FileMaintenanceScan {
  vault: VaultBackend; epoch: number; createdAt: number; entries: FileMaintenanceEntry[];
  complete: boolean; errors: string[]; bytes: number; usesTrash: boolean;
}
export interface FileCleanupResult {
  removed: string[]; skipped: { path: string; reason: string }[]; failed: { path: string; reason: string }[];
  bytes: number; usesTrash: boolean;
}
interface DiskRecord { store: StoreName; path: string; record: BaseRecord & Record<string, unknown> }
interface Inventory {
  files: Map<string, VaultEntry>; directories: Set<string>; records: DiskRecord[];
  errors: string[]; known: Set<string>; references: Map<string, Set<string>>;
}
interface Manifest {
  schema: 1; operationId: string; store: StoreName; id: string; createdAt: number;
  deleteFiles: boolean; files: ManagedFile[];
}
const RETAINED = '.ste/retained';
const operationIdPattern = /^[a-f0-9-]{36}$/i;
const activeOperations = new WeakMap<VaultFs, Set<string>>();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const pathKey = (path: string) => path.toLocaleLowerCase();
const safePath = (path: unknown): path is string => typeof path === 'string' && path.split('/').every(isSafeFileSegment);
const recordKey = (record: DiskRecord) => `${record.store}:${record.record.id}`;
const stagedPath = (manifest: Manifest, path: string) => `${RETAINED}/${manifest.operationId}/files/${path}`;
const manifestPath = (operationId: string) => `${RETAINED}/${operationId}/manifest.json`;

/** Check every ancestor, not just the final file: stat follows links on some platforms. */
async function assertSafePath(fs: VaultFs, path: string, allowMissing = false): Promise<void> {
  if (!safePath(path)) throw new Error(`不安全的库内路径：${path}`);
  let parent = '';
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    const entry = (await fs.list(parent)).find(item => item.name === parts[index]);
    if (entry?.isSymlink || entry && index < parts.length - 1 && !entry.isDir) throw new Error(`路径含链接或非目录：${path}`);
    if (!entry && !allowMissing) throw new Error(`文件已不存在：${path}`);
    parent = joinPath(parent, parts[index]);
  }
}

async function fileVersion(fs: VaultFs, path: string): Promise<string> {
  await assertSafePath(fs, path);
  try { return sha256('binary:' + await fs.readBinary(path)); }
  catch { return sha256('text:' + await fs.readText(path)); }
}

function recordStore(path: string): StoreName | undefined {
  if (/^角色\/[^/]+\/档案\.json$/.test(path)) return 'characters';
  if (/^(?:角色\/[^/]+\/故事\/[^/]+|临时\/(?!记录\/|卡片\/)[^/]+)\/故事\.json$/.test(path)) return 'archiveStories';
  if (/^临时\/卡片\/[^/]+\.json$/.test(path)) return 'cards';
  if (/^资产\/世界书\/[^/]+\.json$/.test(path)) return 'worldbooks';
  if (/^资产\/预设\/[^/]+\.json$/.test(path)) return 'presets';
  if (/^资产\/正则\/[^/]+\.json$/.test(path)) return 'regexes';
  if (/^资产\/模板\/总结模板·[^/]+\.md$/.test(path)) return 'summaryTemplates';
  if (/^资产\/模板\/评分模板·[^/]+\.json$/.test(path)) return 'ratingTemplates';
  if (path === '库信息.json') return 'archiveMeta';
  if (/^(?:临时\/记录|临时\/(?!卡片\/)[^/]+|角色\/[^/]+\/故事\/[^/]+)\/[^/]+$/.test(path)) {
    if (baseName(path).startsWith('故事树·') && path.endsWith('.json')) return 'stories';
    if (path.endsWith('.md') && Object.values(SUMMARY_KIND_LABELS).some(label => baseName(path).startsWith(label + '·'))) return 'summaries';
  }
}

function runtimeOwned(relative: string, story: ArchiveStory): boolean {
  if (!isRuntimePath(relative)) return false;
  const branches = new Set(['main', ...(story.branches ?? []).map(branch => branchKey(branch.id))]);
  if (relative.startsWith('memory/')) return branches.has(relative.split('/')[1]) && relative.endsWith('.md');
  const [, , branch, ...parts] = relative.split('/');
  if (!branches.has(branch)) return false;
  const rest = parts.join('/');
  return /^(?:settings|context|draft|helpers|inheritance)\.json$/.test(rest)
    || /^(?:turns|memory-journal|memory-updates|maintenance|receipts|inputs)\/[a-f0-9]{64}\.json$/.test(rest)
    || /^worldbook-versions\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(rest);
}

function ownedPaths(item: DiskRecord, files: Map<string, VaultEntry>): Set<string> {
  const paths = new Set([item.path]);
  const dir = parentDir(item.path);
  if (item.store === 'characters') {
    const character = item.record as unknown as ArchiveCharacter;
    paths.add(`${dir}/卡片.png`);
    paths.add(`${dir}/立绘/立绘.json`);
    for (const row of character.portraitRows ?? []) for (const image of row.items) {
      if (image.fileName && isSafeFileSegment(image.fileName)) paths.add(`${dir}/立绘/${safeName(row.title, '未命名行')}/${image.fileName}`);
    }
    for (const attachment of character.attachments ?? []) {
      const relative = resolveAttachmentRelativePath(attachment);
      if (relative) paths.add(`${dir}/${relative}`);
    }
  } else if (item.store === 'archiveStories') {
    const story = item.record as unknown as ArchiveStory;
    paths.add(`${dir}/聊天.jsonl`);
    const stems: string[] = [];
    for (const branch of story.branches ?? []) {
      const stem = ensureUnique('分支·' + safeName(branch.name, '未命名分支'), stems);
      stems.push(stem); paths.add(`${dir}/${stem}.jsonl`);
    }
    for (const path of files.keys()) if (path.startsWith(dir + '/') && runtimeOwned(path.slice(dir.length + 1), story)) paths.add(path);
  } else if (item.store === 'cards') paths.add(item.path.replace(/\.json$/, '.png'));
  return new Set([...paths].filter(path => files.has(path)));
}

function collectStringReferences(value: unknown, add: (path: string) => void): void {
  if (typeof value === 'string') { if (safePath(value)) add(value); return; }
  if (Array.isArray(value)) { value.forEach(child => collectStringReferences(child, add)); return; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    // Import provenance does not grant ownership or permission to delete its source.
    if (key !== 'sourcePath') collectStringReferences(child, add);
  }
}

async function inventory(fs: VaultFs, ignoredJournal?: string): Promise<Inventory> {
  const result: Inventory = { files: new Map(), directories: new Set(), records: [], errors: [], known: new Set(), references: new Map() };
  let visited = 0;
  async function walk(dir: string, depth: number) {
    if (depth > 40 || ++visited > 100000) { result.errors.push('目录过深或文件过多，扫描未完成'); return; }
    let entries: VaultEntry[];
    try { entries = await fs.list(dir); } catch (error) { result.errors.push(`${dir}: ${errorText(error)}`); return; }
    for (const entry of entries) {
      if (!isSafeFileSegment(entry.name) || entry.isSymlink) { result.errors.push(`${joinPath(dir, entry.name)}: 已跳过链接或非法路径`); continue; }
      const path = joinPath(dir, entry.name);
      if (entry.isDir) { result.directories.add(path); await walk(path, depth + 1); }
      else result.files.set(path, entry);
    }
  }
  await walk('', 0);
  for (const path of result.files.keys()) {
    const store = recordStore(path);
    if (!store) continue;
    try {
      const raw = path.endsWith('.md') ? parseFrontmatter(await fs.readText(path)).fields : JSON.parse(await fs.readText(path));
      const record = ['worldbooks', 'presets', 'regexes'].includes(store) ? raw.__ste : raw;
      if (!record || typeof record.id !== 'string') {
        // Valid ST files with no STE identity are user files, never cleanup candidates.
        if (['worldbooks', 'presets', 'regexes'].includes(store)) continue;
        throw new Error('缺少记录身份');
      }
      const item: DiskRecord = { store, path, record };
      if (result.records.some(existing => recordKey(existing) === recordKey(item))) result.errors.push(`${path}: 记录身份重复，需先确认原件`);
      result.records.push(item);
      // Include raw asset payload references as well as its STE metadata.
      collectStringReferences(raw, reference => {
        for (const candidate of [reference, joinPath(parentDir(path), reference)]) {
          const owners = result.references.get(pathKey(candidate)) ?? new Set<string>();
          owners.add(recordKey(item)); result.references.set(pathKey(candidate), owners);
        }
      });
    } catch (error) { result.errors.push(`${path}: ${errorText(error)}`); }
  }
  for (const item of result.records) {
    try {
      for (const path of ownedPaths(item, result.files)) {
        result.known.add(path);
        const owners = result.references.get(pathKey(path)) ?? new Set<string>();
        owners.add(recordKey(item)); result.references.set(pathKey(path), owners);
      }
    } catch (error) { result.errors.push(`${item.path}: ${errorText(error)}`); }
  }
  // Journals can refer to files absent from the latest record; unresolved ones block cleanup.
  for (const path of result.files.keys()) {
    if (path.startsWith(RETAINED + '/')) continue;
    if (path === ignoredJournal) continue;
    if (path.startsWith('.ste/moves/') && path.endsWith('/manifest.json')) { result.errors.push(`${path}: 记录移动需要先完成恢复`); continue; }
    if (path.includes('/portrait-journal/')) { result.errors.push(`${path}: 立绘操作需要先完成恢复`); continue; }
    if (/\/(?:memory-journal|memory-updates|maintenance)\/|\/inheritance\.json$|\/turns\//.test(path)) {
      try {
        const value = JSON.parse(await fs.readText(path));
        if (value?.schema !== 1 || !['committed', 'rolled-back', 'resolved', 'complete', 'succeeded', 'failed', 'cancelled', 'adopted'].includes(value.status)) throw new Error('存在未完成或无效的恢复记录');
        if (path.includes('/memory-journal/') && (typeof value.operationId !== 'string'
          || !/^[a-f0-9]{64}$/.test(value.proposalDigest) || typeof value.manual !== 'boolean'
          || !Array.isArray(value.sourceRefs) || !Array.isArray(value.changes) || !value.changes.length
          || value.changes.some((change: { path?: unknown; before?: unknown; after?: unknown }) => !change
            || !safePath(change.path) || !change.path.endsWith('.md') || typeof change.after !== 'string'
            || change.before !== null && typeof change.before !== 'string'))) throw new Error('记忆恢复记录格式无效');
      } catch (error) { result.errors.push(`${path}: ${errorText(error)}`); }
    }
  }
  return result;
}

export async function prepareFileRemoval(vault: VaultBackend, store: StoreName, id: string): Promise<FileRemovalPreview> {
  const path = await vault.pathOf(store, id);
  const preview: FileRemovalPreview = { store, id, files: [], count: 0, bytes: 0, usesTrash: !!vault.fs.trashFile };
  if (!path) return preview;
  const disk = await inventory(vault.fs);
  if (disk.errors.length) throw new Error(`文件检查未完成，已停止删除：${disk.errors.join('；')}`);
  const item = disk.records.find(record => record.store === store && record.record.id === id);
  if (!item) throw new Error('记录已改变或无法读取，请重新检查');
  for (const file of ownedPaths(item, disk.files)) {
    const owners = disk.references.get(pathKey(file));
    if (owners && [...owners].some(owner => owner !== recordKey(item))) continue;
    const entry = disk.files.get(file)!;
    preview.files.push({ path: file, size: entry.size, version: await fileVersion(vault.fs, file) });
  }
  if (!preview.files.some(file => file.path === item.path)) throw new Error('记录文件仍被其他条目引用，已停止删除');
  preview.count = preview.files.length;
  preview.bytes = preview.files.reduce((total, file) => total + file.size, 0);
  return preview;
}

async function readManifest(fs: VaultFs, operationId: string): Promise<Manifest> {
  const path = manifestPath(operationId);
  await assertSafePath(fs, path);
  const value = JSON.parse(await fs.readText(path)) as Manifest;
  if (value?.schema !== 1 || value.operationId !== operationId || !operationIdPattern.test(operationId)
    || typeof value.id !== 'string' || typeof value.store !== 'string' || typeof value.deleteFiles !== 'boolean'
    || !Array.isArray(value.files) || new Set(value.files.map(file => pathKey(file.path))).size !== value.files.length
    || value.files.some(file => !safePath(file.path) || file.path.startsWith('.ste/')
      || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.version))) {
    throw new Error(`保留区恢复清单损坏：${path}`);
  }
  return value;
}

async function isCommitted(fs: VaultFs, manifest: Manifest): Promise<boolean> {
  const path = `${RETAINED}/${manifest.operationId}/committed.json`;
  if (!(await fs.stat(path)).exists) return false;
  await assertSafePath(fs, path);
  const marker = JSON.parse(await fs.readText(path));
  if (marker.digest !== sha256(JSON.stringify(manifest))) throw new Error(`保留区提交记录损坏：${path}`);
  return true;
}

async function rollback(fs: VaultFs, manifest: Manifest): Promise<void> {
  for (const file of [...manifest.files].reverse()) {
    const staged = stagedPath(manifest, file.path);
    const atSource = (await fs.stat(file.path)).exists, atTarget = (await fs.stat(staged)).exists;
    if (atSource === atTarget) throw new Error(`无法自动还原，原文件与保留文件状态冲突：${file.path}`);
    const present = atTarget ? staged : file.path;
    if (await fileVersion(fs, present) !== file.version) throw new Error(`文件已更改，需手动恢复：${present}`);
    if (atTarget) {
      await assertSafePath(fs, file.path, true);
      await fs.mkdir(parentDir(file.path));
      await fs.rename(staged, file.path);
    }
  }
  await fs.removeFile(manifestPath(manifest.operationId));
}

/** Prepared operations have no committed deletion: recover all their source files first. */
export async function recoverFileMaintenance(fs: VaultFs): Promise<void> {
  await recoverRecordMoves(fs);
  await assertSafePath(fs, RETAINED, true);
  for (const entry of await fs.list(RETAINED)) {
    if (entry.isSymlink || !entry.isDir || !operationIdPattern.test(entry.name)) throw new Error('保留区存在无法确认的恢复内容，请先检查');
    if (activeOperations.get(fs)?.has(entry.name)) continue;
    if (!(await fs.stat(manifestPath(entry.name))).exists) {
      // Completed rollbacks leave empty directories, but never unpublished files.
      const scan = await inventory(fs);
      if ([...scan.files.keys()].some(path => path.startsWith(`${RETAINED}/${entry.name}/`))) throw new Error('保留区缺少恢复清单');
      continue;
    }
    const manifest = await readManifest(fs, entry.name);
    if (!await isCommitted(fs, manifest)) await rollback(fs, manifest);
  }
}

export async function executeFileRemoval(vault: VaultBackend, store: StoreName, id: string, options: RemoveOptions): Promise<void> {
  const epoch = getVaultEpoch();
  const fs = vault.fs;
  await recoverFileMaintenance(fs);
  const preview = await prepareFileRemoval(vault, store, id);
  if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，删除已停止');
  if (!preview.count) return;
  const operationId = crypto.randomUUID();
  const manifest: Manifest = { schema: 1, operationId, store, id, createdAt: Date.now(), deleteFiles: options.deleteFiles, files: preview.files };
  await movePreparedFiles(fs, manifest);
}

/** Finish a portrait deletion after its own metadata journal has committed. */
export async function finalizeRetainedFiles(fs: VaultFs, options: {
  operationId: string; store: StoreName; id: string; paths: string[]; deleteFiles: boolean;
}): Promise<void> {
  if (!options.paths.length) return;
  const epoch = getVaultEpoch();
  if (!operationIdPattern.test(options.operationId) || options.paths.some(path => !safePath(path) || path.startsWith('.ste/'))) throw new Error('文件保留操作路径无效');
  const existing = (await fs.stat(manifestPath(options.operationId))).exists;
  if (existing) {
    const manifest = await readManifest(fs, options.operationId);
    if (manifest.store !== options.store || manifest.id !== options.id || manifest.deleteFiles !== options.deleteFiles
      || manifest.files.some(file => !options.paths.includes(file.path))) throw new Error('文件保留操作身份冲突');
    if (await isCommitted(fs, manifest)) {
      if (options.deleteFiles) for (const file of manifest.files) {
        if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，文件清理已停止');
        const path = stagedPath(manifest, file.path);
        if (!(await fs.stat(path)).exists) continue;
        if (await fileVersion(fs, path) !== file.version) throw new Error(`文件已改变：${path}`);
        await (fs.trashFile ? fs.trashFile(path) : fs.removeFile(path));
      }
      return;
    }
    await rollback(fs, manifest);
  }
  const characterDirectory = options.paths[0].split('/').slice(0, 2).join('/');
  const disk = await inventory(fs, `${characterDirectory}/.ste-control/portrait-journal/${options.operationId}.json`);
  if (disk.errors.length) throw new Error(`文件检查未完成：${disk.errors.join('；')}`);
  const files: ManagedFile[] = [];
  for (const path of new Set(options.paths)) {
    if (disk.references.has(pathKey(path))) continue;
    const entry = disk.files.get(path);
    if (entry) files.push({ path, size: entry.size, version: await fileVersion(fs, path) });
  }
  if (!files.length) return;
  if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，文件保留已停止');
  await movePreparedFiles(fs, { schema: 1, operationId: options.operationId, store: options.store, id: options.id, createdAt: Date.now(), deleteFiles: options.deleteFiles, files });
}

async function movePreparedFiles(fs: VaultFs, manifest: Manifest): Promise<void> {
  const { operationId } = manifest;
  const epoch = getVaultEpoch();
  const check = () => { if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，文件操作已停止'); };
  const root = `${RETAINED}/${operationId}`;
  let active = activeOperations.get(fs);
  if (!active) { active = new Set(); activeOperations.set(fs, active); }
  active.add(operationId);
  let committed = false;
  try {
    await assertSafePath(fs, root, true);
    await fs.mkdir(root);
    await fs.writeText(manifestPath(operationId), JSON.stringify(manifest));
    // Read back durable intent before touching the first source file.
    await readManifest(fs, operationId);
    for (const file of manifest.files) {
      check();
      if (await fileVersion(fs, file.path) !== file.version) throw new Error(`文件已改变，请重新确认：${file.path}`);
      const target = stagedPath(manifest, file.path);
      await assertSafePath(fs, target, true);
      await fs.mkdir(parentDir(target));
      check();
      await fs.rename(file.path, target);
    }
    check();
    await fs.writeText(`${root}/committed.json`, JSON.stringify({ digest: sha256(JSON.stringify(manifest)) }));
    committed = await isCommitted(fs, manifest);
    if (manifest.deleteFiles) {
      for (const file of manifest.files) {
        check();
        const path = stagedPath(manifest, file.path);
        if (await fileVersion(fs, path) !== file.version) throw new Error(`保留文件已改变：${path}`);
        await (fs.trashFile ? fs.trashFile(path) : fs.removeFile(path));
      }
    }
    const directories = new Set<string>();
    for (const file of manifest.files) {
      let dir = parentDir(file.path);
      while (dir && dir.includes('/')) { directories.add(dir); dir = parentDir(dir); }
    }
    for (const dir of [...directories].sort((a, b) => b.length - a.length)) { check(); await fs.removeEmptyDir(dir); }
  } catch (error) {
    if (!committed) {
      // Lost write responses can still have committed successfully.
      try { committed = await isCommitted(fs, manifest); } catch { /* Leave corrupt marker blocked for inspection. */ }
    }
    if (committed) throw Object.assign(new Error(`条目已移除，部分文件仍保留在 ${root}，请在文件检查中重试：${errorText(error)}`), { committed: true, operationId });
    try { await rollback(fs, manifest); }
    catch (recoveryError) { throw new Error(`${errorText(error)}；恢复未完成：${errorText(recoveryError)}。保留区：${root}`); }
    throw error;
  } finally { active.delete(operationId); }
}

export async function scanVaultFiles(vault: VaultBackend): Promise<FileMaintenanceScan> {
  const epoch = getVaultEpoch(), fs = vault.fs;
  const disk = await inventory(fs);
  const entries: FileMaintenanceEntry[] = [];
  const retained = new Map<string, ManagedFile>();
  for (const entry of await fs.list(RETAINED).catch(error => { disk.errors.push(errorText(error)); return []; })) {
    if (!entry.isDir || entry.isSymlink || !operationIdPattern.test(entry.name)) { disk.errors.push('保留区含未知恢复内容'); continue; }
    if (!(await fs.stat(manifestPath(entry.name))).exists) continue;
    try {
      const manifest = await readManifest(fs, entry.name);
      disk.known.add(manifestPath(entry.name));
      if (!await isCommitted(fs, manifest)) throw new Error('删除操作未完成，请重新打开库以恢复');
      disk.known.add(`${RETAINED}/${entry.name}/committed.json`);
      for (const file of manifest.files) retained.set(stagedPath(manifest, file.path), file);
    } catch (error) { disk.errors.push(`${entry.name}: ${errorText(error)}`); }
  }
  for (const [path, entry] of disk.files) {
    if (disk.known.has(path)) continue;
    let category: MaintenanceCategory = 'unknown', reason = '无法确认归属，仅供查看', version = '';
    if (retained.has(path)) {
      if (disk.references.has(pathKey(path))) reason = '保留文件正在被有效记录引用，仅供查看';
      else { category = 'retained'; reason = `删除时保留；原路径：${retained.get(path)!.path}`; }
    }
    else if (/^角色\/[^/]+\/立绘\/[^/]+\/\.ste-portrait-[a-f0-9-]{36}-\d+\.(?:png|jpe?g|webp|gif|tmp)$/i.test(path)
      && !disk.references.has(pathKey(path))) { category = 'unreferenced'; reason = 'STE 创建的立绘文件，当前档案与恢复记录均无引用'; }
    if (category !== 'unknown') {
      try {
        version = await fileVersion(fs, path);
        if (category === 'retained' && version !== retained.get(path)!.version) { category = 'unknown'; reason = '保留文件已改变，需手动检查'; }
      } catch (error) { disk.errors.push(`${path}: ${errorText(error)}`); category = 'unknown'; }
    }
    entries.push({ path, size: entry.size, version, category, reason, selectable: category !== 'unknown' });
  }
  for (const path of disk.directories) {
    if (![...disk.files.keys(), ...disk.directories].some(child => parentDir(child) === path)) {
      entries.push({ path, size: 0, version: '', category: 'empty-directory', reason: '目录为空，清理前将再次检查', selectable: true });
    }
  }
  if (disk.errors.length) for (const entry of entries) entry.selectable = false;
  return { vault, epoch, createdAt: Date.now(), entries, complete: disk.errors.length === 0, errors: disk.errors,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0), usesTrash: !!fs.trashFile };
}

export async function cleanupVaultFiles(scan: FileMaintenanceScan, selectedPaths: string[]): Promise<FileCleanupResult> {
  const { vault, epoch } = scan, fs = vault.fs;
  const check = () => { if (getVaultEpoch() !== epoch || getActiveVault() && getActiveVault() !== vault) throw new Error('文件库已切换，请重新检查'); };
  check();
  if (!scan.complete) throw new Error('检查未完成，不能安全清理');
  const result: FileCleanupResult = { removed: [], skipped: [], failed: [], bytes: 0, usesTrash: !!fs.trashFile };
  for (const path of new Set(selectedPaths)) {
    check();
    const original = scan.entries.find(entry => entry.path === path);
    if (!original?.selectable) { result.skipped.push({ path, reason: '不属于可清理的检查结果' }); continue; }
    try {
      // Re-read references between files; a previous await may allow another operation to attach one.
      const fresh = await scanVaultFiles(vault);
      check();
      const current = fresh.entries.find(entry => entry.path === path);
      if (!fresh.complete || !current?.selectable || current.category !== original.category || current.version !== original.version) {
        result.skipped.push({ path, reason: '文件、引用或恢复状态已改变，请重新检查' }); continue;
      }
      await assertSafePath(fs, path);
      check();
      if (current.category === 'empty-directory') {
        if (!await fs.removeEmptyDir(path)) { result.skipped.push({ path, reason: '目录已不为空' }); continue; }
      } else {
        if (await fileVersion(fs, path) !== original.version) { result.skipped.push({ path, reason: '文件已改变' }); continue; }
        check(); await (fs.trashFile ? fs.trashFile(path) : fs.removeFile(path));
      }
      result.removed.push(path); result.bytes += current.size;
    } catch (error) { result.failed.push({ path, reason: errorText(error) }); }
  }
  return result;
}

interface RecordMove {
  schema: 1; operationId: string; from: string; to: string; before: string; after: string;
}
const MOVE_ROOT = '.ste/moves';
const activeRecordMoves = new WeakMap<VaultFs, Set<string>>();
async function finishRecordMove(fs: VaultFs, move: RecordMove, committed: boolean): Promise<void> {
  const root = `${MOVE_ROOT}/${move.operationId}`, backup = `${root}/before`, staged = `${root}/after`;
  if (committed) {
    if (!(await fs.stat(move.to)).exists || await fileVersion(fs, move.to) !== move.after || (await fs.stat(move.from)).exists) throw new Error('已提交移动的文件状态冲突，请检查恢复记录');
  } else {
    if ((await fs.stat(move.to)).exists) {
      if (await fileVersion(fs, move.to) !== move.after || (await fs.stat(staged)).exists) throw new Error('移动目标已改变，请手动恢复');
      await fs.rename(move.to, staged);
    }
    const original = (await fs.stat(move.from)).exists, saved = (await fs.stat(backup)).exists;
    if (original === saved) throw new Error('移动原文件状态冲突，请手动恢复');
    if (await fileVersion(fs, original ? move.from : backup) !== move.before) throw new Error('移动原文件已改变');
    if (saved) { await assertSafePath(fs, move.from, true); await fs.mkdir(parentDir(move.from)); await fs.rename(backup, move.from); }
  }
  // Sources are safe now. A failed metadata cleanup can be retried on reopen.
  for (const path of [backup, staged]) if ((await fs.stat(path)).exists) await fs.removeFile(path);
  await fs.removeFile(`${root}/manifest.json`);
  if ((await fs.stat(`${root}/committed.json`)).exists) await fs.removeFile(`${root}/committed.json`);
  await fs.removeEmptyDir(root);
}

async function recoverRecordMoves(fs: VaultFs): Promise<void> {
  await assertSafePath(fs, MOVE_ROOT, true);
  for (const entry of await fs.list(MOVE_ROOT)) {
    if (activeRecordMoves.get(fs)?.has(entry.name)) continue;
    if (!entry.isDir || entry.isSymlink || !operationIdPattern.test(entry.name)) throw new Error('移动恢复目录含未知内容');
    const root = `${MOVE_ROOT}/${entry.name}`, path = `${root}/manifest.json`;
    if (!(await fs.stat(path)).exists) continue;
    await assertSafePath(fs, path);
    const move = JSON.parse(await fs.readText(path)) as RecordMove;
    if (move?.schema !== 1 || move.operationId !== entry.name || !safePath(move.from) || !safePath(move.to)
      || move.from.startsWith('.ste/') || move.to.startsWith('.ste/') || !/^[a-f0-9]{64}$/.test(move.before) || !/^[a-f0-9]{64}$/.test(move.after)) throw new Error('移动恢复记录损坏');
    let committed = false;
    if ((await fs.stat(`${root}/committed.json`)).exists) {
      const marker = JSON.parse(await fs.readText(`${root}/committed.json`));
      if (marker.digest !== sha256(JSON.stringify(move))) throw new Error('移动提交记录损坏');
      committed = true;
    }
    await finishRecordMove(fs, move, committed);
  }
}

/** Preserve one record identity through a cross-directory save, including process restarts. */
export async function moveRecordFile(fs: VaultFs, from: string, to: string, content: string): Promise<void> {
  const epoch = getVaultEpoch();
  await recoverRecordMoves(fs);
  await assertSafePath(fs, from);
  await assertSafePath(fs, to, true);
  if ((await fs.stat(to)).exists) throw new Error('记录移动目标已存在');
  const operationId = crypto.randomUUID(), root = `${MOVE_ROOT}/${operationId}`;
  let active = activeRecordMoves.get(fs);
  if (!active) { active = new Set(); activeRecordMoves.set(fs, active); }
  active.add(operationId);
  const check = () => { if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，记录移动已停止'); };
  try {
  check();
  await fs.mkdir(root);
  await fs.writeText(`${root}/after`, content);
  const move: RecordMove = { schema: 1, operationId, from, to, before: await fileVersion(fs, from), after: await fileVersion(fs, `${root}/after`) };
  await fs.writeText(`${root}/manifest.json`, JSON.stringify(move));
  if (await fs.readText(`${root}/manifest.json`) !== JSON.stringify(move)) throw new Error('移动恢复记录写入失败');
  let committed = false;
  try {
    check(); await fs.rename(from, `${root}/before`);
    check(); await fs.mkdir(parentDir(to));
    check(); await fs.rename(`${root}/after`, to);
    check(); await fs.writeText(`${root}/committed.json`, JSON.stringify({ digest: sha256(JSON.stringify(move)) }));
    committed = true;
  } catch (error) {
    if ((await fs.stat(`${root}/committed.json`)).exists) {
      try { committed = JSON.parse(await fs.readText(`${root}/committed.json`)).digest === sha256(JSON.stringify(move)); } catch { /* Recovery remains blocked. */ }
    }
    if (!committed) {
      try { await finishRecordMove(fs, move, false); }
      catch (restoreError) { throw new Error(`${errorText(error)}；恢复未完成：${errorText(restoreError)}`); }
      throw error;
    }
  }
  // Once the target is committed, cleanup errors must not make callers retry the logical move.
  await finishRecordMove(fs, move, true).catch(error => console.warn('[vault] 移动已提交，恢复记录待清理', error));
  } finally { active.delete(operationId); }
}
