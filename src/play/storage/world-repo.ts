import { openDB } from '@/lib/idb';
import { getActiveVault, getVaultEpoch } from '@/lib/vault/active';
import type { VaultFs } from '@/lib/vault/fs';
import type { Intervention, StepResult, WorldState } from '../world/schema';
import { assertWorld } from '../world/simulation';
import { checkChain, commitId, sealCommit, validCommit, validWorldId, type WorldCommit } from './world-commit';

const ROOT = '世界';
const filePath = (id: string, revision: number) => `${ROOT}/${id}/${String(revision).padStart(6, '0')}.json`;
export interface WorldHistory { commits: WorldCommit[]; warnings: string[] }
export function currentWorldRepo(): WorldRepo {
  const vault = getActiveVault(), epoch = getVaultEpoch();
  return new WorldRepo(vault?.fs ?? null, () => { if (getVaultEpoch() !== epoch || getActiveVault() !== vault) throw new Error('文件库已切换，请重新打开世界'); });
}
/** Immutable numbered commits: atomic IDB add, or no-overwrite Vault rename.
 * No mutable HEAD file, no partial state/event pair. Temporary writes are ignored.
 * Archive is a reversible tombstone; source assets and unknown attachments are never removed.
 */
export class WorldRepo {
  constructor(private fs: VaultFs | null, private guard: () => void = () => {}) {}
  private async safe(path: string) {
    if (!this.fs) return;
    let parent = '';
    const parts = path.split('/');
    for (const part of parts) {
      const entry = (await this.fs.list(parent)).find(e => e.name === part);
      if (entry?.isSymlink || entry && !entry.isDir) throw new Error('世界目录含链接或非目录，已停止访问');
      parent = parent ? `${parent}/${part}` : part;
    }
    this.guard();
  }
  async list(): Promise<WorldCommit[]> {
    this.guard();
    let ids: string[];
    if (this.fs) {
      await this.safe(ROOT);
      ids = (await this.fs.list(ROOT)).filter(e => e.isDir && !e.isSymlink && validWorldId(e.name)).map(e => e.name);
    } else {
      const db = await openDB();
      const all = await new Promise<WorldCommit[]>((resolve, reject) => {
        const req = db.transaction('worldCommits').objectStore('worldCommits').getAll();
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      ids = [...new Set(all.map(c => c.worldId))];
    }
    const rows: WorldCommit[] = [];
    for (const id of ids) { const history = await this.load(id); if (history.commits.length) rows.push(history.commits.at(-1)!); }
    this.guard(); return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async load(id: string): Promise<WorldHistory> {
    this.guard(); if (!validWorldId(id)) throw new Error('世界标识无效');
    let raw: unknown[] = [];
    const warnings: string[] = [];
    if (this.fs) {
      await this.safe(`${ROOT}/${id}`);
      const entries = (await this.fs.list(`${ROOT}/${id}`)).filter(e => !e.isDir && !e.isSymlink && /^\d{6}\.json$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.size > 1024 * 1024 || raw.length > 2000) { warnings.push('存档超出本版容量限制'); break; }
        try {
          const commit = JSON.parse(await this.fs.readText(`${ROOT}/${id}/${entry.name}`));
          if (commit?.revision !== Number(entry.name.slice(0, 6))) { warnings.push('存档文件名与版本不匹配'); break; }
          raw.push(commit);
        }
        catch { warnings.push(`无法读取 ${entry.name}；保留最后完整版本`); break; }
      }
    } else {
      const db = await openDB();
      raw = await new Promise<WorldCommit[]>((resolve, reject) => {
        const req = db.transaction('worldCommits').objectStore('worldCommits').index('worldId').getAll(id);
        req.onsuccess = () => resolve(req.result.sort((a: WorldCommit, b: WorldCommit) => a.revision - b.revision)); req.onerror = () => reject(req.error);
      });
    }
    const commits: WorldCommit[] = [];
    for (const c of raw) {
      const previous = commits.at(-1);
      if (!validCommit(c) || c.worldId !== id || c.revision !== commits.length || c.parent !== (previous?.hash ?? null)
        || previous && c.state.tick !== previous.state.tick + (c.kind === 'step' ? 1 : 0)) {
        warnings.push(`第 ${commits.length} 版损坏；可从最后完整版本另存分支`); break;
      }
      commits.push(c);
    }
    this.guard(); return { commits, warnings };
  }
  private async persist(commit: WorldCommit, expected: WorldCommit | null): Promise<WorldCommit> {
    this.guard(); if (!validCommit(commit)) throw new Error('提交校验失败');
    if (this.fs) {
      const dir = `${ROOT}/${commit.worldId}`;
      await this.safe(dir);
      const entries = (await this.fs.list(dir)).filter(e => /^\d{6}\.json$/.test(e.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (entries.some(e => e.isSymlink || e.isDir) || entries.length !== (expected ? expected.revision + 1 : 0)
        || entries.some((e, i) => e.name !== `${String(i).padStart(6, '0')}.json`)) throw new Error('存档版本不连续，请重新读取');
      if (expected) {
        const parent = JSON.parse(await this.fs.readText(filePath(commit.worldId, expected.revision)));
        if (!validCommit(parent) || parent.hash !== expected.hash) throw new Error('存档已改变或损坏，请重新读取后从完整版本分支');
      }
      await this.fs.mkdir(dir);
      const temporary = `${dir}/pending-${crypto.randomUUID()}.tmp`;
      this.guard(); await this.fs.writeText(temporary, JSON.stringify(commit));
      if (await this.fs.readText(temporary) !== JSON.stringify(commit)) throw new Error('临时存档校验失败');
      this.guard(); await this.safe(dir);
      // Same revision has one fixed destination; concurrent writers cannot both win.
      await this.fs.rename(temporary, filePath(commit.worldId, commit.revision));
    } else {
      const db = await openDB(); this.guard();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('worldCommits', 'readwrite'), store = tx.objectStore('worldCommits');
        let error: Error | undefined;
        tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(error ?? tx.error ?? new Error('世界保存中止'));
        // Padded primary keys order revisions within one world. A cursor reads
        // just the current parent; full-chain verification happens on open/import.
        const req = store.index('worldId').openCursor(IDBKeyRange.only(commit.worldId), 'prev');
        req.onsuccess = () => {
          try {
            this.guard(); const latest = req.result?.value as WorldCommit | undefined;
            if (latest && !validCommit(latest) || (latest?.hash ?? null) !== (expected?.hash ?? null)) throw new Error('存档已改变，请重新读取');
            store.add(commit);
          } catch (reason) { error = reason as Error; tx.abort(); }
        };
      });
    }
    return commit;
  }
  async create(title: string, state: WorldState, origin?: WorldCommit['origin']): Promise<WorldCommit> {
    assertWorld(state);
    const worldId = crypto.randomUUID();
    return this.persist(sealCommit({ schema: 1, id: commitId(worldId, 0), worldId, title: title.trim().slice(0, 80) || '山海之间',
      revision: 0, parent: null, updatedAt: Date.now(), kind: 'create', deleted: false, state, events: [], ...(origin ? { origin } : {}) }), null);
  }
  async append(previous: WorldCommit, result: StepResult, kind: WorldCommit['kind'], command?: Intervention): Promise<WorldCommit> {
    if (previous.revision >= 2000) throw new Error('当前世界已达 2000 个存档版本，请另存分支继续');
    if (previous.deleted && kind !== 'restore') throw new Error('请先恢复这个世界');
    if (result.state.tick !== previous.state.tick + (kind === 'step' ? 1 : 0)) throw new Error('世界时间不连续');
    const revision = previous.revision + 1;
    const { hash: _hash, command: _command, ...base } = previous;
    return this.persist(sealCommit({ ...base, revision, id: commitId(previous.worldId, revision), parent: previous.hash, updatedAt: Date.now(), kind,
      state: result.state, events: result.events, deleted: kind === 'archive' ? true : kind === 'restore' ? false : previous.deleted,
      ...(command ? { command } : {}) }), previous);
  }
  checkpoint(previous: WorldCommit) { return this.append(previous, { state: previous.state, events: [] }, 'checkpoint'); }
  archive(previous: WorldCommit, deleted: boolean) { return this.append(previous, { state: previous.state, events: [] }, deleted ? 'archive' : 'restore'); }
  fork(previous: WorldCommit, title: string) { return this.create(title, previous.state, { worldId: previous.worldId, revision: previous.revision, hash: previous.hash }); }
  async export(id: string) {
    const history = await this.load(id);
    if (history.warnings.length) throw new Error('请先从完整版本另存分支，再备份');
    checkChain(history.commits);
    return JSON.stringify({ app: 'ste-world', version: 1, commits: history.commits });
  }
  async import(text: string): Promise<WorldCommit> {
    if (new Blob([text]).size > 32 * 1024 * 1024) throw new Error('世界备份不能超过 32 MB');
    const bundle = JSON.parse(text);
    if (bundle.app !== 'ste-world' || bundle.version !== 1 || !Array.isArray(bundle.commits) || bundle.commits.length > 2001) throw new Error('世界备份格式无效');
    checkChain(bundle.commits);
    // Publish the complete imported chain in one IDB transaction / one directory rename.
    const worldId = crypto.randomUUID(); let parent: string | null = null;
    const commits: WorldCommit[] = bundle.commits.map((old: WorldCommit) => {
      const { hash: _hash, ...body } = old;
      const c = sealCommit({ ...body, worldId, id: commitId(worldId, old.revision), title: `${old.title.slice(0, 70)} · 导入`, parent, updatedAt: Date.now() });
      parent = c.hash; return c;
    });
    this.guard();
    if (this.fs) {
      const staging = `${ROOT}/import-${crypto.randomUUID()}`;
      await this.safe(ROOT); await this.fs.mkdir(staging);
      for (const c of commits) {
        this.guard(); const path = `${staging}/${String(c.revision).padStart(6, '0')}.json`, text = JSON.stringify(c);
        await this.fs.writeText(path, text);
        if (await this.fs.readText(path) !== text) throw new Error('导入文件校验失败，尚未发布世界');
      }
      this.guard(); await this.safe(ROOT); await this.fs.rename(staging, `${ROOT}/${worldId}`);
    } else {
      const db = await openDB(); this.guard();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('worldCommits', 'readwrite'), store = tx.objectStore('worldCommits');
        tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('导入中止'));
        commits.forEach(c => store.add(c));
      });
    }
    return commits.at(-1)!;
  }
}
