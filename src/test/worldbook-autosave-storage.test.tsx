import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { saveCharacter, getCharacter } from '@/lib/archive-db';
import { getAllWorldBooks, getWorldBook, saveWorldBook } from '@/lib/worldbook-db';
import { DEFAULT_ENTRY, type WorldBookItem } from '@/types/worldbook';
import type { ArchiveCharacter } from '@/types/archive';

// Only shell chrome is omitted. The editor, router, COW, reference update and repositories are real.
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/GuidedTour', () => ({ GuidedTour: () => null }));
import WorldBookPage from '@/pages/WorldBook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.hasPointerCapture = () => false; Element.prototype.scrollIntoView = () => {};
  sessionStorage.clear(); localStorage.clear(); setActiveVault(null);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setActiveVault(null); closeDB(); vi.unstubAllGlobals(); });
const shared: WorldBookItem = { id: 'shared', title: '原世界书', createdAt: 1, updatedAt: 1,
  worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, comment: '卷总结', content: '原内容 A' } } } };
async function seed() {
  await saveWorldBook(structuredClone(shared));
  for (const id of ['c1', 'c2']) await saveCharacter({ id, name: id, card: { name: id }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1,
    assets: [{ kind: 'worldbook', assetId: 'shared', relations: ['embedded'] }] } as ArchiveCharacter);
}
async function mount(id = 'shared') {
  const router = createMemoryRouter([
    { path: '/worldbook', element: <WorldBookPage /> }, { path: '/done', element: <p>已返回</p> },
  ], { initialEntries: ['/done', `/worldbook?assetId=${id}&characterId=c1`], initialIndex: 1 });
  await act(async () => { root.render(<RouterProvider router={router} />); });
  for (let tries = 0; tries < 30 && (!document.querySelector('[data-entry-key="7"]') || !document.body.textContent?.includes('为「c1」处理')); tries++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  return router;
}
async function edit(value: string) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  const entry = document.querySelector<HTMLElement>('[data-entry-key="7"]');
  await act(async () => entry!.click());
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
  expect(textarea).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function waitForNavigation(router: ReturnType<typeof createMemoryRouter>, path: string) {
  for (let tries = 0; tries < 100 && router.state.location.pathname !== path; tries++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
}

it.each(['browser', 'vault'])('flushes immediate navigation, keeps one derived current book, and reopens durably (%s)', async mode => {
  const fs = createMemFs(); if (mode === 'vault') setActiveVault(createVault(fs));
  await seed(); const router = await mount(); await edit('新内容 B');
  await act(async () => { await router.navigate(-1); await new Promise(resolve => setTimeout(resolve, 50)); });
  await waitForNavigation(router, '/done');
  expect(document.body.textContent).toContain('已返回');
  const first = (await getCharacter('c1'))!.assets![0].assetId;
  expect(first).not.toBe('shared'); expect((await getCharacter('c2'))!.assets![0].assetId).toBe('shared');
  expect((await getWorldBook('shared'))!.worldbook.entries['7'].content).toBe('原内容 A');
  expect((await getWorldBook(first))!.worldbook.entries['7'].content).toBe('新内容 B');
  await act(async () => { await router.navigate(`/worldbook?assetId=${first}&characterId=c1`); await new Promise(resolve => setTimeout(resolve, 40)); });
  await edit('第三版 C'); await act(async () => { await router.navigate('/done'); await new Promise(resolve => setTimeout(resolve, 50)); });
  await waitForNavigation(router, '/done');
  expect(await getAllWorldBooks()).toHaveLength(2);
  act(() => root.unmount()); root = createRoot(container);
  if (mode === 'vault') setActiveVault(createVault(fs)); else closeDB();
  await mount(first);
  expect((await getWorldBook(first))!.worldbook.entries['7'].content).toBe('第三版 C');
}, 10_000); // This integration case performs two saves, three mounts and a durable reopen.

it('rejects a conflicting repository revision and leaves navigation and the draft at the editor', async () => {
  await seed(); const router = await mount(); await edit('本页草稿');
  await saveWorldBook({ ...shared, worldbook: { entries: { '7': { ...shared.worldbook.entries['7'], content: '其他位置的新内容' } } }, updatedAt: 2 });
  await act(async () => { await router.navigate('/done'); await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(router.state.location.pathname).toBe('/worldbook');
  expect(document.querySelector('textarea')).toHaveValue('本页草稿');
  expect((await getWorldBook('shared'))!.worldbook.entries['7'].content).toBe('其他位置的新内容');
  expect(await getAllWorldBooks()).toHaveLength(1);
  act(() => root.unmount()); root = createRoot(container);
  await mount();
  expect(document.body.textContent).toContain('发现上次保存失败的草稿');
  expect(await getAllWorldBooks()).toHaveLength(1); // Restoring the page does not write or create a copy.
  const restore = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '恢复草稿并重试保存')!;
  await act(async () => restore.click());
  expect(document.querySelector('textarea')).toBeNull(); // Selection is intentionally reset on reopening.
  await act(async () => document.querySelector<HTMLElement>('[data-entry-key="7"]')!.click());
  expect(document.querySelector('textarea')).toHaveValue('本页草稿');
});
