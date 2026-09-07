import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NovelView from '@/components/reader/NovelView';
import type { ChatSession } from '@/types/chat';

const viewport = vi.hoisted(() => ({ isMobile: true }));
vi.mock('@/hooks/use-viewport', () => ({ useViewport: () => viewport }));
const virtual = vi.hoisted(() => ({
  count: 0, options: { scrollMargin: 0 }, scrollToIndex: vi.fn(), measureElement: vi.fn(),
  getTotalSize: () => virtual.count * 240,
  getVirtualItems: () => Array.from({ length: virtual.count }, (_, index) => ({
    key: index, index, start: index * 240, size: 240, end: (index + 1) * 240,
  })),
}));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number; scrollMargin: number }) => {
    virtual.count = options.count;
    virtual.options.scrollMargin = options.scrollMargin;
    return virtual;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let width = 400;
let height = 500;
const observers: { node: Element; callback: () => void }[] = [];
const session: ChatSession = {
  id: 'navigation', title: 'Navigation', character: { name: 'Character' }, user: { name: 'User' }, createdAt: 1,
  messages: Array.from({ length: 3 }, (_, i) => ({
    id: `m${i}`, role: 'assistant', content: `${i}: A complete sentence for reading. `.repeat(60), rawData: {},
  })),
};
const markers = [{ messageId: 'm2', messageIndex: 2, title: 'Last chapter', createdAt: 1 }];
const regexRules: [] = [];
const favorites = ['m2'];
const page = () => Number(container.querySelector('[data-novel-progress]')!.textContent!.match(/^\d+/)![0]) - 1;
const scrollHost = () => container.querySelector<HTMLDivElement>('[data-novel-scroll]')!;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('novel-view-zone-hint-seen', '1');
  viewport.isMobile = true;
  width = 400;
  height = 500;
  observers.length = 0;
  virtual.scrollToIndex.mockReset();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(node: Element) { observers.push({ node, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height,
      width: this.isConnected ? width : 0, height: this.isConnected ? height : 0,
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

async function render(currentSession = session, initialFloor = 0) {
  await act(async () => root.render(
    <NovelView session={currentSession} markers={markers} regexRules={regexRules}
      favorites={favorites} progressKey={currentSession.id} initialFloor={initialFloor}
      onClose={vi.fn()} readOnly embedded />,
  ));
}

async function key(key: string) {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

describe('novel reflow and scroll commands', () => {
  it('scrolls the body for repeated bookmark and chapter selections', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="书签列表"]')!.click());
    const bookmark = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.startsWith('#2'))!;
    virtual.scrollToIndex.mockClear();
    await act(async () => bookmark.click());
    const target = page();
    expect(target).toBeGreaterThan(1);
    expect(virtual.scrollToIndex).toHaveBeenLastCalledWith(target, { align: 'start' });
    virtual.scrollToIndex.mockClear();
    await act(async () => bookmark.click());
    expect(virtual.scrollToIndex).toHaveBeenCalledOnce();
    await key('Escape');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="章节目录"]')!.click());
    const chapter = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Last chapter'))!;
    virtual.scrollToIndex.mockClear();
    await act(async () => chapter.click());
    expect(virtual.scrollToIndex).toHaveBeenLastCalledWith(page(), { align: 'start' });
  });

  it('keeps a single-floor offset through resize and ignores zero-size reports', async () => {
    await render({ ...session, messages: [session.messages[0]] });
    for (let i = 0; i < 4; i++) await key('ArrowRight');
    expect(page()).toBe(4);
    const observer = observers.find(entry => entry.node === scrollHost())!;
    height = 650;
    await act(async () => observer.callback());
    expect(page()).toBeGreaterThan(0);
    const reflowed = page();
    expect(virtual.scrollToIndex).toHaveBeenLastCalledWith(reflowed, { align: 'start' });
    width = 0;
    height = 0;
    await act(async () => observer.callback());
    expect(page()).toBe(reflowed);
  });

  it('uses a stable measurement node across desktop page turns', async () => {
    viewport.isMobile = false;
    await render();
    const observer = observers[0];
    await key('ArrowRight');
    expect(observer.node.isConnected).toBe(true);
    const before = page();
    width = 0;
    height = 0;
    await act(async () => observer.callback());
    expect(page()).toBe(before);
  });

  it('keeps the latest jump locked and lets manual scrolling update progress without a new jump', async () => {
    await render();
    await key('ArrowRight');
    await act(async () => vi.advanceTimersByTime(80));
    await key('ArrowRight');
    await act(async () => vi.advanceTimersByTime(50));
    virtual.scrollToIndex.mockClear();
    await act(async () => {
      scrollHost().scrollTop = 0;
      scrollHost().dispatchEvent(new Event('scroll', { bubbles: true }));
      vi.advanceTimersByTime(20);
    });
    expect(page()).toBe(2);
    await act(async () => {
      scrollHost().dispatchEvent(new Event('wheel', { bubbles: true }));
      scrollHost().scrollTop = 240 * 3;
      scrollHost().dispatchEvent(new Event('scroll', { bubbles: true }));
      vi.advanceTimersByTime(20);
    });
    expect(page()).toBe(3);
    expect(virtual.scrollToIndex).not.toHaveBeenCalled();
  });

  it('initializes a new story independently of the old anchor', async () => {
    await render();
    for (let i = 0; i < 3; i++) await key('ArrowRight');
    expect(page()).toBe(3);
    await render({ ...session, id: 'another-story' });
    expect(page()).toBe(0);
    expect(virtual.scrollToIndex).toHaveBeenLastCalledWith(0, { align: 'start' });
  });
});
