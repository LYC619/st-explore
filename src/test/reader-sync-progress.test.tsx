import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession, getArchiveStory, saveArchiveStory, updateArchiveStory } from '@/lib/archive-db';
import { setTourCompleted } from '@/lib/tour-steps';
import { closeDetachedTavernWindow, getRoleplaySessionSnapshot, launchRoleplayTarget, preopenDetachedTavernWindow, registerDetachedCloseFlushHandler, setPreferredTavernWindowMode, setRoleplayOpenChat } from '@/lib/roleplay/detached-window';
import { loadActiveSession, loadSessionPointer, saveSessionPointer } from '@/lib/session-storage';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ArchiveStory } from '@/types/archive';
const fixture = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }), toast: fixture.toast }));
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div style={{ overflowY: 'auto', height: 800 }}>{children}</div> }));
import Index from '@/pages/Index';

let host: HTMLDivElement;
let root: Root;
let story: ArchiveStory;
let router: ReturnType<typeof createMemoryRouter>;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  closeDB();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  localStorage.clear(); sessionStorage.clear(); fixture.toast.mockClear();
  setTourCompleted('home');
  closeDetachedTavernWindow(); setRoleplayOpenChat(null);
  setActiveVault(createVault(createMemFs()));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  story = buildStoryFromSession({ id: 'synth-session', title: 'Synthetic story', createdAt: 1,
    user: { name: 'Synthetic user' }, character: { name: 'Synthetic character' },
    messages: Array.from({length: 20}, (_, i) => ({ id: `synthetic-${i}`, role: 'assistant' as const, content: `Synthetic floor ${i}` })) });
  await saveArchiveStory(story);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  closeDetachedTavernWindow(); setRoleplayOpenChat(null);
  setActiveVault(null); closeDB(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(query = '') {
  router = createMemoryRouter([{ path: '/chat', element: <TooltipProvider><Index /></TooltipProvider> }], { initialEntries: [`/chat?storyId=${story.id}${query}`] });
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
}
async function rename() {
  const titleButton = host.querySelector<HTMLButtonElement>('[aria-label="故事名称：Synthetic story"]')!;
  expect(titleButton).toBeTruthy(); expect(titleButton.disabled).toBe(false);
  await act(async () => titleButton.click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="故事名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Synthetic edited');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await act(async () => { await new Promise(r => setTimeout(r, 900)); });
}
function detach() {
  const doc = document.implementation.createHTMLDocument('synthetic child');
  let closed = false;
  const events = new EventTarget();
  const child = { get closed() { return closed; }, close() { closed = true; }, focus() {}, document: doc,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Window;
  vi.spyOn(window, 'open').mockReturnValue(child);
  setPreferredTavernWindowMode('detached');
  launchRoleplayTarget({ storyId: story.id, branchId: null, navigate: () => {}, reservation: preopenDetachedTavernWindow() });
  return () => { closed = true; events.dispatchEvent(new Event('pagehide')); };
}
it('control: ordinary real workbench rename saves to synthetic vault', async () => {
  await mount(); await rename();
  expect((await getArchiveStory(story.id))?.title).toBe('Synthetic edited');
});
it('accepts workbench edits after a detached update and close', async () => {
  detach(); await mount();
  expect(host.querySelector('[data-detached-sync-banner]')).toBeTruthy();
  await act(async () => { await updateArchiveStory(story.id, current => ({ session: { ...current.session, messages: [...current.session.messages, { id: 'synthetic-new', role: 'assistant', content: 'Synthetic new reply' }] } })); });
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  expect(host.textContent).toContain('共 21 楼');
  await act(async () => { closeDetachedTavernWindow(); setRoleplayOpenChat(null); });
  await rename();
  expect((await getArchiveStory(story.id))?.title).toBe('Synthetic edited');
  expect((await getArchiveStory(story.id))?.session.messages).toHaveLength(21);
  expect(fixture.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '聊天处理内容尚未保存' }));
});
it('control: initial floor query updates workbench position', async () => {
  await mount('&floor=12');
  await act(async () => { await new Promise(r => setTimeout(r, 350)); });
  expect(host.querySelector<HTMLInputElement>('[aria-label="跳转到楼层"]')?.value).toBe('12');
});
it('restores branch reading progress after switching away and back', async () => {
  await updateArchiveStory(story.id, () => ({ branches: [{ id: 'synthetic-branch', name: 'Synthetic branch', session: { ...story.session }, markers: [], favorites: [], createdAt: 1, updatedAt: 1 }] }));
  await mount('&branch=synthetic-branch');
  const floorInput = () => host.querySelector<HTMLInputElement>('[aria-label="跳转到楼层"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(floorInput(), '12');
    floorInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => floorInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(floorInput().value).toBe('12');
  await act(async () => { await new Promise(r => setTimeout(r, 900)); });
  const switchTo = async (label: string) => {
    const trigger = host.querySelector<HTMLButtonElement>('[title="切换故事主线或分支"]')!;
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const menu = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el => el.textContent?.startsWith(label));
    expect(menu).toBeTruthy();
    await act(async () => { menu!.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  };
  await switchTo('主线');
  await switchTo('Synthetic branch');
  expect(floorInput().value).toBe('12');
  expect((await getArchiveStory(story.id))?.branches?.[0].lastFloor).toBe(12);
  await act(async () => { await new Promise(r => setTimeout(r, 550)); });
  expect(loadSessionPointer()).toMatchObject({ currentBookId: story.id, branchId: 'synthetic-branch', lastFloor: 12 });
});

it('waits for the final OS-close flush, syncs its reply, and then permits editing', async () => {
  const closeOs = detach(); await mount();
  let finish!: () => void;
  const off = registerDetachedCloseFlushHandler(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    await updateArchiveStory(story.id, current => ({ session: { ...current.session, messages: [...current.session.messages,
      { id: 'closing-reply', role: 'assistant', content: 'Synthetic closing reply' }] } }));
  });
  try {
    await act(async () => { closeOs(); });
    expect(getRoleplaySessionSnapshot().closing).toBe(true);
    expect(host.querySelector('[data-detached-sync-banner]')).toBeTruthy();
    await act(async () => { finish(); await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(getRoleplaySessionSnapshot().openChat).toBeNull();
    expect(host.textContent).toContain('共 21 楼');
    await rename();
    expect((await getArchiveStory(story.id))?.title).toBe('Synthetic edited');
    expect((await getArchiveStory(story.id))?.session.messages.at(-1)?.id).toBe('closing-reply');
  } finally { off(); }
});

it('reads the active branch from a branch-aware pointer and treats legacy pointers as mainline', async () => {
  await updateArchiveStory(story.id, () => ({ branches: [{ id: 'branch', name: 'Branch', session: { ...story.session, title: 'Synthetic branch' }, markers: [], favorites: [], createdAt: 1, updatedAt: 1 }] }));
  saveSessionPointer({ currentBookId: story.id, branchId: 'branch', markers: [] });
  expect((await loadActiveSession())?.title).toBe('Synthetic branch');
  saveSessionPointer({ currentBookId: story.id, markers: [] });
  expect((await loadActiveSession())?.title).toBe('Synthetic story');
});
