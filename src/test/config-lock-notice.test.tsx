import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
import { setAppConfig, repairAppConfig } from '@/lib/vault/tauri-fs';
import { Toaster } from '@/components/ui/toaster';
import { clearToastsForModal } from '@/hooks/use-toast';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if(root) await act(async () => root!.unmount()); root=undefined;document.body.innerHTML='';clearToastsForModal();vi.clearAllMocks(); });
it.each(['save','repair'] as const)('%s shows a specific contention notice even if the caller catches the error', async action => {
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async () => root!.render(<Toaster/>));
  const error='STE_CONFIG_LOCK_TIMEOUT:synthetic-private-detail';native.invoke.mockRejectedValueOnce(error);
  let caught:unknown;
  await act(async () => { try { if(action==='save') await setAppConfig('vaultRoot','synthetic');else await repairAppConfig(); } catch(value) { caught=value; } });
  expect(caught).toBe(error);
  expect(document.body.textContent).toContain('另一个 STE 窗口正在写配置，请稍后再试');
  expect(document.body.textContent).not.toContain('synthetic-private-detail');expect(native.invoke).toHaveBeenCalledOnce();
});
