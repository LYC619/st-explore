import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setActiveVault } from '@/lib/vault/active';

const host = vi.hoisted(() => ({ close: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }));
const createHost = vi.hoisted(() => vi.fn());
vi.mock('@/lib/roleplay/tavern-host', () => ({ createTavernHost: createHost }));
vi.mock('@/components/roleplay/RoleplayGuide', () => ({ RoleplayGuide: () => null }));
vi.mock('@/lib/runtime', () => ({ isTauri: () => false, isCapacitor: () => false }));
import { RoleplayWorkspace } from '@/components/roleplay/RoleplayWorkspace';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  vi.clearAllMocks();
  createHost.mockImplementation(async (options: { onGeneration?: (active: boolean) => void }) => { options.onGeneration?.(true); return host; });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  router = createMemoryRouter([{ element: <RoleplayWorkspace />, children: [
    { path: '/play/:id', element: null }, { path: '/library', element: <p>角色库</p> },
    { path: '/chat', element: <p>聊天处理</p> },
    { path: '/play', element: <p>聊天列表</p> },
  ] }], { initialEntries: ['/play/one?branch='] });
});
afterEach(async () => { await act(async () => root.unmount()); router.dispose(); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await import('@/pages/Roleplay');
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function go(path: string) { await act(async () => { await router.navigate(path); }); }

it('keeps the same live iframe when navigating away and returning without stopping generation', async () => {
  await render();
  const frame = container.querySelector('iframe'); expect(frame).not.toBeNull();
  await go('/library');
  expect(container.textContent).toContain('返回聊天');
  expect(container.querySelector('iframe')).toBe(frame);
  expect(frame?.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(host.flush).not.toHaveBeenCalled(); expect(host.close).not.toHaveBeenCalled();
  await go('/play/one?branch=');
  expect(container.querySelector('iframe')).toBe(frame);
  expect(frame?.closest('[aria-hidden="true"]')).toBeNull(); expect(createHost).toHaveBeenCalledTimes(1);
});

it('saves before replacing a background chat and keeps it recoverable when saving fails', async () => {
  await render(); await go('/library');
  const frame = container.querySelector('iframe');
  host.flush.mockRejectedValueOnce(new Error('disk full'));
  await go('/play/two?branch=');
  expect(router.state.location.pathname).toBe('/play/one');
  expect(container.querySelector('iframe')).toBe(frame);
  expect(host.close).not.toHaveBeenCalled();
  await go('/play/two?branch=');
  expect(router.state.location.pathname).toBe('/play/two');
  expect(host.close).toHaveBeenCalledTimes(1); expect(createHost).toHaveBeenCalledTimes(2);
});

it('resumes the existing selected branch from a chat-list URL that omits branch', async () => {
  await render();
  const frame = container.querySelector('iframe');
  await go('/library'); await go('/play/one?from=chats');
  expect(container.querySelector('iframe')).toBe(frame);
  expect(host.flush).not.toHaveBeenCalled(); expect(host.close).not.toHaveBeenCalled();
  expect(createHost).toHaveBeenCalledTimes(1);
});

it('returns to the current chat processing page instead of the retired story editor', async () => {
  await render();
  const back = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('返回聊天处理'));
  expect(back).toBeDefined(); await act(async () => back!.click());
  expect(router.state.location.pathname).toBe('/chat');
  expect(new URLSearchParams(router.state.location.search).get('storyId')).toBe('one');
});

it('releases the background iframe and host when the active vault changes', async () => {
  await render(); await go('/library');
  await act(async () => setActiveVault(null));
  expect(container.querySelector('iframe')).toBeNull(); expect(host.close).toHaveBeenCalledTimes(1);
});

it('closing in the background uses the live location after a delayed save', async () => {
  await render(); await go('/library');
  let finish!: () => void;
  host.flush.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭后台聊天"]')!.click());
  await go('/play/one?branch=');
  await act(async () => finish());
  expect(container.querySelector('iframe')).toBeNull();
  expect(router.state.location.pathname).toBe('/play');
  expect(container.textContent).toContain('聊天列表');
});

it('does not create an old chat host after defaults finish loading in a different vault', async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => setActiveVault(null));
  await act(async () => finish(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
  expect(createHost).not.toHaveBeenCalled(); expect(container.querySelector('iframe')).toBeNull();
});
