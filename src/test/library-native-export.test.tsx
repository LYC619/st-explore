import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs, type VaultFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { saveCharacter, getCharacter } from '@/lib/archive-db';
import { saveWorldBook } from '@/lib/worldbook-db';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import { extractCharacterFromPngBuffer } from '@/lib/png-parser';
import { tinyPngBase64 } from './fixtures/images';

// Only the native directory dialog/filesystem and app shell are substituted.
// Library, selection/menu, snapshots, PNG serialization and repository reads are real.
const native = vi.hoisted(() => ({ fs: null as VaultFs | null, pick: vi.fn(async () => 'D:/export-fixture') }));
vi.mock('@/lib/vault/tauri-fs', async original => ({ ...await original<object>(),
  isTauri: () => true, pickDirectory: native.pick, createTauriFs: () => native.fs,
}));
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children, actions, leftActions }: {
  children?: React.ReactNode; actions?: React.ReactNode; leftActions?: React.ReactNode;
}) => <div>{leftActions}{actions}{children}</div> }));
import Library from '@/pages/Library';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.hasPointerCapture = () => false; Element.prototype.scrollIntoView = () => {};
  localStorage.clear(); sessionStorage.clear(); setActiveVault(null); native.fs = createMemFs(); native.pick.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  for (const id of ['json', 'png']) await saveCharacter({ id, name: id, card: { name: id },
    tags: [], status: '未开始', createdAt: 1, updatedAt: 1, ...(id === 'png' ? { pngBase64: tinyPngBase64 } : {}),
    assets: [{ kind: 'worldbook', assetId: 'book', relations: ['embedded'] }],
  });
  await saveWorldBook({ id: 'book', title: '当前书', createdAt: 1, updatedAt: 1,
    worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, content: '旧 A' } } } });
  await act(async () => root.render(<MemoryRouter initialEntries={['/library']}><Library /></MemoryRouter>));
  for (let attempt = 0; attempt < 50 && document.querySelectorAll('[data-character-id]').length !== 2; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  expect(document.querySelectorAll('[data-character-id]'), document.body.textContent ?? '').toHaveLength(2);
  await saveWorldBook({ id: 'book', title: '当前书', createdAt: 1, updatedAt: 2,
    worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, content: '当前 B' } } } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); closeDB(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')].find(button => button.textContent?.trim() === label);
  expect(item, label).toBeDefined(); await act(async () => item!.click());
}
async function assertOutput(id: 'json' | 'png') {
  const path = `${id}.${id}`;
  await vi.waitFor(async () => expect((await native.fs!.list('')).map(entry => entry.name)).toContain(path));
  const output = id === 'png'
    ? extractCharacterFromPngBuffer(Uint8Array.from(atob(await native.fs!.readBinary(path)), ch => ch.charCodeAt(0)).buffer)
    : JSON.parse(await native.fs!.readText(path));
  expect(output.character_book.entries[0].content).toBe('当前 B');
  expect((await getCharacter(id))!.card).toEqual({ name: id });
}

it.each(['json', 'png'] as const)('Library single export reads the current book (%s)', async id => {
  const menu = document.querySelector<HTMLElement>(`[data-character-id="${id}"] [aria-label="更多操作"]`)!;
  await act(async () => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await click('导出角色卡');
  await act(async () => { await assertOutput(id); });
  expect(native.pick).toHaveBeenCalledOnce();
});

it('Library batch export serializes the current book into both file formats', async () => {
  await click('批量管理');
  for (const id of ['json', 'png']) await act(async () => document.querySelector<HTMLElement>(`[data-character-id="${id}"]`)!.click());
  await click('导出');
  await act(async () => { await assertOutput('json'); await assertOutput('png'); });
  expect(native.pick).toHaveBeenCalledOnce();
});
