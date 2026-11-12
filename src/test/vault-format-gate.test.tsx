import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', async original => ({ ...await original<typeof import('@tauri-apps/api/core')>(), invoke: native.invoke }));
import { VaultGate } from '@/components/vault/VaultGate';
import { VaultSwitcher } from '@/components/vault/VaultSwitcher';
import { Toaster } from '@/components/ui/toaster';
import { clearToastsForModal } from '@/hooks/use-toast';
import { bootVault } from '@/lib/vault/bootstrap';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { registerAndActivateVault, registerVaultForNextBoot, selectRegisteredVaultForNextBoot } from '@/lib/vault/vault-registry-runtime';
import { ARCHIVE_SCHEMA_VERSION } from '@/lib/archive-migrate';

const path = 'D:/synthetic-format-vault';
const profile = { id: 'synthetic-format', name: '合成格式库', path, createdAt: 1, lastUsedAt: 1 };
const message = '这个库被更新版本的 STE 使用过，请用新版本打开';
let fs: ReturnType<typeof createMemFs>;
let config: Record<string, unknown>;
let root: Root | undefined;
let writes: string[];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear(); clearToastsForModal(); setActiveVault(null); setCurrentVaultId(null);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  fs = createMemFs(); writes = [];
  await fs.writeText('库信息.json', JSON.stringify({ id: 'archive-schema', schemaVersion: ARCHIVE_SCHEMA_VERSION + 1, updatedAt: 1 }));
  config = { vaultRegistry: { version: 1, activeId: profile.id, vaults: [profile] }, vaultRoot: path };
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'write_diagnostic_event') return;
    if (command === 'config_get') return config[String(args.key)] ?? null;
    if (command === 'config_set') { config[String(args.key)] = args.value; return; }
    if (command === 'vault_pick_authorized_directory') return path;
    expect(args.root).toBe(path);
    const file = String(args.path ?? '');
    if (command === 'vault_stat') { const stat = file === '' ? { exists: true, isDir: true } : await fs.stat(file); return { exists: stat.exists, is_dir: stat.isDir }; }
    if (command === 'vault_read_text') return fs.readText(file);
    if (command === 'vault_list_dir') return (await fs.list(file)).map(e => ({ name: e.name, is_dir: e.isDir, size: e.size }));
    writes.push(command);
    if (command === 'vault_write_text') return fs.writeText(file, String(args.content));
    if (command === 'vault_mkdir') return fs.mkdir(file);
    throw new Error('Unexpected synthetic filesystem mutation');
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = '';
  setActiveVault(null); setCurrentVaultId(null); clearToastsForModal(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('blocks a newer library before boot activation with zero library writes', async () => {
  const before = fs.dump();
  await expect(bootVault()).resolves.toBe('newer');
  expect(getActiveVault()).toBeNull(); expect(writes).toEqual([]); expect(fs.dump()).toEqual(before);
});

it.each([
  ['first selection', () => registerAndActivateVault(path)],
  ['registered switch', () => selectRegisteredVaultForNextBoot(profile.id)],
  ['new next-boot selection', () => registerVaultForNextBoot(path)],
] as const)('blocks %s without replacing the current backend or modifying the target library', async (_label, select) => {
  const previous = createVault(createMemFs()); setActiveVault(previous);
  const before = fs.dump(), oldConfig = structuredClone(config);
  await expect(select()).rejects.toThrow(message);
  expect(getActiveVault()).toBe(previous); expect(writes).toEqual([]); expect(fs.dump()).toEqual(before);
  expect(config).toEqual(oldConfig);
});

it.each([ARCHIVE_SCHEMA_VERSION, ARCHIVE_SCHEMA_VERSION - 1, undefined, '99', null])('preserves normal boot and write behavior for schema %s', async version => {
  await fs.writeText('库信息.json', JSON.stringify({ id: 'archive-schema', schemaVersion: version, updatedAt: 1 }));
  await expect(bootVault()).resolves.toBe('ready');
  await expect(registerAndActivateVault(path)).resolves.toMatchObject({ id: profile.id });
  await expect(selectRegisteredVaultForNextBoot(profile.id)).resolves.toMatchObject({ id: profile.id });
  await expect(registerVaultForNextBoot(path)).resolves.toMatchObject({ id: profile.id });
  await getActiveVault()!.fs.writeText('synthetic-marker.txt', 'synthetic');
  expect(await fs.readText('synthetic-marker.txt')).toBe('synthetic');
});

it('keeps a missing metadata file compatible and leaves web boot unchanged', async () => {
  await fs.removeFile('库信息.json');
  await expect(bootVault()).resolves.toBe('ready');
  vi.unstubAllGlobals(); native.invoke.mockClear(); setActiveVault(null);
  await expect(bootVault()).resolves.toBe('web'); expect(native.invoke).not.toHaveBeenCalled();
});

it('preserves legacy parsing for malformed JSON but never bypasses an unreadable metadata file', async () => {
  await fs.writeText('库信息.json', '{');
  await expect(bootVault()).resolves.toBe('ready');
  setActiveVault(null);
  fs.readText = async () => { throw new Error('synthetic read denied'); };
  await expect(bootVault()).resolves.toBe('unset');
  await expect(registerAndActivateVault(path)).rejects.toThrow('synthetic read denied');
  expect(getActiveVault()).toBeNull(); expect(writes).toEqual([]);
});

it('shows the actual startup message, retains folder selection, and opens a compatible library', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<VaultGate><span>合成应用内容</span></VaultGate>));
  expect(document.querySelector('[role="alert"]')).toHaveTextContent(message);
  expect(document.body).not.toHaveTextContent('合成应用内容'); expect(writes).toEqual([]);
  const choose = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('选择文件夹'));
  expect(choose).toBeTruthy();
  await act(async () => choose!.click());
  expect(document.body).toHaveTextContent(message); expect(writes).toEqual([]);
  await fs.writeText('库信息.json', JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA_VERSION }));
  await act(async () => choose!.click());
  expect(document.body).toHaveTextContent('合成应用内容');
});

it('shows the same rejection through the real running-app library switcher', async () => {
  const old = { ...profile, id: 'synthetic-old', name: '合成旧库', path: 'D:/synthetic-old' };
  config.vaultRegistry = { version: 1, activeId: old.id, vaults: [old, profile] }; config.vaultRoot = old.path;
  const previous = createVault(createMemFs()); setActiveVault(previous);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<><VaultSwitcher expanded/><Toaster/></>));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-vault-switcher]')!.click());
  const choose = [...document.querySelectorAll<HTMLButtonElement>('[data-vault-switcher-menu] button')].find(button => button.textContent?.includes(profile.name));
  expect(choose).toBeTruthy();
  await act(async () => { choose!.click(); await vi.dynamicImportSettled(); });
  expect(document.body).toHaveTextContent(message); expect(getActiveVault()).toBe(previous); expect(writes).toEqual([]);
  expect(document.querySelector('[data-vault-switcher-menu]')).not.toBeNull();
  expect(config.vaultRoot).toBe(old.path);
});
