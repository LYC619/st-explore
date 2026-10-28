// Management, import, editor and repositories remain real; only the application shell is replaced.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import PresetLibrary from '@/pages/PresetLibrary';
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
  const named = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[aria-label="${text}"],textarea[aria-label="${text}"]`);
  if (named) return named;
  const label = [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === text);
  const control = label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  if (!control) throw new Error(`Missing field: ${text}`);
  return control;
}

it('imports author files from the preset library, reads details, saves metadata, edits a DIY copy and restores the catalog', async () => {
  localStorage.clear(); sessionStorage.clear(); setTourCompleted('preset');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  setActiveVault(createVault(createMemFs()));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([{ path: '/presets', element: <PresetLibrary /> }, { path: '/preset', element: <Preset /> }, { path: '/tools', element: <Tools /> }], { initialEntries: ['/presets'] });
  await act(async () => root!.render(<TooltipProvider><RouterProvider router={router!} /></TooltipProvider>));
  await settle(() => expect(button('导入预设')).toBeEnabled());
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  await click(button('导入预设'));
  const raw = { prompts: [{ identifier: 'p', name: '提示块', content: '作者正文' }], prompt_order: [], impersonation_prompt: '工具提示' };
  const files = [['星海-v1-Claude.json', JSON.stringify(raw)], ['说明.md', '作者安装说明'], ['脚本.js', 'throw new Error("never execute")']].map(([name, text]) => {
    const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file;
  });
  await act(async () => {
    const control = document.querySelector<HTMLInputElement>('input[aria-label="选择预设和附带文件"]')!;
    Object.defineProperty(control, 'files', { value: files, configurable: true });
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(() => expect(button('导入 1 份预设')).toBeEnabled());
  expect(field('版本号').value).toBe('v1');
  expect(field('适配模型').value).toBe('Claude');
  expect(field('作者发布说明').value).toContain('作者安装说明');
  await input(field('作者'), '作者 A'); await input(field('系列'), '系列 A');
  await click(button('导入 1 份预设'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).not.toBeNull());
  const [original] = await getAllPresets();
  expect(new URLSearchParams(router!.state.location.search).get('presetId')).toBe(original.id);
  expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', original.id);
  expect(original.catalog).toMatchObject({ author: '作者 A', series: '系列 A', version: 'v1', models: ['Claude'] });
  expect(original.packageFiles).toHaveLength(2); expect(original.catalog?.releaseNotes).toContain('作者安装说明');
  const details = document.querySelector('[data-preset-details]')!;
  expect(details.querySelector('input,textarea,select')).toBeNull();
  expect(details.textContent).toContain('作者安装说明');
  expect(details.textContent).not.toContain('编辑原版');
  await click(button('整理资料'));
  await input(field('我的使用笔记'), '适合日常'); await click(button('保存资料'));
  await settle(() => expect(button('DIY')).toBeEnabled());
  expect((await getPreset(original.id))?.catalog?.notes).toBe('适合日常');
  expect(document.querySelector('[data-preset-details] input,[data-preset-details] textarea')).toBeNull();
  await input(document.querySelector<HTMLInputElement>('input[aria-label="搜索预设"]')!, '作者 A');
  await click(button('DIY'));
  await settle(() => expect(router!.state.location.pathname).toBe('/preset'));
  await settle(() => expect(button('覆盖保存')).toBeEnabled());
  expect(new URLSearchParams(router!.state.location.search).get('assetId')).toBe(original.id);
  expect(await getAllPresets()).toHaveLength(1);
  await click(button('格式与杂项'));
  await settle(() => expect(document.querySelector('textarea')).not.toBeNull());
  await input(document.querySelector('textarea')!, 'DIY工具提示');
  expect((await getPreset(original.id))?.preset.originalData.impersonation_prompt).toBe('工具提示');
  await click(button('另存为新版'));
  await settle(() => expect(new URLSearchParams(router!.state.location.search).get('assetId')).not.toBe(original.id));
  const diyId = new URLSearchParams(router!.state.location.search).get('assetId')!;
  await settle(() => expect(button('覆盖保存')).toBeEnabled());
  expect((await getPreset(diyId))?.preset.originalData.impersonation_prompt).toBe('DIY工具提示');
  expect((await getPreset(original.id))?.preset.originalData.impersonation_prompt).toBe('工具提示');
  expect((await getPreset(diyId))?.packageFiles).toHaveLength(2);
  expect((await getPreset(original.id))?.catalog?.notes).toBe('适合日常');
  expect((await getPreset(diyId))?.catalog).toMatchObject({ originId: original.id, series: '系列 A', version: 'v1', notes: '' });
  await click(button('格式与杂项'));
  await input(document.querySelector('textarea')!, '副本再次修改');
  await click(button('覆盖保存'));
  await settle(() => expect(button('覆盖保存')).toBeEnabled());
  expect((await getPreset(diyId))?.preset.originalData.impersonation_prompt).toBe('副本再次修改');
  await click(button('返回预设库'));
  await settle(() => expect(router!.state.location.pathname).toBe('/presets'));
  await settle(() => expect(document.querySelector<HTMLInputElement>('input[aria-label="搜索预设"]')?.value).toBe('作者 A'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', diyId));
  await click(button('我的 DIY'));
  await click(button('DIY'));
  await settle(() => expect(new URLSearchParams(router!.state.location.search).get('assetId')).toBe(diyId));
  await settle(() => expect(button('覆盖保存')).toBeEnabled());
  await click(button('返回预设库'));
  await settle(() => expect(button('我的 DIY')).toHaveAttribute('aria-pressed', 'true'));
  await settle(() => expect(document.querySelectorAll('[data-preset-collection] button[aria-label^="查看预设 "]')).toHaveLength(1));
  expect(document.querySelector('[data-preset-collection] button[aria-label^="查看预设 "]')).toHaveAttribute('aria-label', `查看预设 ${(await getPreset(diyId))!.catalog!.name}`);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="搜索预设"]')?.value).toBe('作者 A');
});
