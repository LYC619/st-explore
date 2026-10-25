import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { performanceFixture } from './performance-fixture';

// The app shell is unrelated to list reads. Pages, tiles, portraits, repositories
// and the vault filesystem adapter below are real.
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children, titleBarContent }: {
  children?: React.ReactNode; titleBarContent?: React.ReactNode;
}) => <div>{titleBarContent}{children}</div> }));
import Library from '@/pages/Library';
import Home from '@/pages/Home';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear(); sessionStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); setActiveVault(null); vi.unstubAllGlobals();
});
async function settle(check: () => void) {
  await act(async () => { await vi.waitFor(check); });
}
async function renderPage(page: 'home' | 'library') {
  await act(async () => root.render(<MemoryRouter><TooltipProvider>{page === 'home' ? <Home /> : <Library />}</TooltipProvider></MemoryRouter>));
}

it.each(['home', 'library'] as const)('%s only reads PNGs for its displayed characters', async page => {
  const fixture = await performanceFixture(48, 0);
  setActiveVault(createVault(fixture.fs));
  await renderPage(page);
  const count = page === 'home' ? 12 : 24;
  await settle(() => expect(container.querySelectorAll('[data-character-id] img')).toHaveLength(count));
  expect(fixture.calls.binary).toHaveLength(count);
  const visibleIds = [...container.querySelectorAll('[data-character-id]')].map(card => card.getAttribute('data-character-id'));
  expect(fixture.calls.binary.map(path => `perf-c${/性能角色(\d+)/.exec(path)![1]}`).sort()).toEqual(visibleIds.sort());
  if (page === 'library') {
    fixture.reset();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click());
    await settle(() => expect(container.querySelectorAll('[data-character-id] img')).toHaveLength(24));
    expect(fixture.calls.binary).toHaveLength(24);
    expect(container.querySelector('[data-character-id="perf-c0"]')).not.toBeNull();
  }
});

it('Home drops its previous vault snapshot when the active vault changes', async () => {
  const old = await performanceFixture(2, 0);
  setActiveVault(createVault(old.fs));
  await renderPage('home');
  await settle(() => expect(container.querySelectorAll('[data-character-id] img')).toHaveLength(2));
  const next = await performanceFixture(0, 0);
  await act(async () => setActiveVault(createVault(next.fs)));
  await settle(() => expect(container.querySelectorAll('[data-character-id]')).toHaveLength(0));
});
