import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
import { SUMMARY_KIND_LABELS } from '@/types/summary';
import type { StoryTree } from '@/types/story-tree';
import { getCurrentRepo } from '@/lib/repo';
import { openDB } from '@/lib/idb';
import { getActiveVault, getVaultEpoch, subscribeActiveVault } from '@/lib/vault/active';
import { withArchiveStoryLock, readCharacterInQueue } from '@/lib/archive-db';
import { withSummaryLock } from '@/lib/summary-db';
import { withStoryTreeLock } from '@/lib/story-tree-db';
import { acquireStoryMaintenance } from '@/lib/story-activity';
import { KeyedSerialQueue } from '@/lib/keyed-serial-queue';
import { createRuntimeStore, type RuntimeFile } from '@/lib/roleplay/runtime-store';
import { branchKey, runtimeFileId } from '@/lib/roleplay/paths';
import { digest, sourceRefs, stableJson } from '@/lib/roleplay/fingerprint';
import { parseFrontmatter, serializeFrontmatter } from '@/lib/vault/frontmatter';
import { safeName, ensureUnique } from '@/lib/vault/naming';
import { serializeChatJsonl } from '@/lib/adapters/st/chat-jsonl';
import type { VaultFs } from '@/lib/vault/fs';
import type { WorldbookVersion } from '@/lib/roleplay/worldbook-versions';
import { ensureBranchRuntime } from '@/lib/roleplay/branch-inheritance';
import type { WorldBookItem } from '@/types/worldbook';

const operations = new KeyedSerialQueue();
const id = (kind: string) => `${kind}_${crypto.randomUUID()}`;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function inStories<T>(ids: string[], action: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(ids)].sort();
  const take = (index: number): Promise<T> => index === ordered.length ? action() : withArchiveStoryLock(ordered[index], () => take(index + 1));
  return take(0);
}

/** A moved range remains source information until the user explicitly attaches a destination range. */
export async function moveSummaryToStory(recordId: string, targetStoryId: string, targetBranchId?: string, options?: { characterId: string }): Promise<SummaryItem> {
  const epoch = getVaultEpoch(), summaries = getCurrentRepo<SummaryItem>('summaries'), stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const check = () => assert(getVaultEpoch() === epoch, '文件库已切换，记录移动已停止');
  const snapshot = await summaries.get(recordId); check(); assert(snapshot, '记录不存在');
  return inStories([...(snapshot.bookId ? [snapshot.bookId] : []), targetStoryId], () => withSummaryLock(recordId, async () => {
    check(); const record = await summaries.get(recordId); assert(record, '记录不存在');
    assert(record.bookId === snapshot.bookId, '记录归属已变化，请重新选择');
    const target = await stories.get(targetStoryId); check(); assert(target, '目标故事不存在');
    assert(!targetBranchId || target.branches?.some(branch => branch.id === targetBranchId), '目标分支不存在');
    assert(record.bookId !== targetStoryId, '请选择另一个故事');
    const original = record.bookId ? await stories.get(record.bookId) : undefined;
    if (options) assert(original?.characterId === options.characterId && target.characterId === options.characterId, '来源与目标必须属于当前角色');
    const next: SummaryItem = { ...record, bookId: target.id, bookTitle: target.title, branchId: targetBranchId,
      autoSaved: false, updatedAt: Date.now(), rangeDetached: true,
      provenance: record.provenance ?? { bookId: record.bookId, bookTitle: record.bookTitle, branchId: record.branchId,
        branchTitle: record.branchId ? original?.branches?.find(branch => branch.id === record.branchId)?.name : '主线',
        floorStart: record.floorStart, floorEnd: record.floorEnd } };
    check(); await summaries.put(next); return next;
  }));
}

export async function moveStoryTreeToStory(treeId: string, targetStoryId: string, targetBranchId?: string, options?: { characterId: string }): Promise<StoryTree> {
  const epoch = getVaultEpoch(), trees = getCurrentRepo<StoryTree>('stories'), stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const check = () => assert(getVaultEpoch() === epoch, '文件库已切换，故事树移动已停止');
  const snapshot = await trees.get(treeId); check(); assert(snapshot, '故事树不存在');
  return inStories([...(snapshot.bookId ? [snapshot.bookId] : []), targetStoryId], () => withStoryTreeLock(treeId, async () => {
    check(); const record = await trees.get(treeId); assert(record, '故事树不存在');
    assert(record.bookId === snapshot.bookId, '故事树归属已变化，请重新选择');
    assert(record.bookId !== targetStoryId, '请选择另一个故事');
    const target = await stories.get(targetStoryId); check(); assert(target, '目标故事不存在');
    assert(!targetBranchId || target.branches?.some(branch => branch.id === targetBranchId), '目标分支不存在');
    const original = record.bookId ? await stories.get(record.bookId) : undefined;
    if (options) assert(original?.characterId === options.characterId && target.characterId === options.characterId, '来源与目标必须属于当前角色');
    const next: StoryTree = { ...record, bookId: target.id, bookTitle: target.title, branchId: targetBranchId,
      autoSaved: false, updatedAt: Date.now(), provenance: record.provenance ?? { bookId: record.bookId,
        bookTitle: record.bookTitle, branchId: record.branchId,
        branchTitle: record.branchId ? original?.branches?.find(branch => branch.id === record.branchId)?.name : '主线' } };
    check(); await trees.put(next); return next;
  }));
}

interface Snapshot { story: ArchiveStory; summaries: SummaryItem[]; trees: StoryTree[]; files: { path: string; text: string }[] }

/** Copy identifiers, then repair source fingerprints which depend on message and candidate identities. */
function cloneSnapshot(source: Snapshot, title: string): Snapshot {
  const ids = new Map<string, string>();
  const register = (value: string | undefined, kind = 'copy') => { if (value && !ids.has(value)) ids.set(value, id(kind)); };
  register(source.story.id, 'astory');
  const lines = [source.story, ...(source.story.branches ?? [])];
  for (const line of lines) {
    if (line !== source.story) register(line.id, 'branch');
    register(line.session.id, 'session');
    for (const message of line.session.messages) {
      register(message.id, 'message');
      const runtime = [message.rawData?.extra?.ste_runtime, ...(message.rawData?.swipe_info ?? []).map(swipe => swipe.extra?.ste_runtime)];
      for (const value of runtime) { register(value?.candidateId, 'candidate'); register(value?.turnId, 'turn'); }
    }
  }
  for (const summary of source.summaries) register(summary.id, 'sum');
  for (const tree of source.trees) { register(tree.id, 'story'); for (const node of tree.nodes) register(node.id, 'node'); }
  // Worldbook overlays are saved memory too; their identity and integrity checks include story/branch/operation.
  type StoredVersion = Omit<WorldbookVersion, 'status' | 'path'> & { schema: 1; proposalDigest: string; rejected: boolean };
  const versions = new Map<string, StoredVersion>();
  for (const file of source.files) if (file.path.includes('/worldbook-versions/')) {
    const value: StoredVersion = JSON.parse(file.text); register(value.operationId, 'operation'); versions.set(file.path, value);
  }
  for (const value of versions.values()) ids.set(value.id, digest(stableJson([
    ids.get(source.story.id), value.branchId ? ids.get(value.branchId) : null, value.worldId, value.entryId, ids.get(value.operationId),
  ])));
  const mapString = (value: string) => ids.get(value) ?? value;
  const identityFields = new Set(['id', 'storyId', 'bookId', 'branchId', 'messageId', 'candidateId', 'turnId', 'operationId', 'baseVersionId', 'validFrom']);
  const rewrite = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return identityFields.has(key) ? mapString(value) : value;
    if (Array.isArray(value)) return value.map(child => rewrite(child, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewrite(child, name)]));
    return value;
  };
  // Only STE-owned identities change. ST extensions, prose and shared asset IDs are opaque.
  const story = structuredClone(source.story);
  story.id = mapString(story.id);
  if (story.lastViewedBranchId) story.lastViewedBranchId = mapString(story.lastViewedBranchId);
  for (const line of [story, ...(story.branches ?? [])]) {
    line.id = mapString(line.id);
    line.session.id = mapString(line.session.id);
    line.favorites = line.favorites?.map(mapString);
    for (const marker of line.markers) marker.messageId = mapString(marker.messageId);
    for (const message of line.session.messages) {
      message.id = mapString(message.id);
      for (const extra of [message.rawData?.extra, ...(message.rawData?.swipe_info ?? []).map(swipe => swipe.extra)]) {
        if (extra?.ste_runtime) extra.ste_runtime = rewrite(extra.ste_runtime);
      }
    }
  }
  story.title = title; story.createdAt = story.updatedAt = Date.now();
  story.session.title = title;
  delete story.sourcePath; delete story.writebacks; delete story.lastImportedAt; delete story.lastExportedAt;
  Object.assign(story, { copiedFrom: { storyId: source.story.id, title: source.story.title, copiedAt: story.createdAt } });
  const refs = new Map<string, unknown>();
  const copiedLines = [story, ...(story.branches ?? [])];
  lines.forEach((line, index) => {
    const before = sourceRefs(line.session), after = sourceRefs(copiedLines[index].session);
    before.forEach((ref, i) => refs.set(stableJson(ref), after[i]));
    // Filenames identify ST chats outside the copy; lazy branch inheritance would replay an old journal.
    const metadata = copiedLines[index].session.rawMetadata;
    if (metadata?.ste_catalog) {
      for (const key of ['runtimeParent', 'sourcePath', 'fileName', 'aliases', 'avatar']) delete metadata.ste_catalog[key];
    }
    if (metadata?.chat_metadata) delete metadata.chat_metadata.main_chat;
  });
  const rewriteRuntime = (value: unknown, name = ''): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const ref = refs.get(stableJson(value)); if (ref) return structuredClone(ref);
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteRuntime(child, key)]));
    }
    return Array.isArray(value) ? value.map(child => rewriteRuntime(child, name)) : rewrite(value, name);
  };
  const mapPath = (path: string) => {
    for (const branch of source.story.branches ?? []) path = path.replace(`/${branchKey(branch.id)}/`, `/${branchKey(ids.get(branch.id)!)}/`);
    return path;
  };
  const files = source.files.map(file => {
    let path = mapPath(file.path), text = file.text;
    if (path.startsWith('memory/')) {
      const parsed = parseFrontmatter(text);
      if (Object.keys(parsed.fields).length) text = serializeFrontmatter(rewriteRuntime(parsed.fields) as Record<string, unknown>, parsed.body);
    } else {
      const value = rewriteRuntime(JSON.parse(text)) as StoredVersion;
      if (versions.has(file.path)) {
        value.proposalDigest = digest(stableJson({ operationId: value.operationId, worldId: value.worldId, entryId: value.entryId,
          content: value.content, reason: value.reason, sourceRefs: value.sourceRefs }));
        path = path.replace(/[^/]+\.json$/, digest(value.operationId) + '.json');
      }
      text = JSON.stringify(value, null, 2);
    }
    return { path, text };
  });
  return { story, files,
    summaries: source.summaries.map(original => {
      const item = structuredClone(original);
      return { ...item, id: mapString(item.id), bookId: story.id, branchId: item.branchId ? mapString(item.branchId) : undefined,
        source: item.source ? { ...item.source, messageId: mapString(item.source.messageId) } : undefined,
        genParams: item.genParams ? { ...item.genParams, priorSummaryIds: item.genParams.priorSummaryIds?.map(mapString) } : undefined,
        bookTitle: title, autoSaved: false, updatedAt: story.updatedAt };
    }),
    trees: source.trees.map(original => {
      const item = structuredClone(original);
      return { ...item, id: mapString(item.id), bookId: story.id, branchId: item.branchId ? mapString(item.branchId) : undefined,
        nodes: item.nodes.map(node => ({ ...node, id: mapString(node.id), parentId: node.parentId ? mapString(node.parentId) : null })),
        bookTitle: title, autoSaved: false, updatedAt: story.updatedAt };
    }),
  };
}

/** Only durable data: pending turns, journals, indexes, locks, and context caches must never resume in the copy. */
function persistentRuntime(path: string): boolean {
  return path.startsWith('memory/') && path.endsWith('.md') && !path.endsWith('/index.md')
    || /^\.ste-control\/roleplay\/[^/]+\/settings\.json$/.test(path)
    || /^\.ste-control\/roleplay\/[^/]+\/worldbook-versions\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(path);
}

async function stageCopy(fs: VaultFs, value: Snapshot, directory: string, check: () => void): Promise<() => Promise<string[]>> {
  const expected = new Map(value.files.map(file => [file.path, file.text]));
  expected.set('聊天.jsonl', serializeChatJsonl(value.story.session));
  const names: string[] = [];
  for (const branch of value.story.branches ?? []) {
    const name = ensureUnique('分支·' + safeName(branch.name), names); names.push(name);
    expected.set(name + '.jsonl', serializeChatJsonl(branch.session));
  }
  for (const item of value.summaries) {
    const { content, ...fields } = item;
    const name = ensureUnique(`${SUMMARY_KIND_LABELS[item.kind]}·${safeName(item.title)}`, names); names.push(name);
    expected.set(name + '.md', serializeFrontmatter(fields, content));
  }
  for (const item of value.trees) {
    const name = ensureUnique('故事树·' + safeName(item.title), names); names.push(name);
    expected.set(name + '.json', JSON.stringify(item, null, 2));
  }
  expected.set('故事.json', JSON.stringify(value.story, null, 2));
  const written: string[] = [];
  const cleanup = async () => {
    const failures: string[] = [];
    for (const path of [...written].reverse()) try {
      let parent = '';
      for (const part of path.split('/')) {
        const entry = (await fs.list(parent)).find(item => item.name === part);
        assert(!entry?.isSymlink, '副本暂存路径已变为链接');
        parent += (parent ? '/' : '') + part;
      }
      if ((await fs.stat(path)).exists) await fs.removeFile(path);
    } catch { failures.push(path); }
    return failures;
  };
  try {
    for (const [path, text] of expected) {
      check(); const full = directory + '/' + path;
      let parent = '';
      for (const part of full.split('/').slice(0, -1)) {
        const entry = (await fs.list(parent)).find(item => item.name === part);
        assert(!entry?.isSymlink && (!entry || entry.isDir), '副本暂存路径包含链接或非目录');
        parent += (parent ? '/' : '') + part;
      }
      assert(!(await fs.stat(full)).exists, '副本暂存文件已存在，已停止以免覆盖');
      written.push(full); check(); await fs.writeText(full, text);
    }
    for (const [path, text] of expected) assert(await fs.readText(directory + '/' + path) === text, '复制故事时写入的文件内容不一致，原故事未受影响，请重试一次');
    check();
    return cleanup;
  } catch (error) {
    const failures = await cleanup();
    if (failures.length) throw new Error(`${error instanceof Error ? error.message : error}；副本未发布，暂存残留待清理：${failures.join('、')}`);
    throw error;
  }
}

export async function duplicateArchiveStory(storyId: string): Promise<ArchiveStory> {
  const vault = getActiveVault(), epoch = getVaultEpoch();
  const stories = getCurrentRepo<ArchiveStory>('archiveStories'), summaries = getCurrentRepo<SummaryItem>('summaries'), trees = getCurrentRepo<StoryTree>('stories');
  const runtime = createRuntimeStore(storyId).underStoryLock!;
  const worldbooks = getCurrentRepo<WorldBookItem>('worldbooks');
  const current = () => getVaultEpoch() === epoch;
  const check = () => assert(current(), '文件库已切换，故事复制已停止');
  const release = acquireStoryMaintenance(storyId);
  try {
    const initial = await stories.get(storyId); check(); assert(initial, '找不到要复制的故事（可能已被移除），请刷新故事列表后再试');
    const perform = () => operations.enqueue(String(epoch), () => withArchiveStoryLock(storyId, async () => {
      check(); const story = await stories.get(storyId); assert(story, '找不到要复制的故事（可能已被移除），请刷新故事列表后再试');
      assert(story.characterId === initial.characterId, '故事归属已改变，请重新复制');
      const run = async () => {
        check();
        for (const branch of story.branches ?? []) await ensureBranchRuntime({ storyId, branchId: branch.id,
          store: runtime, stories, worldbooks, isCurrent: current, lockedStory: story });
        const [allSummaries, allTrees, allStories] = await Promise.all([summaries.list(), trees.list(), stories.list()]);
        const files: Snapshot['files'] = [];
        for (const path of await runtime.list()) {
          if (path.includes('/memory-journal/')) {
            const journal = JSON.parse(await runtime.read(path) ?? 'null');
            assert(journal?.schema === 1 && ['committed', 'rolled-back', 'resolved'].includes(journal.status), '故事记忆存在未完成或损坏的操作，请先打开聊天完成恢复后复制');
          }
          if (persistentRuntime(path)) { check(); const text = await runtime.read(path); assert(text !== null, '复制时记忆文件已变化'); files.push({ path, text }); }
        }
        const source: Snapshot = { story, summaries: allSummaries.filter(item => item.bookId === storyId), trees: allTrees.filter(item => item.bookId === storyId), files };
        const titles = new Set(allStories.filter(item => item.characterId === story.characterId).map(item => item.title));
        const base = story.title + '（副本）'; let title = base, number = 2;
        while (titles.has(title)) title = `${base} ${number++}`;
        const copy = cloneSnapshot(source, title); check();
        if (vault) {
          assert(vault.publishStoryDirectory, '当前文件库暂不支持复制完整故事，请在「设置 → 数据与备份」检查文件库状态后再试');
          const directory = `.ste-control/story-packages/${digest(copy.story.id)}/story`;
          const cleanup = await stageCopy(vault.fs, copy, directory, check);
          try { check(); await vault.publishStoryDirectory(copy.story.id, directory, current); }
          catch (error) {
            const failures = await cleanup();
            if (failures.length) throw new Error(`${error instanceof Error ? error.message : error}；暂存残留待清理：${failures.join('、')}`);
            throw error;
          }
        } else {
          const db = await openDB(); check();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['archiveStories', 'summaries', 'stories', 'roleplayFiles'], 'readwrite');
            let failure: unknown;
            const unsubscribe = subscribeActiveVault(() => { if (!current()) { failure = new Error('文件库已切换，故事复制已取消'); try { tx.abort(); } catch { /* already settled */ } } });
            tx.oncomplete = () => { unsubscribe(); resolve(); };
            tx.onabort = () => { unsubscribe(); reject(failure ?? tx.error ?? new Error('复制故事时未能完成保存，原故事未受影响，请重试一次')); };
            tx.onerror = () => { failure ??= tx.error; };
            const request = tx.objectStore('archiveStories').get(storyId);
            request.onsuccess = () => {
              try {
                check(); assert(stableJson(request.result) === stableJson(story), '原故事已变化，请重新复制');
                tx.objectStore('archiveStories').add(copy.story);
                for (const item of copy.summaries) tx.objectStore('summaries').add(item);
                for (const item of copy.trees) tx.objectStore('stories').add(item);
                for (const file of copy.files) tx.objectStore('roleplayFiles').add({ id: runtimeFileId(copy.story.id, file.path), storyId: copy.story.id,
                  path: file.path, text: file.text, updatedAt: copy.story.updatedAt } satisfies RuntimeFile);
              } catch (error) { failure = error; tx.abort(); }
            };
          });
        }
        return copy.story;
      };
      return run();
    }));
    return initial.characterId ? await readCharacterInQueue(initial.characterId, async character => {
      assert(character, '所属角色不存在'); return perform();
    }, { isCurrent: current }) : await perform();
  } finally { release(); }
}
