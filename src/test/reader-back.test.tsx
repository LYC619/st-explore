import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NovelView from '@/components/reader/NovelView';
import ReaderView from '@/components/reader/ReaderView';
import { backHandlerCount, handleBackPress, registerBackHandler, resetBackHandlers } from '@/lib/back-button';
import { useReaderBack } from '@/lib/immersive-mode';
import type { ChatSession } from '@/types/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const session: ChatSession = {
  id: 'back', title: 'Back', character: { name: 'C' }, user: { name: 'U' }, createdAt: 1,
  messages: [{ id: 'm', role: 'assistant', content: 'Text', rawData: {} }],
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  resetBackHandlers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetBackHandlers();
  vi.unstubAllGlobals();
});

describe('reader back ownership', () => {
  it('registers the fullscreen novel reader on a wide viewport, but not an embedded reader', async () => {
    const close = vi.fn();
    const render = (embedded: boolean) => act(async () => root.render(
      <NovelView session={session} markers={[]} regexRules={[]} onClose={close} readOnly embedded={embedded} />,
    ));
    await render(false);
    expect(backHandlerCount()).toBe(1);
    await act(async () => { expect(handleBackPress()).toBe('handled'); });
    expect(close).toHaveBeenCalledOnce();
    await render(true);
    expect(backHandlerCount()).toBe(0);
    expect(handleBackPress()).toBe('unhandled');
  });

  it('updates the reader callback without moving it above a later overlay', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const render = (onClose: () => void) => act(async () => root.render(
      <ReaderView messages={session.messages} markers={[]} regexRules={[]}
        characterName="C" userName="U" onClose={onClose} />,
    ));
    await render(first);
    const overlay = vi.fn(() => true);
    const remove = registerBackHandler(overlay);
    await render(second);
    expect(backHandlerCount()).toBe(2);
    expect(handleBackPress()).toBe('handled');
    expect(overlay).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    remove();
    expect(handleBackPress()).toBe('handled');
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('unregisters the hook on disable and preserves Radix priority', async () => {
    const close = vi.fn();
    function Layer({ enabled }: { enabled: boolean }) { useReaderBack(enabled, close); return null; }
    await act(async () => root.render(<Layer enabled />));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.state = 'open';
    document.body.appendChild(dialog);
    expect(handleBackPress()).toBe('closed-layer');
    expect(close).not.toHaveBeenCalled();
    dialog.remove();
    await act(async () => root.render(<Layer enabled={false} />));
    expect(backHandlerCount()).toBe(0);
  });
});
