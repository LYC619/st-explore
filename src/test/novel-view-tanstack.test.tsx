import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NovelView from '@/components/reader/NovelView';
import type { ChatSession } from '@/types/chat';

vi.mock('@/hooks/use-viewport', () => ({ useViewport: () => ({ isMobile: true }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session: ChatSession = {
  id: 'tanstack-cancellation', title: 'Cancellation', createdAt: 1,
  character: { name: 'Character' }, user: { name: 'User' },
  messages: Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`, role: 'assistant', rawData: {},
    content: 'A sentence for the reader. '.repeat(30),
  })),
};
const pageHeights = new Map<number, number>();
const observers = new Set<BrowserResizeObserver>();
let container: HTMLDivElement;
let root: Root;

class BrowserResizeObserver {
  readonly nodes = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
  observe(node: Element) { this.nodes.add(node); }
  unobserve(node: Element) { this.nodes.delete(node); }
  disconnect() { this.nodes.clear(); observers.delete(this); }
}

const scrollHost = () => container.querySelector<HTMLDivElement>('[data-novel-scroll]')!;
const pageNumber = () => Number(container.querySelector('[data-novel-progress]')!.textContent!.match(/^\d+/)![0]) - 1;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('novel-view-zone-hint-seen', '1');
  pageHeights.clear();
  observers.clear();
  vi.stubGlobal('ResizeObserver', BrowserResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100_000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? pageHeights.get(Number(this.dataset.index)) ?? 240 : 500;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const host = scrollHost();
    const top = host && this.parentElement?.parentElement === host ? 44 - host.scrollTop : 0;
    return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 500, width: 400, height: 500,
      toJSON: () => ({}),
    };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  await act(async () => root.render(
    <NovelView session={session} markers={[]} regexRules={[]} onClose={() => {}} readOnly embedded />,
  ));
  const host = scrollHost();
  // Only emulate the browser write/event boundary; TanStack's hook, measurement and RAF run normally.
  host.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? y : options?.top;
    host.scrollTop = top ?? host.scrollTop;
    window.setTimeout(() => host.dispatchEvent(new Event('scroll')), 0);
  };
  await act(async () => vi.advanceTimersByTime(200));
}

async function nextPage() {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowRight', bubbles: true, cancelable: true,
  })));
}

async function resizePage(index: number, height: number) {
  const node = container.querySelector<HTMLElement>(`[data-novel-scroll-page="${index}"]`)!;
  expect(node).not.toBeNull();
  pageHeights.set(index, height);
  const entry = { target: node, borderBoxSize: [{ inlineSize: 400, blockSize: height }] } as unknown as ResizeObserverEntry;
  await act(async () => {
    for (const observer of observers) {
      if (observer.nodes.has(node)) observer.callback([entry], observer as unknown as ResizeObserver);
    }
  });
}

describe('novel scrolling with the actual TanStack virtualizer', () => {
  it.each(['wheel', 'touchstart'] as const)('keeps manual scrolling after %s cancels a jump and a late measurement arrives', async (eventType) => {
    await mount();
    await nextPage();
    await nextPage();
    expect(pageNumber()).toBe(2);
    const host = scrollHost();
    const manualOffset = host.scrollTop + 80;
    await act(async () => {
      host.dispatchEvent(eventType === 'wheel'
        ? new WheelEvent('wheel', { bubbles: true, deltaY: 80 })
        : new TouchEvent('touchstart', { bubbles: true, changedTouches: [] }));
      host.scrollTop = manualOffset;
      host.dispatchEvent(new Event('scroll'));
    });

    await resizePage(1, 300);
    // An above-viewport item growing by 60px must still preserve the user's visual anchor.
    expect(host.scrollTop).toBe(manualOffset + 60);
    await act(async () => vi.advanceTimersByTime(200));
    expect(host.scrollTop).toBe(manualOffset + 60);
    expect(pageNumber()).toBe(2);
  });

  it('allows a new explicit jump and size adjustments after cancellation', async () => {
    await mount();
    await nextPage();
    const host = scrollHost();
    await act(async () => {
      host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 80 }));
      host.scrollTop += 80;
      host.dispatchEvent(new Event('scroll'));
    });
    const manualOffset = host.scrollTop;

    await nextPage();
    const targetOffset = host.scrollTop;
    expect(targetOffset).toBeGreaterThan(manualOffset);
    await resizePage(1, 300);
    await act(async () => vi.advanceTimersByTime(200));
    expect(host.scrollTop).toBe(targetOffset + 60);
    expect(pageNumber()).toBe(2);
  });
});
