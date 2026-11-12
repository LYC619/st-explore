import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
import { setAppConfig, repairAppConfig } from '@/lib/vault/tauri-fs';
import { Toaster } from '@/components/ui/toaster';
import { clearToastsForModal } from '@/hooks/use-toast';
import { ApiScopeToggle } from '@/components/ai-tools/ApiScopeToggle';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
import { hydrateApiProfilesFromSystem, getApiConfigSyncState } from '@/lib/vault/sensitive-config';

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
it('scope toggle keeps the lock notice and retries after a rejected native write', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  localStorage.clear(); setCurrentVaultId('synthetic-lock-vault');
  const values = new Map<string, unknown>();
  let locked = true;
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'config_get') return values.get(args.key) ?? null;
    if (command === 'config_set') {
      if (locked) throw 'STE_CONFIG_LOCK_TIMEOUT:synthetic-private-detail';
      values.set(args.key, args.value);
    }
  });
  await hydrateApiProfilesFromSystem();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<><Toaster/><ApiScopeToggle onChanged={() => {}}/></>));
  const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;
  try {
    await act(async () => toggle().click());
    expect(document.body.textContent).toContain('另一个 STE 窗口正在写配置，请稍后再试');
    expect(document.body.textContent).not.toContain('synthetic-private-detail');
    expect(getApiConfigSyncState().status).toBe('ready');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    locked = false;
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(values.get('apiScopeByVault')).toEqual({ 'synthetic-lock-vault': 'vault' });
  } finally {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); setCurrentVaultId(null); localStorage.clear(); native.invoke.mockReset();
  }
});
