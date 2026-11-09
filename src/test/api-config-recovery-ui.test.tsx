import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/vault/tauri-fs', () => ({
  isTauri: () => true,
  getAppConfig: vi.fn(async (key: string) => config.get(key) ?? null),
  setAppConfig: vi.fn(async (key: string, value: unknown) => { config.set(key, value); }),
}));
import { getAppConfig, setAppConfig } from '@/lib/vault/tauri-fs';
import { hydrateApiProfilesFromSystem } from '@/lib/vault/sensitive-config';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
import { APIConfigCard } from '@/components/ai-tools/APIConfigCard';
import { loadApiProfiles } from '@/components/ai-tools/api-profiles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const original = JSON.stringify([{ id: 'saved', name: '真实默认', apiKey: 'fixture-secret', apiUrl: 'https://example.invalid/v1', model: 'fixture' }]);
beforeEach(() => {
  localStorage.clear(); config.clear(); setCurrentVaultId(null);
  config.set('apiProfiles', original); config.set('apiActiveProfile', 'saved');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function input(label: string, value: string) {
  const field = document.querySelector(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('failed restore shows a persistent explanation, blocks saving and recovers through the real settings button', async () => {
  vi.mocked(getAppConfig).mockRejectedValueOnce(Error('fixture failure'));
  await hydrateApiProfilesFromSystem();
  await act(async () => root.render(<APIConfigCard />));
  expect(document.body.textContent).toContain('暂停写回');
  await input('API Key', 'fixture-new'); await click('保存配置');
  expect(config.get('apiProfiles')).toBe(original);
  expect(loadApiProfiles().profiles).toEqual([]);
  await click('重新读取已保存连接');
  expect(document.body.textContent).not.toContain('暂停写回');
  expect(loadApiProfiles().profiles[0].id).toBe('saved');
  // The user's unsaved draft is still in the form, not silently discarded by hydration.
  expect(document.querySelector('input[aria-label="API Key"]')).toHaveValue('fixture-new');
});

it('failed native save stays visible and retry saves the exact edited connection without losing others', async () => {
  await hydrateApiProfilesFromSystem();
  await act(async () => root.render(<APIConfigCard />));
  await input('提供商名称', '已编辑');
  vi.mocked(setAppConfig).mockRejectedValueOnce(Error('fixture disk failure'));
  await click('保存配置');
  expect(document.body.textContent).toContain('写入本机配置失败');
  expect(config.get('apiProfiles')).toBe(original);
  await click('重试保存连接');
  expect(JSON.parse(config.get('apiProfiles') as string)[0]).toMatchObject({ id: 'saved', name: '已编辑' });
  expect(document.body.textContent).not.toContain('写入本机配置失败');
});
