import { afterEach, expect, it, vi } from 'vitest';
import { closeDetachedTavernWindow, getRoleplaySessionSnapshot, launchRoleplayTarget,
  preopenDetachedTavernWindow, setRoleplayOpenChat } from '@/lib/roleplay/detached-window';

afterEach(() => { closeDetachedTavernWindow(); setRoleplayOpenChat(null); vi.restoreAllMocks(); });

it('keeps the portal and listeners when the OS refuses closing, then docks after a successful close', () => {
  let closed = false, cancelled = true;
  const doc = document.implementation.createHTMLDocument('Synthetic child');
  const remove = vi.fn();
  const child = { get closed() { return closed; }, close() { if (!cancelled) closed = true; }, document: doc,
    focus() {}, addEventListener() {}, removeEventListener: remove } as unknown as Window;
  vi.spyOn(window, 'open').mockReturnValue(child);
  const navigate = vi.fn();
  launchRoleplayTarget({ storyId: 'synthetic', navigate, reservation: preopenDetachedTavernWindow(true) });
  const before = getRoleplaySessionSnapshot();
  try {
    expect(closeDetachedTavernWindow()).toBe(false);
    expect(getRoleplaySessionSnapshot()).toBe(before);
    expect(remove).not.toHaveBeenCalled();
    expect(launchRoleplayTarget({ storyId: 'synthetic', navigate, forceMode: 'inline' })).toBe('detached');
    expect(navigate).not.toHaveBeenCalled();
    expect(getRoleplaySessionSnapshot().container).toBe(before.container);
    cancelled = false;
    expect(launchRoleplayTarget({ storyId: 'synthetic', navigate, forceMode: 'inline' })).toBe('inline');
    expect(closed).toBe(true);
    expect(getRoleplaySessionSnapshot().detached).toBe(false);
    expect(remove).toHaveBeenCalled();
  } finally { cancelled = false; }
});
