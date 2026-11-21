import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { sha256 } from 'js-sha256';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { prepareFileRemoval } from '@/lib/vault/file-maintenance';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession, deleteArchiveStory } from '@/lib/archive-db';
import type { ChatSession } from '@/types/chat';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); });

async function fixture(count: number, retained: number) {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  await vault.repo('characters').put({ ...buildCharacterFromCard({ name: '性能测试角色' }), id: 'c' });
  for (let i = 0; i < count; i++) {
    const session: ChatSession = { id: `session${i}`, title: `故事${i}`, messages: [{ id: 'm', role: 'assistant', content: '测试正文'.repeat(2500), timestamp: 1 }], character: { name: '性能测试角色' }, user: { name: '我' }, createdAt: 1 };
    await vault.repo('archiveStories').put({ ...buildStoryFromSession(session, 'c'), id: `s${i}` });
  }
  for (let i = 0; i < retained; i++) {
    const operationId = crypto.randomUUID(), base = `.ste/retained/${operationId}`;
    const manifest = { schema: 1, operationId, store: 'archiveStories', id: `old${i}`, createdAt: 1, deleteFiles: false, files: [] };
    await fs.writeText(`${base}/manifest.json`, JSON.stringify(manifest));
    await fs.writeText(`${base}/committed.json`, JSON.stringify({ digest: sha256(JSON.stringify(manifest)) }));
    await fs.writeText(`${base}/files/角色/旧角色/故事/旧故事/聊天.jsonl`, '旧正文');
  }
  return { fs, vault };
}

it('allows confirmation while a slow file preview is pending, then actually deletes the selected story', async () => {
  const { fs, vault } = await fixture(1, 0);
  const list = fs.list.bind(fs);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocked = true, completed = false;
  fs.list = async path => { if (blocked) await gate; return list(path); };
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<DeleteConfirmDialog open title="删除故事" description="诊断" fileTarget={{ store: 'archiveStories', id: 's0' }} onOpenChange={() => {}} onConfirm={async options => { await deleteArchiveStory('s0', options); completed = true; }} />));
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === '确认删除')!;
  const enabledBeforePreview = !button.disabled;
  await act(async () => { button.click(); });
  blocked = false; await act(async () => { release(); await gate; });
  expect(enabledBeforePreview).toBe(true);
  expect(completed).toBe(true);
  expect(await vault.repo('archiveStories').get('s0')).toBeUndefined();
});

it('deletes one story without reading unrelated story bodies or visiting historic retained operations', async () => {
  const { fs, vault } = await fixture(96, 100);
  const text = fs.readText.bind(fs), list = fs.list.bind(fs);
  const unrelated: string[] = [], historic: string[] = [];
  let lists = 0;
  fs.readText = async path => {
    if (path.endsWith('/故事.json') && !path.includes('/故事0/')) unrelated.push(path);
    if (path.startsWith('.ste/retained/')) historic.push(path);
    return text(path);
  };
  fs.list = async path => { lists++; return list(path); };
  await deleteArchiveStory('s0', { deleteFiles: true });
  expect(await vault.repo('archiveStories').get('s0')).toBeUndefined();
  expect(unrelated).toEqual([]);
  // Only the new operation's manifest and commit marker are read back.
  expect(historic).toHaveLength(2);
  expect(lists).toBeLessThan(80);
});


it('previews only target metadata without reading bodies to hash or scanning other directories', async () => {
  const { fs, vault } = await fixture(96, 100);
  const binary = fs.readBinary.bind(fs), text = fs.readText.bind(fs);
  const bodies: string[] = [], hashes: string[] = [];
  fs.readBinary = async path => { hashes.push(path); return binary(path); };
  fs.readText = async path => { bodies.push(path); return text(path); };
  const preview = await prepareFileRemoval(vault, 'archiveStories', 's0');
  expect(preview.count).toBe(2);
  expect(preview.bytes).toBeGreaterThan(0);
  expect(hashes).toEqual([]);
  expect(bodies).toEqual(['角色/性能测试角色/故事/故事0/故事.json']);
});

it('ignores unrelated broken files while retaining unknown target files and interrupted records in place', async () => {
  const { fs, vault } = await fixture(1, 0);
  await fs.writeText('角色/无关坏档案/故事/坏故事/故事.json', '{');
  await fs.writeText('角色/性能测试角色/故事/故事0/手写笔记.txt', '不可丢失');
  await deleteArchiveStory('s0', { deleteFiles: false });
  expect(await vault.repo('archiveStories').get('s0')).toBeUndefined();
  expect(await fs.readText('角色/无关坏档案/故事/坏故事/故事.json')).toBe('{');
  expect(await fs.readText('角色/性能测试角色/故事/故事0/手写笔记.txt')).toBe('不可丢失');
});

it('does not remove a replacement record that has another identity at the indexed target path', async () => {
  const { fs } = await fixture(1, 0);
  const path = '角色/性能测试角色/故事/故事0/故事.json';
  const current = JSON.parse(await fs.readText(path));
  await fs.writeText(path, JSON.stringify({ ...current, id: 'replacement' }));
  await expect(deleteArchiveStory('s0', { deleteFiles: true })).rejects.toThrow('记录已改变');
  expect(JSON.parse(await fs.readText(path)).id).toBe('replacement');
});
