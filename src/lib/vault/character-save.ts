import { sha256 } from 'js-sha256';
import type { VaultFs } from './fs';
import { assertSafePath } from './file-maintenance';
import { mutationCoordinator } from './mutation-coordinator';
import { ARCHIVE_SCHEMA_VERSION } from '@/lib/archive-schema';
import { assertCompatibleVault } from './vault-format';

const ROOT = '.ste-control/character-saves';
const UUID = /^[a-f0-9-]{36}$/i;
const HASH = /^[a-f0-9]{64}$/;
type Slot = 'profile' | 'png';
const names: Record<Slot, string> = { profile: '档案.json', png: '卡片.png' };
interface Pair { before: string | null; after: string | null }
interface Manifest {
  schema: 1; operationId: string; characterId: string; from: string | null; to: string;
  files: { profile: Pair; png?: Pair };
}
const digest = (slot: Slot, content: string) => sha256(`${slot}:${content}`);
const slots = (m: Manifest): Slot[] => m.files.png ? ['profile', 'png'] : ['profile'];
const failure = () => new Error('角色保存恢复记录与文件不一致，已保留现场并停止写入');

async function read(fs: VaultFs, path: string, slot: Slot): Promise<string | null> {
  await assertSafePath(fs, path, true);
  if (!(await fs.stat(path)).exists) return null;
  return slot === 'png' ? fs.readBinary(path) : fs.readText(path);
}
async function write(fs: VaultFs, path: string, slot: Slot, content: string | null): Promise<void> {
  try {
    if (content !== null) {
      if (slot === 'png') await fs.writeBinary(path, content);
      else await fs.writeText(path, content);
    } else if ((await fs.stat(path)).exists) await fs.removeFile(path);
  } catch (error) {
    // A failed IPC response is not proof that the atomic file operation failed.
    if (await read(fs, path, slot) !== content) throw error;
  }
}
async function snapshot(fs: VaultFs, root: string, slot: Slot, phase: 'before' | 'after', hash: string | null): Promise<string | null> {
  if (hash === null) return null;
  const content = await read(fs, `${root}/${phase}-${slot}`, slot);
  if (content === null || digest(slot, content) !== hash) throw failure();
  return content;
}

async function cleanup(fs: VaultFs, m: Manifest): Promise<void> {
  const root = `${ROOT}/${m.operationId}`;
  for (const slot of slots(m)) for (const phase of ['before', 'after'] as const) {
    const path = `${root}/${phase}-${slot}`;
    const content = await read(fs, path, slot);
    if (content !== null && digest(slot, content) !== m.files[slot]![phase]) throw failure();
  }
  // Retire the intent before deleting its snapshots. An interruption can leave
  // harmless staging files, never a live manifest with a missing rollback image.
  if ((await fs.stat(`${root}/manifest.json`)).exists) await fs.removeFile(`${root}/manifest.json`);
  for (const name of ['committed.json', ...slots(m).flatMap(slot => [`before-${slot}`, `after-${slot}`])]) {
    const path = `${root}/${name}`;
    await assertSafePath(fs, path, true);
    if ((await fs.stat(path)).exists) await fs.removeFile(path);
  }
  await fs.removeEmptyDir(root);
  await fs.removeEmptyDir(ROOT);
  await fs.removeEmptyDir('.ste-control');
}

async function committed(fs: VaultFs, m: Manifest): Promise<boolean> {
  const path = `${ROOT}/${m.operationId}/committed.json`;
  await assertSafePath(fs, path, true);
  if (!(await fs.stat(path)).exists) return false;
  if (JSON.parse(await fs.readText(path)).digest !== sha256(JSON.stringify(m))) throw failure();
  return true;
}

async function rollback(fs: VaultFs, m: Manifest): Promise<void> {
  const root = `${ROOT}/${m.operationId}`;
  await assertSafePath(fs, m.to, true);
  if (m.from) await assertSafePath(fs, m.from, true);
  const targetExists = (await fs.stat(m.to)).exists;
  const sourceExists = m.from !== null && (await fs.stat(m.from)).exists;
  if (m.from && m.from !== m.to && sourceExists && targetExists || m.from && !sourceExists && !targetExists) throw failure();
  const directory = targetExists ? m.to : m.from;
  // Validate every file and backup before touching either member of the pair.
  const restore: { slot: Slot; before: string | null; current: string | null }[] = [];
  for (const slot of slots(m)) {
    const pair = m.files[slot]!;
    const before = await snapshot(fs, root, slot, 'before', pair.before);
    const current = directory ? await read(fs, `${directory}/${names[slot]}`, slot) : null;
    const hash = current === null ? null : digest(slot, current);
    if (hash !== pair.before && hash !== pair.after) throw failure();
    restore.push({ slot, before, current });
  }
  if (directory) {
    for (const { slot, before, current } of restore) {
      if (current !== before) await write(fs, `${directory}/${names[slot]}`, slot, before);
    }
    if (m.from && directory !== m.from) await fs.rename(directory, m.from);
    if (!m.from) await fs.removeEmptyDir(directory); // Unknown user files remain.
  }
  await cleanup(fs, m);
}

function validate(value: Manifest, operationId: string): void {
  const dir = (path: unknown) => typeof path === 'string' && /^角色\/[^/]+$/.test(path);
  const pair = (entry: Pair | undefined) => entry && [entry.before, entry.after].every(hash => hash === null || typeof hash === 'string' && HASH.test(hash));
  if (!value || value.schema !== 1 || value.operationId !== operationId || typeof value.characterId !== 'string' || !value.characterId
    || !dir(value.to) || value.from !== null && !dir(value.from) || !value.files || !pair(value.files.profile)
    || value.files.profile.after === null || value.files.png !== undefined && !pair(value.files.png)) throw failure();
}

/** Recovery mutates disk even when entered by a read; share its gate across handles.
 * Keep it separate from the record gate because both readers and writers await it. */
export function recoverCharacterSaves(fs: VaultFs): Promise<void> {
  return mutationCoordinator(fs).queue.enqueue('character-recovery', () => recoverCharacterSavesUnlocked(fs));
}

/** Run before indexing or a new write. Unknown/changed files block rollback. */
async function recoverCharacterSavesUnlocked(fs: VaultFs): Promise<void> {
  await assertSafePath(fs, ROOT, true);
  for (const entry of await fs.list(ROOT)) {
    if (!UUID.test(entry.name) || !entry.isDir || entry.isSymlink) throw failure();
    if (mutationCoordinator(fs).activeCharacterSaves.has(entry.name)) continue;
    const path = `${ROOT}/${entry.name}/manifest.json`;
    await assertSafePath(fs, path, true);
    if (!(await fs.stat(path)).exists) continue; // Unpublished staging cannot have changed a character.
    const m = JSON.parse(await fs.readText(path)) as Manifest;
    validate(m, entry.name);
    if (await committed(fs, m)) await cleanup(fs, m);
    else await rollback(fs, m);
  }
}

/** Caller holds the library mutation queue; publish the index only after this resolves. */
export async function saveCharacterFiles(fs: VaultFs, input: {
  id: string; from?: string; to: string; profile: string; png?: string; derivedUnchanged: boolean;
}): Promise<void> {
  await recoverCharacterSaves(fs);
  if (input.derivedUnchanged && input.from === input.to) {
    const path = `${input.to}/${names.profile}`;
    const before = await read(fs, path, 'profile');
    if (before === null || JSON.parse(before).id !== input.id) throw failure();
    // One atomic file is sufficient when neither the image nor its directory changes.
    await write(fs, path, 'profile', input.profile);
    return;
  }
  // Persist the compatibility gate before publishing any new recovery journal.
  // Older builds must refuse this library even if this process stops mid-save.
  await assertCompatibleVault(fs);
  const metadataPath = '库信息.json';
  const metadata = (await fs.stat(metadataPath)).exists ? JSON.parse(await fs.readText(metadataPath)) : {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw failure();
  if (!(metadata.schemaVersion >= ARCHIVE_SCHEMA_VERSION)) {
    const text = JSON.stringify({ id: 'archive-schema', updatedAt: 0, ...metadata,
      tagMigrationVersion: metadata.tagMigrationVersion ?? Math.min(metadata.schemaVersion ?? 1, 2), schemaVersion: ARCHIVE_SCHEMA_VERSION });
    await write(fs, metadataPath, 'profile', text);
    if (await fs.readText(metadataPath) !== text) throw failure();
  }
  const operationId = crypto.randomUUID(), root = `${ROOT}/${operationId}`;
  const active = mutationCoordinator(fs).activeCharacterSaves;
  active.add(operationId);
  try {
    await assertSafePath(fs, root, true);
    await assertSafePath(fs, input.to, true);
    if (input.from) await assertSafePath(fs, input.from);
    if (input.from !== input.to && (await fs.stat(input.to)).exists) throw failure();
    const m: Manifest = { schema: 1, operationId, characterId: input.id, from: input.from ?? null, to: input.to,
      files: { profile: { before: null, after: digest('profile', input.profile) } } };
    if (!input.derivedUnchanged) m.files.png = { before: null, after: input.png ? digest('png', input.png) : null };
    for (const slot of slots(m)) {
      const before = input.from ? await read(fs, `${input.from}/${names[slot]}`, slot) : null;
      if (slot === 'profile' && input.from && (before === null || JSON.parse(before).id !== input.id)) throw failure();
      m.files[slot]!.before = before === null ? null : digest(slot, before);
      const after = slot === 'profile' ? input.profile : input.png || null;
      if (before !== null) await write(fs, `${root}/before-${slot}`, slot, before);
      if (after !== null) await write(fs, `${root}/after-${slot}`, slot, after);
      await snapshot(fs, root, slot, 'before', m.files[slot]!.before);
      await snapshot(fs, root, slot, 'after', m.files[slot]!.after);
    }
    await fs.writeText(`${root}/manifest.json`, JSON.stringify(m));
    if (await fs.readText(`${root}/manifest.json`) !== JSON.stringify(m)) throw failure();
    try {
      if (input.from && input.from !== input.to) await fs.rename(input.from, input.to);
      else await fs.mkdir(input.to);
      for (const slot of slots(m)) {
        const content = await snapshot(fs, root, slot, 'after', m.files[slot]!.after);
        await write(fs, `${input.to}/${names[slot]}`, slot, content);
        if (await read(fs, `${input.to}/${names[slot]}`, slot) !== content) throw failure();
      }
      await fs.writeText(`${root}/committed.json`, JSON.stringify({ digest: sha256(JSON.stringify(m)) }));
    } catch (error) {
      // An IPC response can be lost after a successful atomic commit write.
      if (!await committed(fs, m)) { await rollback(fs, m); throw error; }
    }
    // A committed save must not become a failed logical operation due to cleanup.
    await cleanup(fs, m).catch(() => { /* Recovery retries cleanup before the next save. */ });
  } finally { active.delete(operationId); }
}
