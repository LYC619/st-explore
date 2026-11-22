import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildCharacterFromCard, buildStoryFromSession, getArchiveStory, saveArchiveStory, saveCharacter } from '@/lib/archive-db';
import { parsePreset } from '@/lib/preset-parser';
import { getCurrentRepo } from '@/lib/repo';
import type { PresetItem } from '@/types/preset';
import ChatHub from '@/pages/ChatHub';
import { ChatHubStoryRow } from '@/components/roleplay/ChatHubStoryRow';
import {
  closeDetachedTavernWindow,
  getPreferredTavernWindowMode,
  getRoleplaySessionSnapshot,
  launchRoleplayTarget,
  preopenDetachedTavernWindow,
  registerDetachedCloseFlushHandler,
  reserveDetachedWindowForAsyncAction,
  setPreferredTavernWindowMode,
  setRoleplayOpenChat,
} from '@/lib/roleplay/detached-window';

describe('Batch 4 detached Tavern split-screen window & ChatHub slimdown', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    closeDB();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    setActiveVault(createVault(createMemFs()));
    closeDetachedTavernWindow();
    setRoleplayOpenChat(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    closeDetachedTavernWindow();
    setRoleplayOpenChat(null);
    setActiveVault(null);
    closeDB();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens same-origin detached Tavern window sharing __STE_TAVERN_HOSTS__ without navigating main window, and falls back to inline on narrow screens', () => {
    const childDoc = document.implementation.createHTMLDocument('child');
    let closed = false;
    const fakeChildWin = {
      get closed() { return closed; },
      close: vi.fn(() => { closed = true; }),
      focus: vi.fn(),
      document: childDoc,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    setPreferredTavernWindowMode('detached');
    expect(getPreferredTavernWindowMode()).toBe('detached');

    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeChildWin);
    const navSpy = vi.fn();

    const reservation = preopenDetachedTavernWindow();
    expect(reservation).not.toBeNull();
    expect(openSpy).toHaveBeenCalledOnce();

    const mode = launchRoleplayTarget({
      storyId: 'story-1',
      branchId: null,
      fromChats: true,
      navigate: navSpy,
      reservation,
    });
    expect(mode).toBe('detached');
    expect(navSpy).not.toHaveBeenCalled();
    expect((fakeChildWin as Window).__STE_TAVERN_HOSTS__).toBe(window.__STE_TAVERN_HOSTS__);

    const snap = getRoleplaySessionSnapshot();
    expect(snap.detached).toBe(true);
    expect(snap.openChat?.id).toBe('story-1');
    expect(snap.container?.id).toBe('ste-detached-tavern-root');

    // Mobile narrow screen falls back to inline navigation
    closeDetachedTavernWindow();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    expect(getPreferredTavernWindowMode()).toBe('inline');
    const mobileMode = launchRoleplayTarget({
      storyId: 'story-1',
      branchId: null,
      fromChats: true,
      navigate: navSpy,
    });
    expect(mobileMode).toBe('inline');
    expect(navSpy).toHaveBeenCalledWith('/play/story-1?branch=&from=chats');
  });

  it('defers window.open during async prep inside Tauri runtime so WebView2 asset fetches never race NewWindowRequested', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    setPreferredTavernWindowMode('detached');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const reservation = reserveDetachedWindowForAsyncAction();
      expect(reservation).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('ChatHub hides permanent onboarding clutter, shows prominent 山海之间 hero banner, and supports inline rename & preset binding', async () => {
    const char = buildCharacterFromCard({ name: '七濑胡桃', first_mes: '早安！' });
    await saveCharacter(char);
    const story = buildStoryFromSession({
      id: 's-kurumi',
      title: '放学后的雨天',
      character: { name: '七濑胡桃' },
      user: { name: '你' },
      messages: [{ id: 'm1', role: 'assistant', content: '早安！' }],
      createdAt: 1,
    }, char.id);
    await saveArchiveStory(story);
    await getCurrentRepo<PresetItem>('presets').put({
      id: 'p-warm',
      title: '日常甜文预设 v1.2',
      catalog: { name: '日常甜文预设', version: 'v1.2' },
      preset: parsePreset({ prompts: [], prompt_order: [] }),
      createdAt: 1,
      updatedAt: 1,
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/play']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ChatHub />
        </MemoryRouter>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('放学后的雨天');
    });

    // Onboarding billboard removed; compact help icon button present; prominent 山海之间 hero restored
    expect(container.textContent).not.toContain('第一次在 STE 续聊？');
    expect(container.querySelector('button[aria-label="续聊使用帮助"]')).not.toBeNull();
    expect(container.textContent).toContain('原生世界 · 无需配置模型');
    expect(container.textContent).toContain('山海之间');
    expect(container.textContent).toContain('走进地图，追踪十二位行旅。下一场雨，会改变谁的路？');

    // Quick reader jump button exists on the row
    expect(container.querySelector('button[aria-label="去阅读整理 放学后的雨天"]')).not.toBeNull();
    expect(await getArchiveStory(story.id)).toBeDefined();
  });

  it('keeps openChat alive until closeFlushHandler resolves when OS child window closes, and retains recovery session on flush failure', async () => {
    const childDoc = document.implementation.createHTMLDocument('child');
    const listeners = new Map<string, () => void>();
    const fakeChildWin = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      document: childDoc,
      addEventListener: vi.fn((event: string, cb: () => void) => { listeners.set(event, cb); }),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    setPreferredTavernWindowMode('detached');
    vi.spyOn(window, 'open').mockReturnValue(fakeChildWin);

    let resolveFlush!: () => void;
    let openChatDuringFlush: string | undefined;
    const unregister = registerDetachedCloseFlushHandler(() => new Promise<void>((resolve) => {
      openChatDuringFlush = getRoleplaySessionSnapshot().openChat?.id;
      resolveFlush = resolve;
    }));

    launchRoleplayTarget({
      storyId: 'story-flush-guard',
      branchId: null,
      fromChats: true,
      navigate: vi.fn(),
    });
    expect(childDoc.documentElement.style.getPropertyValue('--app-chrome-h')).toBe('0px');

    // Trigger child window pagehide
    listeners.get('pagehide')?.();
    expect(openChatDuringFlush).toBe('story-flush-guard');
    expect(getRoleplaySessionSnapshot().openChat?.id).toBe('story-flush-guard');
    expect(getRoleplaySessionSnapshot().detached).toBe(false);

    await act(async () => {
      resolveFlush();
      await Promise.resolve();
    });
    expect(getRoleplaySessionSnapshot().openChat).toBeNull();
    unregister();
  });

  it('ChatHubStoryRow Escape cancels inline rename without firing onRenameStory on blur', async () => {
    const onRenameStory = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <ChatHubStoryRow
          story={{
            id: 's1',
            title: '原始标题',
            characterId: 'c1',
            floorCount: 5,
            createdAt: 1,
            updatedAt: 2,
            markers: [],
            favorites: [],
            meta: { modelsUsed: [], playTimeMs: 0 },
          }}
          charName="测试角色"
          presets={[]}
          isLiveDetached={false}
          isMobile={false}
          onOpenChat={vi.fn()}
          onOpenDetached={vi.fn()}
          onOpenReader={vi.fn()}
          onChangeStoryPreset={vi.fn()}
          onRenameStory={onRenameStory}
          onRequestDelete={vi.fn()}
        />,
      );
    });

    const menuTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="原始标题 更多操作"]')!;
    await act(async () => {
      menuTrigger.focus();
      menuTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const renameItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes('重命名对话')) as HTMLElement;
    expect(renameItem).toBeDefined();
    await act(async () => {
      renameItem.click();
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="对话名称"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '误改的新标题');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onRenameStory).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="对话名称"]')).toBeNull();
    expect(container.textContent).toContain('原始标题');
  });
});
