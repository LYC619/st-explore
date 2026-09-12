import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Event } from '@tauri-apps/api/event';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('the real Tauri close-request helper can finish closing after the save guard permits it', async () => {
  const capability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  const invoke = vi.fn(async (command: string) => {
    const permission = 'core:window:allow-' + command.split('|').at(-1);
    if (!capability.permissions.includes(permission)) throw new Error(command + ' not allowed: ' + permission);
  });
  vi.stubGlobal('__TAURI_INTERNALS__', { metadata: { currentWindow: { label: 'main' } }, invoke });
  const nativeWindow = getCurrentWindow();
  let dispatch: (event: Event<unknown>) => unknown = () => { throw new Error('listener not installed'); };
  vi.spyOn(nativeWindow, 'listen').mockImplementation(async (_name, handler) => {
    dispatch = handler as (event: Event<unknown>) => unknown;
    return () => {};
  });
  let allowExit = false;
  await nativeWindow.onCloseRequested(event => { if (!allowExit) event.preventDefault(); });
  await dispatch({ event: 'tauri://close-requested', id: 1, payload: null });
  expect(invoke).not.toHaveBeenCalled();
  allowExit = true;
  await dispatch({ event: 'tauri://close-requested', id: 2, payload: null });
  expect(invoke).toHaveBeenCalledWith('plugin:window|destroy', { label: 'main' }, undefined);
});
