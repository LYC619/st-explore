// Queued for the consolidated test batch. Management, editor and repositories remain real.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AssetLibrary from '@/pages/AssetLibrary';
import Preset from '@/pages/Preset';
import Tools from '@/pages/Tools';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getAllPresets, getPreset } from '@/lib/preset-db';
import { setTourCompleted } from '@/lib/tour-steps';

vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <div>{actions}{children}</div> }));
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  router?.dispose(); root = undefined; router = undefined;
  document.body.innerHTML = ''; setActiveVault(null); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function settle(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); check(); });
}
function button(text: string): HTMLButtonElement {
  const node = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
async function click(node: HTMLElement) { await act(async () => { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); node.click(); }); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
function field(text: string): HTMLInputElement | HTMLTextAreaElement {
  const label = [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === text);
  const control = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  if (!control) throw new Error(`Missing field: ${text}`);
  return control;
}

it('imports author files from the asset library, saves metadata, opens a DIY editor and restores the catalog', async () => {
  localStorage.clear(); sessionStorage.clear(); setTourCompleted('preset');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  setActiveVault(createVault(createMemFs()));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([{ path: '/assets', element: <AssetLibrary /> }, { path: '/preset', element: <Preset /> }, { path: '/tools', element: <Tools /> }], { initialEntries: ['/assets?tab=preset'] });
  await act(async () => root!.render(<TooltipProvider><RouterProvider router={router!} /></TooltipProvider>));
  await settle(() => expect(button('导入作者预设')).toBeEnabled());
  await click(button('导入作者预设'));
  const raw = { prompts: [{ identifier: 'p', name: '提示块', content: '作者正文' }], prompt_order: [], impersonation_prompt: '工具提示' };
  const files = [['A-v1.json', JSON.stringify(raw)], ['说明.md', '作者安装说明'], ['脚本.js', 'throw new Error("never execute")']].map(([name, text]) => {
    const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file;
  });
  await act(async () => {
    const control = document.querySelector<HTMLInputElement>('input[aria-label="选择预设和附带文件"]')!;
    Object.defineProperty(control, 'files', { value: files, configurable: true });
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(() => expect(button('导入 1 份预设')).toBeEnabled());
  await input(field('作者'), '作者 A'); await input(field('系列'), '系列 A'); await input(field('版本号'), 'v1'); await input(field('适配模型'), 'Claude');
  await click(button('导入 1 份预设'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).not.toBeNull());
  const [original] = await getAllPresets();
  expect(original.catalog).toMatchObject({ author: '作者 A', series: '系列 A', version: 'v1', models: ['Claude'] });
  expect(original.packageFiles).toHaveLength(2); expect(original.catalog?.releaseNotes).toContain('作者安装说明');
  await input(field('我的使用笔记'), '适合日常'); await click(button('保存资料'));
  await settle(() => expect(button('复制后 DIY')).toBeEnabled());
  await input(document.querySelector<HTMLInputElement>('input[aria-label="搜索预设"]')!, '作者 A');
  await click(button('复制后 DIY'));
  await settle(() => expect(router!.state.location.pathname).toBe('/preset'));
  await settle(() => expect(button('保存')).toBeEnabled());
  const diyId = new URLSearchParams(router!.state.location.search).get('assetId')!;
  expect(diyId).not.toBe(original.id);
  await click(button('格式与杂项'));
  await settle(() => expect(document.querySelector('textarea')).not.toBeNull());
  await input(document.querySelector('textarea')!, 'DIY工具提示'); await click(button('保存'));
  await settle(() => expect(button('保存')).toBeEnabled());
  expect((await getPreset(diyId))?.preset.originalData.impersonation_prompt).toBe('DIY工具提示');
  expect((await getPreset(original.id))?.preset.originalData.impersonation_prompt).toBe('工具提示');
  expect((await getPreset(diyId))?.packageFiles).toHaveLength(2);
  await click(button('返回预设库 / 管理资料与附件'));
  await settle(() => expect(document.querySelector<HTMLInputElement>('input[aria-label="搜索预设"]')?.value).toBe('作者 A'));
});
