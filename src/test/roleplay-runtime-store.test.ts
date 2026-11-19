import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { buildStoryFromSession, saveArchiveStory, updateArchiveStory, saveCharacter, updateCharacter } from '@/lib/archive-db';
import type { ArchiveCharacter } from '@/types/archive';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { createRuntimeStore } from '@/lib/roleplay/runtime-store';

beforeEach(() => { closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { setActiveVault(null); closeDB(); vi.unstubAllGlobals(); });
async function story() {
  const item = buildStoryFromSession({ id: 'session', title: '雨夜', createdAt: 1, messages: [], user: { name: '我' }, character: { name: '林' } });
  await saveArchiveStory(item);
  return item;
}

it('writes readable files beside the sole story source and follows story-directory renames', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const item = await story(); const store = createRuntimeStore(item.id);
  await store.write('memory/main/state.md', '雨夜，北门外。');
  const directory = await getActiveVault()!.pathOf('archiveStories', item.id);
  expect(await fs.readText(directory + '/memory/main/state.md')).toBe('雨夜，北门外。');
  await updateArchiveStory(item.id, () => ({ title: '新名字' }));
  expect(await store.read('memory/main/state.md')).toBe('雨夜，北门外。');
  expect(await store.list('memory/main')).toEqual(['memory/main/state.md']);
});

it('uses the same logical files in the existing browser database and keeps stories isolated', async () => {
  setActiveVault(null);
  const one = await story(), two = await story();
  const a = createRuntimeStore(one.id), b = createRuntimeStore(two.id);
  await a.write('memory/main/state.md', '甲');
  await b.write('memory/main/state.md', '乙');
  expect(await a.read('memory/main/state.md')).toBe('甲');
  expect(await b.read('memory/main/state.md')).toBe('乙');
  expect(await a.list('memory/main')).toEqual(['memory/main/state.md']);
});

it('rejects paths outside roleplay files and invalidates writes after switching vaults', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const item = await story(), store = createRuntimeStore(item.id);
  for (const path of ['../故事.json', 'memory/main/../../故事.json', 'memory\\main\\state.md', '/memory/main/state.md', '故事.json']) {
    await expect(store.write(path, 'bad')).rejects.toThrow(/路径/);
  }
  setActiveVault(null);
  await expect(store.write('memory/main/state.md', 'late')).rejects.toThrow(/切换/);
});

it('rereads external memory edits rather than serving a stale in-process copy', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const item = await story(), store = createRuntimeStore(item.id);
  await store.write('memory/main/state.md', '自动');
  const directory = await getActiveVault()!.pathOf('archiveStories', item.id);
  await fs.writeText(directory + '/memory/main/state.md', '手动');
  expect(await store.read('memory/main/state.md')).toBe('手动');
});

it('serializes directory resolution and writing with a concurrent story rename', async () => {
  const fs = createMemFs(); setActiveVault(createVault(fs));
  const item = await story(), store = createRuntimeStore(item.id);
  let entered!: () => void, unlock!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const mkdir = fs.mkdir.bind(fs);
  fs.mkdir = async path => { await mkdir(path); if (path.endsWith('/memory/main')) { entered(); await gate; } };
  const writing = store.write('memory/main/state.md', '改名前正在写入的记忆');
  await reached;
  let renamed = false;
  const rename = updateArchiveStory(item.id, () => ({ title: '改名后的故事' })).then(() => { renamed = true; });
  try { await new Promise(resolve => setTimeout(resolve, 10)); expect(renamed).toBe(false); }
  finally { unlock(); }
  await Promise.all([writing, rename]);
  expect(await store.read('memory/main/state.md')).toBe('改名前正在写入的记忆');
});

it.each(['public', 'underStoryLock'])('keeps %s runtime writes with the story when its parent character is renamed', async access => {
  const base = createMemFs();
  let hold = false, entered!: () => void, unlock!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const fs = { ...base, async mkdir(path: string) {
    if (hold && path.endsWith('/memory/main')) { hold = false; entered(); await gate; }
    await base.mkdir(path);
  } };
  const vault = createVault(fs); setActiveVault(vault);
  const character = { id: 'runtime-parent', name: 'Synthetic parent', card: { name: 'Synthetic parent' },
    tags: [], status: '未开始', createdAt: 1, updatedAt: 1 } as ArchiveCharacter;
  await saveCharacter(character);
  const item = await story();
  await updateArchiveStory(item.id, () => ({ characterId: character.id }));
  const oldDirectory = await vault.pathOf('archiveStories', item.id);
  const store = createRuntimeStore(item.id);
  hold = true;
  const writing = access === 'public' ? store.write('memory/main/state.md', 'synthetic memory')
    : updateArchiveStory(item.id, async () => { await store.underStoryLock!.write('memory/main/state.md', 'synthetic memory'); return undefined; });
  await reached;
  let renamed = false;
  const rename = updateCharacter(character.id, () => ({ name: 'Synthetic renamed' })).then(() => { renamed = true; });
  try { await new Promise(resolve => setTimeout(resolve, 20)); expect(renamed).toBe(false); }
  finally { unlock(); await Promise.all([writing, rename]); }
  expect(await store.read('memory/main/state.md')).toBe('synthetic memory');
  expect((await base.stat(oldDirectory!)).exists).toBe(false);
  expect(await createVault(base).pathOf('archiveStories', item.id)).toContain('角色/Synthetic renamed/故事/');
});

it.each(['read', 'remove', 'list'] as const)('finishes runtime %s before a parent-character move', async operation => {
  const base = createMemFs();
  let hold = false, entered!: () => void, unlock!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  async function pause(path: string, kind: 'stat' | 'list') {
    if (hold && (operation === 'list' ? kind === 'list' && path.endsWith('/memory/main')
      : kind === 'stat' && path.endsWith('/memory/main/state.md'))) {
      hold = false; entered(); await gate;
    }
  }
  const fs = { ...base,
    async stat(path: string) { await pause(path, 'stat'); return base.stat(path); },
    async list(path: string) { await pause(path, 'list'); return base.list(path); },
  };
  const vault = createVault(fs); setActiveVault(vault);
  const character = { id: 'runtime-parent', name: 'Synthetic parent', card: { name: 'Synthetic parent' },
    tags: [], status: '未开始', createdAt: 1, updatedAt: 1 } as ArchiveCharacter;
  await saveCharacter(character);
  const item = await story();
  await updateArchiveStory(item.id, () => ({ characterId: character.id }));
  const store = createRuntimeStore(item.id);
  await store.write('memory/main/state.md', 'synthetic memory');
  hold = true;
  const pending = operation === 'list' ? store.list('memory/main') : store[operation]('memory/main/state.md');
  await reached;
  let renamed = false;
  const rename = updateCharacter(character.id, () => ({ name: 'Synthetic renamed' })).then(() => { renamed = true; });
  try { await new Promise(resolve => setTimeout(resolve, 20)); expect(renamed).toBe(false); }
  finally { unlock(); await rename; }
  expect(await pending).toEqual(operation === 'list' ? ['memory/main/state.md'] : operation === 'read' ? 'synthetic memory' : undefined);
  expect(await store.read('memory/main/state.md')).toBe(operation === 'remove' ? null : 'synthetic memory');
});
