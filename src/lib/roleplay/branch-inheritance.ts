import { getBranchLine, updateArchiveStory } from '@/lib/archive-db';
import type { Repo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import type { WorldBookItem } from '@/types/worldbook';
import { digest, sourceRefs, stableJson, type SourceRef } from './fingerprint';
import { createMemoryRepository } from './memory';
import { branchKey, isRuntimePath } from './paths';
import type { RuntimeStore } from './runtime-store';
import { createWorldbookVersions } from './worldbook-versions';

export interface BranchRuntimeParent {
  schema: 1;
  storyId: string;
  branchId: string;
  parentBranchId: string | null;
  sourceRefs: SourceRef[];
}

interface InheritanceFile { path: string; text: string }
interface InheritancePlan {
  schema: 1;
  parent: BranchRuntimeParent;
  files: InheritanceFile[];
  digest: string;
  status: 'prepared' | 'complete';
  preserved: string[];
}

export interface BranchInheritanceResult {
  status: 'not-needed' | 'complete';
  inherited: string[];
  /** Planned paths left unpublished to preserve existing files or an independently edited lore entry. */
  preserved: string[];
}

export interface BranchInheritanceOptions {
  storyId: string;
  branchId: string | null;
  store: RuntimeStore;
  stories: Repo<ArchiveStory>;
  worldbooks: Repo<WorldBookItem>;
  isCurrent?: () => boolean;
  /** Caller already holds the story queue and supplies its latest persisted snapshot. */
  lockedStory?: ArchiveStory;
}

/** Capture identities while the fork is created; ST's main_chat filename remains only a label. */
export function captureBranchRuntimeParent(storyId: string, branchId: string, parentBranchId: string | null,
  parent: ChatSession, child: ChatSession): BranchRuntimeParent {
  const original = sourceRefs(parent), copied = sourceRefs(child), shared: SourceRef[] = [];
  for (let i = 0; i < Math.min(original.length, copied.length); i++) {
    if (stableJson(original[i]) !== stableJson(copied[i])) break;
    shared.push(original[i]);
  }
  return { schema: 1, storyId, branchId, parentBranchId, sourceRefs: shared };
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const planDigest = (parent: BranchRuntimeParent, files: InheritanceFile[]) => digest(stableJson({ schema: 1, parent, files }));
const unused = (): BranchInheritanceResult => ({ status: 'not-needed', inherited: [], preserved: [] });

function readParent(session: ChatSession, storyId: string, branchId: string): BranchRuntimeParent | null {
  const value = session.rawMetadata?.ste_catalog?.runtimeParent;
  if (value === undefined) return null;
  if (!value || value.schema !== 1 || value.storyId !== storyId || value.branchId !== branchId
    || (value.parentBranchId !== null && !validId(value.parentBranchId)) || value.parentBranchId === branchId
    || !Array.isArray(value.sourceRefs) || value.sourceRefs.some((ref: SourceRef) => !ref || !validId(ref.messageId)
      || !validId(ref.candidateId) || !validDigest(ref.contentDigest) || !validDigest(ref.historyDigest))
    || new Set(value.sourceRefs.map((ref: SourceRef) => ref.messageId)).size !== value.sourceRefs.length) {
    throw new Error('分支继承来源记录无效，请保留原文件并检查分支资料');
  }
  return structuredClone(value) as BranchRuntimeParent;
}

function destinationPath(path: unknown, branchId: string): path is string {
  if (!isRuntimePath(path)) return false;
  const memory = `memory/${branchKey(branchId)}/`, control = `.ste-control/roleplay/${branchKey(branchId)}/`;
  if (path.startsWith(memory)) return path.endsWith('.md') && path !== memory + 'index.md';
  if (!path.startsWith(control)) return false;
  const relative = path.slice(control.length);
  return relative === 'settings.json' || /^memory-journal\/[a-f0-9]{64}\.json$/.test(relative)
    || /^worldbook-versions\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(relative);
}

function parsePlan(text: string, parent: BranchRuntimeParent): InheritancePlan {
  let value: InheritancePlan;
  try { value = JSON.parse(text); } catch { throw new Error('分支继承计划 JSON 损坏，已保留原文件'); }
  if (value?.schema !== 1 || !['prepared', 'complete'].includes(value.status) || stableJson(value.parent) !== stableJson(parent)
    || !Array.isArray(value.files) || value.files.some(file => !file || !destinationPath(file.path, parent.branchId) || typeof file.text !== 'string')
    || new Set(value.files.map(file => file.path)).size !== value.files.length
    || !Array.isArray(value.preserved) || value.preserved.some(path => !value.files.some(file => file.path === path))
    || value.digest !== planDigest(parent, value.files)) throw new Error('分支继承计划已修改或格式无效，已保留原文件');
  return value;
}

/** Complete this before runtime reads/saves, outside any existing updateArchiveStory callback. */
export async function ensureBranchRuntime(options: BranchInheritanceOptions): Promise<BranchInheritanceResult> {
  const { storyId, branchId, stories } = options;
  const store = options.store.underStoryLock ?? options.store, epoch = getVaultEpoch();
  if (store.storyId !== storyId || !validId(storyId) || (branchId !== null && !validId(branchId))) throw new Error('分支继承与故事不匹配');
  function check() {
    if (getVaultEpoch() !== epoch || options.isCurrent?.() === false) throw new Error('文件库或会话已切换，分支继承已停止');
  }
  check();
  if (branchId === null) return unused();
  let result!: BranchInheritanceResult;
  const inherit = async (story: ArchiveStory) => {
    check();
    const visiting = new Set<string>();
    async function ensure(targetId: string): Promise<BranchInheritanceResult> {
      check();
      const line = getBranchLine(story, targetId);
      if (!line) throw new Error('继承目标分支不存在');
      const parent = readParent(line.session, storyId, targetId);
      if (!parent) return unused();
      if (visiting.has(targetId)) throw new Error('分支继承来源存在循环');
      visiting.add(targetId);
      const control = `.ste-control/roleplay/${branchKey(targetId)}`, path = `${control}/inheritance.json`;
      let previous = await store.read(path);
      check();
      let plan: InheritancePlan;
      if (previous !== null) plan = parsePlan(previous, parent);
      else {
        if (!getBranchLine(story, parent.parentBranchId)) throw new Error('继承来源分支不存在，不能改用同名聊天');
        if (parent.parentBranchId !== null) await ensure(parent.parentBranchId);
        const source = { ...options, branchId: parent.parentBranchId, store, repo: stories };
        const memory = await createMemoryRepository(source).inheritanceFiles(targetId, line.session, parent.sourceRefs);
        check();
        const versions = await createWorldbookVersions(source).inheritanceFiles(targetId, line.session, parent.sourceRefs);
        check();
        const files = [...memory, ...versions];
        const settings = await store.read(`.ste-control/roleplay/${branchKey(parent.parentBranchId)}/settings.json`);
        check();
        if (settings !== null) {
          const config = JSON.parse(settings);
          if (!config || !['classic', 'agent'].includes(config.mode) || !['none', 'native-agent', 'baibai'].includes(config.memoryOwner)
            || (config.mode === 'agent') !== (config.memoryOwner === 'native-agent')) throw new Error('父分支的游玩与记忆归属设置无效');
          files.push({ path: `${control}/settings.json`, text: JSON.stringify({ mode: config.mode, memoryOwner: config.memoryOwner }) });
        }
        files.sort((a, b) => a.path.localeCompare(b.path));
        plan = { schema: 1, parent, files, digest: planDigest(parent, files), status: 'prepared', preserved: [] };
        if (await store.read(path) !== null) throw new Error('分支继承计划已变化，请重试');
        check();
        previous = JSON.stringify(plan, null, 2);
        await store.write(path, previous);
        check();
      }
      if (plan.status === 'prepared') {
        const preserved = new Set(plan.preserved);
        const planned = new Map(plan.files.map(file => [file.path, file.text]));
        const versionGroups = new Set(plan.files.filter(file => file.path.startsWith(`${control}/worldbook-versions/`))
          .map(file => file.path.slice(0, file.path.lastIndexOf('/'))));
        const protectedVersions = new Set<string>();
        // Different operation filenames can still have the same entry/version number. Preserve an
        // existing entry as a whole instead of making its version store unreadable with duplicates.
        for (const group of versionGroups) {
          for (const existing of await store.list(group)) {
            check();
            if (!existing.endsWith('.json')) continue;
            const text = await store.read(existing);
            check();
            if (text !== null && text !== planned.get(existing)) protectedVersions.add(group);
          }
        }
        for (const file of plan.files) {
          check();
          if (await store.read(path) !== previous) throw new Error('分支继承计划已被手动修改，已停止写入');
          if (protectedVersions.has(file.path.slice(0, file.path.lastIndexOf('/')))) {
            preserved.add(file.path);
            continue;
          }
          const actual = await store.read(file.path);
          check();
          if (actual === null) await store.write(file.path, file.text);
          else if (actual !== file.text) preserved.add(file.path);
          check();
        }
        if (await store.read(path) !== previous) throw new Error('分支继承计划已被手动修改，已停止写入');
        check();
        plan = { ...plan, status: 'complete', preserved: [...preserved].sort() };
        await store.write(path, JSON.stringify(plan, null, 2));
        check();
      }
      visiting.delete(targetId);
      return { status: 'complete', inherited: plan.files.filter(file => !plan.preserved.includes(file.path)).map(file => file.path), preserved: [...plan.preserved] };
    }
    result = await ensure(branchId);
    return undefined;
  };
  if (options.lockedStory && options.lockedStory.id !== storyId) throw new Error('继承快照与故事不匹配');
  const saved = options.lockedStory
    ? (await inherit(options.lockedStory), options.lockedStory)
    : await updateArchiveStory(storyId, inherit, stories);
  if (!saved) throw new Error('分支继承所属故事不存在');
  check();
  return result;
}
