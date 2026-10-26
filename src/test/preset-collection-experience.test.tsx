import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PresetLibrary from '@/pages/PresetLibrary';
import PresetDetail from '@/pages/PresetDetail';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { createPresetDiy, getPreset } from '@/lib/preset-db';
import { parsePreset } from '@/lib/preset-parser';
import type { PresetItem } from '@/types/preset';

// Keep the catalog, collection, details and persistence real.
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  setActiveVault(createVault(createMemFs()));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  router?.dispose(); root = undefined; router = undefined;
  document.body.innerHTML = ''; setActiveVault(null); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function settle(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); check(); });
}
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const node = [...scope.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  if (!node) throw new Error(`Missing button: ${text}`);
  return node;
}
function namedButton(name: string): HTMLButtonElement {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === name);
  if (!node) throw new Error(`Missing named button: ${name}`);
  return node;
}
async function click(node: HTMLElement) {
  await act(async () => { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); node.click(); });
}
async function input(node: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function preset(id: string, version: string, series = '星海叙事'): PresetItem {
  return {
    id, title: `${series}-Claude-${version}.json`, createdAt: 1, updatedAt: 2,
    preset: parsePreset({ prompts: [{ identifier: 'opening', name: '开场', content: `${version} 的完整正文` }], prompt_order: [] }),
    catalog: { name: series, author: '作者 A', series, version, models: ['Claude'], releaseNotes: `# ${version} 说明\n\n保留该版本的安装方法。` },
    packageFiles: [{ id: 'readme', name: 'README.md', kind: 'notes', text: `${version} 的附件原文` }],
  };
}
async function mount(items: PresetItem[], preview = true) {
  const repo = getCurrentRepo<PresetItem>('presets');
  for (const item of items) await repo.put(item);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  router = createMemoryRouter([{ path: '/presets', element: <PresetLibrary /> }, { path: '/presets/:id', element: <PresetDetail /> }], { initialEntries: ['/presets'] });
  await act(async () => root!.render(<TooltipProvider><RouterProvider router={router!} /></TooltipProvider>));
  await settle(() => expect(document.querySelectorAll('[data-preset-series]')).not.toHaveLength(0));
  if (preview) await click(button('预览'));
}

it('opens the series page in normal mode, protects version changes, saves its independent name and returns to the filtered library', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second], false);
  await input(document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')!, '星海');
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  expect(router!.state.location.pathname).toBe('/presets/v1');
  await click(button('整理资料'));
  await input(document.querySelector<HTMLInputElement>('[aria-label="名称"]')!, '独立名称');
  await click(namedButton(`切换版本 v2 ${second.title}`));
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click(button('返回继续整理'));
  expect(document.querySelector<HTMLInputElement>('[aria-label="名称"]')?.value).toBe('独立名称');
  await click(button('保存资料'));
  await settle(() => expect(button('整理资料')).toBeEnabled());
  expect((await getPreset('v1'))?.catalog).toMatchObject({ name: '独立名称', series: '星海叙事' });
  await click(namedButton(`切换版本 v2 ${second.title}`));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v2'));
  await click(button('返回预设库'));
  await settle(() => expect(document.querySelector('[data-preset-catalog]')).not.toBeNull());
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')?.value).toBe('星海');
  expect(button('预览')).toHaveAttribute('aria-pressed', 'false');
});

it('selects the entire series by clicking the card and changes only the four supported bulk fields', async () => {
  await mount([preset('v1', 'v1'), preset('v2', 'v2')], false);
  await click(button('批量管理'));
  await click(namedButton('选择 星海叙事'));
  expect(document.body.textContent).toContain('已选 2 份');
  await click(button('整理所选'));
  const labels = [...document.querySelectorAll('[role="dialog"] label')];
  await click(labels.find(label => label.textContent === '统一作者')!.querySelector('button')!);
  await input(document.querySelector<HTMLInputElement>('[aria-label="批量作者"]')!, '新作者');
  await click(labels.find(label => label.textContent === 'Claude')!.querySelector('button')!);
  await click(button('保存到所选预设'));
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  for (const id of ['v1', 'v2']) expect((await getPreset(id))?.catalog).toMatchObject({ author: '新作者', series: '星海叙事', models: [], modelsConfirmed: true });
  expect(document.querySelector('[data-preset-series]')?.textContent).not.toContain('Claude');
});

it('manages independent preset tags through the dialog and persists them when reopening', async () => {
  await mount([preset('v1', 'v1')]);
  await click(namedButton('管理预设标签'));
  await input(document.querySelector<HTMLInputElement>('[aria-label="新建预设标签"]')!, '常用');
  await click(button('添加标签'));
  await settle(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('常用'));
  await click(button('完成', document.querySelector('[role="dialog"]')!));
  await click(namedButton('管理预设标签'));
  const row = [...document.querySelectorAll('[role="dialog"] div')].find(el => el.className.includes('rounded-lg border') && el.textContent?.startsWith('常用'))!;
  await click(button('改名', row));
  await input(document.querySelector<HTMLInputElement>('[aria-label="重命名 类型/常用"]')!, '常用新版');
  await click(button('保存名称'));
  await settle(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('常用新版'));
  const updated = [...document.querySelectorAll('[role="dialog"] div')].find(el => el.className.includes('rounded-lg border') && el.textContent?.startsWith('常用新版'))!;
  await click(button('删除', updated)); await click(button('确认删除标签'));
  await settle(() => expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('常用新版'));
});

it('groups versions into one readable card, keeps a singleton title once, and opens each real version read-only', async () => {
  const longTitle = '为了长篇叙事保留复杂设定但不应反复占用空间的独立系列';
  await mount([preset('v1', 'v1'), preset('v2', 'v2'), preset('single', 'v3', longTitle)]);
  const cards = [...document.querySelectorAll('[data-preset-series]')];
  expect(cards).toHaveLength(2);
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  const single = cards.find(card => card.querySelector('h2')?.textContent === longTitle)!;
  expect(single.querySelectorAll('h2')).toHaveLength(1);
  expect(single.querySelector('h2')?.textContent).toBe(longTitle);
  expect(single.querySelector(`[aria-label="${longTitle}的版本"]`)).toBeNull();
  const series = cards.find(card => card.querySelector('h2')?.textContent === '星海叙事')!;
  expect(series.textContent).toContain('2 个版本');

  for (const version of ['v1', 'v2']) {
    await click(button(version, series));
    await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', version));
    const details = document.querySelector('[data-preset-details]')!;
    expect(details.querySelector('input,textarea,select')).toBeNull();
    expect(details.textContent).toContain(`${version} 说明`);
    await click(button('内容', details));
    await click(button('+开场', details));
    expect(details.textContent).toContain(`${version} 的完整正文`);
    await click(button('附件 · 1', details));
    await click(button('+说明 · README.md', details));
    expect(details.textContent).toContain(`${version} 的附件原文`);
    expect(details.querySelector('input,textarea,select')).toBeNull();
  }
});

it('distinguishes files sharing a version and opens the matching body for each file label', async () => {
  const first = preset('same-1', '3.10', '小猫之神');
  const second = preset('same-2', '3.10', '小猫之神');
  second.preset.prompts[0].content = '第二份同版本文件的独立正文';
  await mount([first, second]);
  expect(document.querySelectorAll('[data-preset-series]')).toHaveLength(1);
  expect(document.querySelector('[data-preset-series]')?.textContent).toContain('2 个版本');
  for (const [index, item] of [first, second].entries()) {
    await click(button(`3.10 · 文件 ${index + 1}`));
    await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', item.id));
    expect(new URLSearchParams(router!.state.location.search).get('presetId')).toBe(item.id);
    const details = document.querySelector('[data-preset-details]')!;
    await click(button('内容', details));
    await click(button('+开场', details));
    expect(details.querySelector('pre')?.textContent).toBe(item.preset.prompts[0].content);
  }
});

it('keeps an uncatalogued legacy preset and its DIY copy in one series with a single DIY label', async () => {
  const original = preset('legacy', '3.10');
  original.title = '【小猫之神】3.10';
  delete original.catalog;
  await mount([original]);
  let copy: PresetItem | undefined;
  await act(async () => { copy = await createPresetDiy(original.id); });
  await settle(() => expect(document.querySelector('[data-preset-series]')?.textContent).toContain('2 个版本'));
  expect(document.querySelectorAll('[data-preset-series]')).toHaveLength(1);
  expect(document.querySelector('[data-preset-series] h2')?.textContent).toBe('小猫之神');
  const copyButton = button('3.10 · DIY');
  expect(copyButton.textContent!.match(/DIY/g)).toHaveLength(1);
  await click(copyButton);
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', copy!.id));
  expect(await getPreset(original.id)).toEqual(original);
});

it('applies batch changes only to checked versions and clears selection when leaving batch management', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second]);
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  await click(button('批量管理'));
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(3);
  await click(namedButton(`选择 ${first.title}`));
  expect(button('整理所选')).toBeEnabled();
  expect(document.body.textContent).toContain('已选 1 份');
  await click(button('整理所选'));
  const tag = [...document.querySelectorAll('label')].find(label => label.textContent === '类型/通用')!;
  await click(tag.querySelector('button')!);
  await click(button('保存到所选预设'));
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect((await getPreset(first.id))?.catalog?.tags).toEqual(['类型/通用']);
  expect(await getPreset(second.id)).toEqual(second);
  expect((await getPreset(first.id))?.preset).toEqual(first.preset);
  expect((await getPreset(first.id))?.packageFiles).toEqual(first.packageFiles);

  await click(namedButton(`选择 ${second.title}`));
  expect(document.body.textContent).toContain('已选 1 份');
  await click(button('完成'));
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  await click(button('批量管理'));
  expect(document.body.textContent).toContain('已选 0 份');
  expect(button('整理所选')).toBeDisabled();
  for (const checkbox of document.querySelectorAll('[role="checkbox"]')) expect(checkbox).toHaveAttribute('aria-checked', 'false');
});

it.each(['星海-v1-Claude.json', '星海-Claude-v1.json'])('prefills an explicit preset version and model from %s before importing', async filename => {
  await mount([preset('existing', 'v0')]);
  await click(button('导入预设'));
  const source = JSON.stringify({ prompts: [{ identifier: 'opening', name: '开场', content: '作者原文' }], prompt_order: [] });
  const file = new File([source], filename, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => source });
  await act(async () => {
    const control = document.querySelector<HTMLInputElement>('input[aria-label="选择预设和附带文件"]')!;
    Object.defineProperty(control, 'files', { value: [file], configurable: true });
    control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(() => expect(button('导入 1 份预设')).toBeEnabled());
  expect(document.querySelector<HTMLInputElement>('input[aria-label="版本号"]')?.value).toBe('v1');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="适配模型"]')?.value).toBe('Claude');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="作者"]')?.value).toBe('');
});

it('asks before changing versions with unsaved notes, retains cancelled input, and discards without saving', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second]);
  await click(button('v1'));
  await settle(() => expect(button('整理资料')).toBeEnabled());
  await click(button('整理资料'));
  const notes = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="我的使用笔记"]')!;
  await input(notes, '尚未保存的 v1 体验');
  await click(button('v2'));
  expect(document.querySelector('[role="alertdialog"]')).toBeInTheDocument();
  expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1');
  await click(button('返回继续整理'));
  expect(notes.value).toBe('尚未保存的 v1 体验');
  expect(button('保存资料')).toBeEnabled();
  await click(button('v2'));
  await click(button('放弃修改'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v2'));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('[data-preset-details] input,[data-preset-details] textarea')).toBeNull();
  expect(await getPreset(first.id)).toEqual(first);
  expect(await getPreset(second.id)).toEqual(second);
});

it('follows presetId links within the library and protects an unsaved draft with one discard confirmation', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second]);
  await act(async () => { await router!.navigate('/presets?presetId=v1'); });
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  await click(button('整理资料'));
  await input(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="我的使用笔记"]')!, '应留在当前版本的草稿');
  await act(async () => { await router!.navigate('/presets?presetId=v2'); });
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click(button('返回继续整理'));
  expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1');
  expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="我的使用笔记"]')?.value).toBe('应留在当前版本的草稿');
  expect(new URLSearchParams(router!.state.location.search).get('presetId')).toBe('v1');
  await act(async () => { await router!.navigate('/presets?presetId=v2'); });
  await click(button('放弃修改'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v2'));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector('[data-preset-details] input,[data-preset-details] textarea')).toBeNull();
  expect(await getPreset(first.id)).toEqual(first);
});
