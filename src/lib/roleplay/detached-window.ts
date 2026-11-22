import { useSyncExternalStore } from 'react';
import { getVaultEpoch } from '@/lib/vault/active';
import './frame';

export type TavernWindowMode = 'detached' | 'inline';

export interface OpenRoleplayChat {
  id: string;
  branchId?: string | null;
  fromChats: boolean;
  epoch: number;
}

export interface RoleplaySessionSnapshot {
  openChat: OpenRoleplayChat | null;
  detached: boolean;
  container: HTMLElement | null;
  generating: boolean;
}

export interface DetachedWindowReservation {
  win: Window;
  container: HTMLElement;
  cancelIfUnused: () => void;
  markClaimed: () => void;
}

const MODE_STORAGE_KEY = 'ste-tavern-window-mode';
const DETACHED_WINDOW_NAME = 'ste-tavern-detached';
const DETACHED_ROOT_ID = 'ste-detached-tavern-root';

let snapshot: RoleplaySessionSnapshot = {
  openChat: null,
  detached: false,
  container: null,
  generating: false,
};

let detachedWin: Window | null = null;
let detachedCleanup: (() => void) | null = null;
let closeFlushHandler: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function updateSnapshot(patch: Partial<RoleplaySessionSnapshot>): void {
  const next: RoleplaySessionSnapshot = { ...snapshot, ...patch };
  if (
    next.detached === snapshot.detached
    && next.container === snapshot.container
    && next.generating === snapshot.generating
    && next.openChat?.id === snapshot.openChat?.id
    && next.openChat?.branchId === snapshot.openChat?.branchId
    && next.openChat?.fromChats === snapshot.openChat?.fromChats
    && next.openChat?.epoch === snapshot.openChat?.epoch
  ) {
    return;
  }
  snapshot = next;
  emit();
}

export function subscribeRoleplaySession(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getRoleplaySessionSnapshot(): RoleplaySessionSnapshot {
  return snapshot;
}

export function useRoleplaySessionState(): RoleplaySessionSnapshot {
  return useSyncExternalStore(subscribeRoleplaySession, getRoleplaySessionSnapshot, getRoleplaySessionSnapshot);
}

export function getPreferredTavernWindowMode(): TavernWindowMode {
  if (typeof window === 'undefined') return 'inline';
  if (window.innerWidth < 768) return 'inline';
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === 'detached' || stored === 'inline') return stored;
  } catch { /* non-critical preference */ }
  if (typeof navigator !== 'undefined' && navigator.webdriver) return 'inline';
  return 'detached';
}

export function setPreferredTavernWindowMode(mode: TavernWindowMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch { /* non-critical preference */ }
}

export function buildPlayPath(storyId: string, branchId?: string | null, fromChats = false): string {
  const params = new URLSearchParams();
  if (branchId !== undefined) params.set('branch', branchId ?? '');
  if (fromChats) params.set('from', 'chats');
  const qs = params.toString();
  return `/play/${encodeURIComponent(storyId)}${qs ? `?${qs}` : ''}`;
}

function syncStylesAndTheme(sourceDoc: Document, targetDoc: Document): () => void {
  const copyRootAttributes = () => {
    targetDoc.documentElement.className = sourceDoc.documentElement.className;
    const styleText = sourceDoc.documentElement.getAttribute('style');
    if (styleText) targetDoc.documentElement.setAttribute('style', styleText);
    else targetDoc.documentElement.removeAttribute('style');
    targetDoc.documentElement.style.setProperty('--app-chrome-h', '0px');
    targetDoc.documentElement.style.setProperty('--mobile-tab-bar-h', '0px');
    const sourceDataAttrs = new Set<string>();
    for (const attr of Array.from(sourceDoc.documentElement.attributes)) {
      if (attr.name.startsWith('data-')) {
        sourceDataAttrs.add(attr.name);
        targetDoc.documentElement.setAttribute(attr.name, attr.value);
      }
    }
    for (const attr of Array.from(targetDoc.documentElement.attributes)) {
      if (attr.name.startsWith('data-') && !sourceDataAttrs.has(attr.name)) {
        targetDoc.documentElement.removeAttribute(attr.name);
      }
    }
  };
  const syncHeadNodes = () => {
    for (const old of Array.from(targetDoc.head.querySelectorAll('[data-ste-synced-style]'))) {
      old.remove();
    }
    for (const node of Array.from(sourceDoc.head.querySelectorAll('style, link[rel="stylesheet"]'))) {
      const cloned = node.cloneNode(true) as HTMLElement;
      cloned.setAttribute('data-ste-synced-style', '1');
      if (cloned.tagName === 'LINK') {
        const href = (node as HTMLLinkElement).href;
        if (href) (cloned as HTMLLinkElement).href = href;
      }
      targetDoc.head.appendChild(cloned);
    }
  };

  copyRootAttributes();
  syncHeadNodes();

  const attrObserver = new MutationObserver(copyRootAttributes);
  attrObserver.observe(sourceDoc.documentElement, { attributes: true });
  const headObserver = new MutationObserver(syncHeadNodes);
  headObserver.observe(sourceDoc.head, { childList: true, subtree: true, characterData: true });

  return () => {
    attrObserver.disconnect();
    headObserver.disconnect();
  };
}

function teardownDetachedWindow(closeOsWindow: boolean): void {
  const win = detachedWin;
  detachedWin = null;
  detachedCleanup?.();
  detachedCleanup = null;
  if (closeOsWindow && win && !win.closed) {
    try { win.close(); } catch { /* ignore */ }
  }
}

export function closeDetachedTavernWindow(): void {
  teardownDetachedWindow(true);
  updateSnapshot({ detached: false, container: null });
}

export function focusDetachedTavernWindow(): boolean {
  if (!detachedWin || detachedWin.closed) return false;
  try {
    detachedWin.focus();
    return true;
  } catch {
    return false;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

/**
 * 异步创建/校验故事前的独立窗口预约：
 * - 普通浏览器：必须在同步点击调用栈内先打开窗口，避免异步 DB 操作后被浏览器弹窗拦截器拒绝；
 * - Tauri 桌面端：由 Rust `on_new_window` 托管，无需抢同步激活，延后到故事准备与 `<Roleplay />`
 *   模块预热完成后再建窗，彻底避开 WebView2 新建窗口与自定义协议资源请求的并发竞争。
 */
export function reserveDetachedWindowForAsyncAction(forceDetached = false): DetachedWindowReservation | null {
  if (isTauriRuntime()) return null;
  return preopenDetachedTavernWindow(forceDetached);
}

export function preopenDetachedTavernWindow(forceDetached = false): DetachedWindowReservation | null {
  if (typeof window === 'undefined') return null;
  if (!forceDetached && getPreferredTavernWindowMode() !== 'detached') return null;

  const reusingExisting = Boolean(detachedWin && !detachedWin.closed);
  let win: Window | null = reusingExisting ? detachedWin : null;

  if (!win) {
    try {
      win = window.open('', DETACHED_WINDOW_NAME, 'popup=yes,width=1200,height=860,resizable=yes');
    } catch {
      return null;
    }
  }
  if (!win || win.closed) return null;

  let container: HTMLElement | null = null;
  try {
    const registry = (window.__STE_TAVERN_HOSTS__ ??= new Map());
    win.__STE_TAVERN_HOSTS__ = registry;
    const doc = win.document;
    doc.title = 'ST Explorer · 独立酒馆对话';
    if (!doc.head.querySelector('base[data-ste-base]')) {
      const base = doc.createElement('base');
      base.setAttribute('data-ste-base', '1');
      base.href = `${window.location.origin}/`;
      doc.head.prepend(base);
    }
    doc.body.style.margin = '0';
    doc.body.style.overflow = 'clip';
    container = doc.getElementById(DETACHED_ROOT_ID);
    if (!container) {
      container = doc.createElement('div');
      container.id = DETACHED_ROOT_ID;
      container.style.height = '100dvh';
      container.style.width = '100%';
      container.style.overflow = 'clip';
      doc.body.innerHTML = '';
      doc.body.appendChild(container);
    }
    if (!reusingExisting) {
      detachedCleanup?.();
      const stopStyleSync = syncStylesAndTheme(window.document, doc);
      const handleChildClosed = () => {
        if (detachedWin !== win) return;
        teardownDetachedWindow(false);
        const flush = closeFlushHandler;
        // Keep openChat mounted until flush finishes so <Roleplay /> & host do not unmount prematurely.
        updateSnapshot({ detached: false, container: null, generating: false });
        if (flush) {
          void flush()
            .then(() => {
              if (!snapshot.detached) updateSnapshot({ openChat: null });
            })
            .catch((err) => {
              console.warn('[detached-window] 关闭独立酒馆窗口时保存未完成，已在主窗口保留恢复入口:', err);
            });
        } else {
          updateSnapshot({ openChat: null });
        }
      };
      const pollTimer = window.setInterval(() => {
        if (win!.closed) handleChildClosed();
      }, 450);
      const onMainPageHide = () => {
        teardownDetachedWindow(true);
      };
      win.addEventListener('pagehide', handleChildClosed);
      window.addEventListener('pagehide', onMainPageHide);
      detachedCleanup = () => {
        window.clearInterval(pollTimer);
        stopStyleSync();
        try { win!.removeEventListener('pagehide', handleChildClosed); } catch { /* ignore */ }
        window.removeEventListener('pagehide', onMainPageHide);
      };
      detachedWin = win;
    }
    try { win.focus(); } catch { /* ignore */ }
  } catch {
    try { if (!reusingExisting) win.close(); } catch { /* ignore */ }
    return null;
  }

  let claimed = reusingExisting && Boolean(snapshot.openChat);
  return {
    win,
    container,
    markClaimed: () => { claimed = true; },
    cancelIfUnused: () => {
      if (!claimed && !reusingExisting) {
        teardownDetachedWindow(true);
      }
    },
  };
}

export function setRoleplayOpenChat(openChat: OpenRoleplayChat | null, options?: { detached?: boolean; container?: HTMLElement | null }): void {
  updateSnapshot({
    openChat,
    ...(options?.detached !== undefined ? { detached: options.detached } : {}),
    ...(options?.container !== undefined ? { container: options.container } : {}),
    ...(!openChat ? { detached: false, container: null, generating: false } : {}),
  });
}

export function setRoleplayGeneratingState(generating: boolean): void {
  updateSnapshot({ generating });
}

export function registerDetachedCloseFlushHandler(handler: (() => Promise<void>) | null): () => void {
  closeFlushHandler = handler;
  return () => {
    if (closeFlushHandler === handler) closeFlushHandler = null;
  };
}

export async function flushAndCloseDetachedWindow(): Promise<void> {
  const flush = closeFlushHandler;
  if (flush) await flush();
  closeDetachedTavernWindow();
}

export function launchRoleplayTarget(params: {
  storyId: string;
  branchId?: string | null;
  fromChats?: boolean;
  navigate: (path: string) => void;
  reservation?: DetachedWindowReservation | null;
  forceMode?: TavernWindowMode;
}): 'detached' | 'inline' {
  const { storyId, branchId, fromChats = false, navigate, reservation, forceMode } = params;
  const path = buildPlayPath(storyId, branchId, fromChats);

  if (forceMode === 'inline') {
    reservation?.cancelIfUnused();
    setPreferredTavernWindowMode('inline');
    closeDetachedTavernWindow();
    navigate(path);
    return 'inline';
  }

  const handle = reservation ?? preopenDetachedTavernWindow(forceMode === 'detached');
  if (handle) {
    handle.markClaimed();
    if (forceMode === 'detached') setPreferredTavernWindowMode('detached');
    setRoleplayOpenChat(
      { id: storyId, branchId, fromChats, epoch: getVaultEpoch() },
      { detached: true, container: handle.container },
    );
    return 'detached';
  }

  navigate(path);
  return 'inline';
}
