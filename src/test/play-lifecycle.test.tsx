import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { usePlayLifecycle } from '@/play/use-play-lifecycle';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const bridge = vi.hoisted(() => ({ handlers: new Map<string, (event: { isActive: boolean }) => void>(), removed: vi.fn() }));
vi.mock('@/lib/runtime', () => ({ isCapacitor: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async (type: string, handler: (event: { isActive: boolean }) => void) => {
  bridge.handlers.set(type, handler); return { remove: async () => { bridge.handlers.delete(type); bridge.removed(type); } };
}), minimizeApp: vi.fn() } }));
afterEach(() => { bridge.handlers.clear(); vi.clearAllMocks(); });
it('独立游玩页面接入原生后台停止，并在卸载时移除返回及后台监听', async () => {
  const suspend = vi.fn(); function Play() { usePlayLifecycle(suspend); return null; }
  const node = document.createElement('div'); document.body.append(node); const mounted = createRoot(node);
  await act(async () => { mounted.render(<MemoryRouter initialEntries={['/worlds/test']}><Play /></MemoryRouter>); });
  expect(bridge.handlers.size).toBe(2);
  act(() => bridge.handlers.get('appStateChange')!({ isActive: false })); expect(suspend).toHaveBeenCalledTimes(1);
  act(() => bridge.handlers.get('appStateChange')!({ isActive: true })); expect(suspend).toHaveBeenCalledTimes(1);
  await act(async () => { mounted.unmount(); }); node.remove(); expect(bridge.handlers.size).toBe(0); expect(bridge.removed).toHaveBeenCalledTimes(2);
});
