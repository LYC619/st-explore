import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareImage } from '@/components/reader/ShareImage';
import ReaderView from '@/components/reader/ReaderView';

vi.mock('@/lib/runtime', async original => ({ ...await original<object>(), isCapacitor: () => true }));
const native = vi.hoisted(() => ({
  write: vi.fn(async () => ({ uri: 'memory://share.png' })), share: vi.fn(async () => {}),
  blob: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(1) })),
}));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: native.write }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));
vi.mock('@/lib/share-image', async original => ({
  ...await original<object>(),
  canvasToPngBlob: native.blob,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fillText = vi.fn();
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillText, fillRect: vi.fn(), createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: (text: string) => ({ width: text.length * 12 }),
  } as unknown as CanvasRenderingContext2D);
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
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="生成分享图"]')!;
const textarea = () => document.querySelector<HTMLTextAreaElement>('#share-text')!;

describe('reader share snapshot and event isolation', () => {
  it.each(['generation', 'native share'] as const)('ignores stale %s completion after closing and reopening', async phase => {
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    if (phase === 'generation') native.blob.mockImplementationOnce(async () => {
      await pending;
      return { arrayBuffer: async () => new ArrayBuffer(1) };
    });
    else native.share.mockImplementationOnce(() => pending);
    await act(async () => root.render(<ShareImage storyTitle="A" currentText="Original" currentFloor={1} />));
    await act(async () => trigger().click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('生成并分享'))!.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => trigger().click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), 'New draft');
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => complete());
    expect(textarea()).not.toBeNull();
    expect(textarea().value).toBe('New draft');
    if (phase === 'generation') expect(native.share).not.toHaveBeenCalled();
  });

  it('freezes content and metadata on open while retaining edits and refreshes on reopen', async () => {
    const render = (value: string, floor: number) => act(async () => root.render(
      <ShareImage storyTitle={value} characterName={value} currentText={value} currentFloor={floor} />,
    ));
    await render('Original', 4);
    await act(async () => trigger().click());
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), 'Edited excerpt');
      textarea().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(textarea().value).toBe('Edited excerpt');
    await render('New parent text', 9);
    expect(textarea().value).toBe('Edited excerpt');
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('生成并分享'))!.click());
    expect(fillText).toHaveBeenCalledWith('Original', 60, 720);
    expect(fillText).toHaveBeenCalledWith('Original · 第 4 楼', 60, 760);
    expect(native.write).toHaveBeenCalledWith(expect.objectContaining({ path: 'share-4.png' }));
    await act(async () => trigger().click());
    expect(textarea().value).toBe('New parent text');
  });

  it('keeps trigger and portal pointer, touch and click events inside the tool', async () => {
    const received = vi.fn();
    await act(async () => root.render(
      <div onClick={received} onPointerDown={received} onTouchStart={received}>
        <ShareImage storyTitle="Title" currentText="Excerpt" currentFloor={0} />
      </div>,
    ));
    await act(async () => {
      trigger().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      trigger().dispatchEvent(new Event('touchstart', { bubbles: true }));
      trigger().click();
    });
    expect(textarea()).not.toBeNull();
    await act(async () => {
      textarea().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      textarea().dispatchEvent(new Event('touchstart', { bubbles: true }));
      textarea().click();
    });
    expect(received.mock.calls.length).toBe(0);
  });

  it('opening share from the reader never turns the page', async () => {
    await act(async () => root.render(
      <ReaderView messages={[
        { id: 'a', role: 'assistant', content: 'First page', rawData: {} },
        { id: 'b', role: 'assistant', content: 'Second page', rawData: {} },
      ]} markers={[]} regexRules={[]} characterName="C" userName="U" onClose={vi.fn()} />,
    ));
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await act(async () => vi.advanceTimersByTime(200));
    expect(container.textContent).toContain('Second page');
    vi.spyOn(container.firstElementChild as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      toJSON: () => ({}),
    });
    await act(async () => trigger().click());
    await act(async () => vi.advanceTimersByTime(200));
    expect(container.textContent).toContain('Second page');
    expect(textarea().value).toBe('Second page');
  });
});
