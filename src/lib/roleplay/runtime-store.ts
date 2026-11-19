import { openDB } from '@/lib/idb';
import { createIdbRepo } from '@/lib/repo/idb-repo';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import { isRuntimePath, runtimeFileId } from './paths';
import { updateArchiveStory } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import type { ArchiveStory } from '@/types/archive';
import { mutationCoordinator } from '@/lib/vault/mutation-coordinator';

export interface RuntimeFile {
  id: string;
  storyId: string;
  path: string;
  text: string;
  updatedAt: number;
}
export interface RuntimeStore {
  readonly storyId: string;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  /** Only for callers already inside updateArchiveStory's queue; prevents a non-reentrant nested lock. */
  readonly underStoryLock?: RuntimeStore;
}

/** One logical file layout; desktop reads the actual files every time, web/Android use the existing local DB. */
export function createRuntimeStore(storyId: string): RuntimeStore {
  const vault = getActiveVault(), epoch = getVaultEpoch();
  const repo = createIdbRepo<RuntimeFile>('roleplayFiles');
  const stories = getCurrentRepo<ArchiveStory>('archiveStories');
  function check(path: string, prefix = false) {
    if (!isRuntimePath(path, prefix)) throw new Error(`角色扮演文件路径无效：${path}`);
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换，文件操作已停止');
  }
  async function resolve(path: string) {
    const directory = await vault!.pathOf('archiveStories', storyId);
    if (!directory) throw new Error('故事不存在，记忆目录尚未创建');
    check(path);
    return directory + '/' + path;
  }
  const files: RuntimeStore = {
    storyId,
    async read(path) {
      check(path);
      if (vault) {
        const file = await resolve(path);
        if (!(await vault.fs.stat(file)).exists) return null;
        return vault.fs.readText(file);
      }
      return (await repo.get(runtimeFileId(storyId, path)))?.text ?? null;
    },
    async write(path, text) {
      check(path);
      if (typeof text !== 'string') throw new Error('记忆文件必须是文本');
      if (vault) {
        const file = await resolve(path);
        await vault.fs.mkdir(file.slice(0, file.lastIndexOf('/')));
        check(path);
        await vault.fs.writeText(file, text);
      } else {
        await repo.put({ id: runtimeFileId(storyId, path), storyId, path, text, updatedAt: Date.now() });
      }
    },
    async remove(path) {
      check(path);
      if (vault) {
        const file = await resolve(path);
        if ((await vault.fs.stat(file)).exists) { check(path); await vault.fs.removeFile(file); }
      } else await repo.remove(runtimeFileId(storyId, path));
    },
    async list(prefix) {
      if (prefix) check(prefix, true);
      if (getVaultEpoch() !== epoch) throw new Error('文件库已切换');
      if (vault) {
        const directory = await vault.pathOf('archiveStories', storyId);
        if (!directory) return [];
        const paths: string[] = [];
        async function walk(relative: string) {
          if (!isRuntimePath(relative, true)) return;
          for (const entry of await vault!.fs.list(directory + '/' + relative)) {
            if (entry.isSymlink) continue;
            const path = relative + '/' + entry.name;
            if (entry.isDir) await walk(path);
            else if (isRuntimePath(path)) paths.push(path);
          }
        }
        for (const root of prefix ? [prefix] : ['memory', '.ste-control/roleplay']) await walk(root);
        return paths.sort();
      }
      const db = await openDB();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const files = db.transaction('roleplayFiles', 'readonly').objectStore('roleplayFiles');
        // Older development databases may have the store without its optional lookup index.
        const indexed = files.indexNames.contains('storyId');
        const request = indexed ? files.index('storyId').getAllKeys(storyId) : files.getAll();
        request.onsuccess = () => resolve(indexed ? request.result : (request.result as RuntimeFile[]).filter(file => file.storyId === storyId).map(file => file.id));
        request.onerror = () => reject(request.error);
      });
      return keys.map(key => { try { return JSON.parse(String(key))[1] as string; } catch { return ''; } })
        .filter(path => isRuntimePath(path) && (!prefix || path.startsWith(prefix + '/'))).sort();
    },
  };
  // Story locks do not cover parent-character moves. Resolve paths and finish
  // sidecar IO under the shared library gate, including underStoryLock callers.
  function inLibrary<T>(action: () => Promise<T>, writing = false): Promise<T> {
    if (!vault) return action();
    const { queue } = mutationCoordinator(vault.fs);
    return writing ? queue.enqueue('records', action) : queue.read('records', action);
  }
  const unlocked: RuntimeStore = {
    storyId,
    read: path => inLibrary(() => files.read(path)),
    write: (path, text) => inLibrary(() => files.write(path, text), true),
    remove: path => inLibrary(() => files.remove(path), true),
    list: prefix => inLibrary(() => files.list(prefix)),
  };
  async function inStory<T>(action: () => Promise<T>): Promise<T> {
    if (getVaultEpoch() !== epoch) throw new Error('文件库已切换');
    let value!: T;
    const result = await updateArchiveStory(storyId, async () => {
      if (getVaultEpoch() !== epoch) throw new Error('文件库已切换');
      value = await action();
      return undefined;
    }, stories);
    if (!result) throw new Error('故事不存在，文件操作已停止');
    return value;
  }
  return { storyId, underStoryLock: unlocked,
    read: path => inStory(() => unlocked.read(path)),
    write: (path, text) => inStory(() => unlocked.write(path, text)),
    remove: path => inStory(() => unlocked.remove(path)),
    list: prefix => inStory(() => unlocked.list(prefix)),
  };
}
