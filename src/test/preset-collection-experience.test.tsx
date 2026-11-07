import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PresetLibrary from '@/pages/PresetLibrary';
import PresetDetail from '@/pages/PresetDetail';
import RegexTool from '@/pages/RegexTool';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { getActiveVault, setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { createPresetDiy, getPreset } from '@/lib/preset-db';
import { scanVaultFiles } from '@/lib/vault/file-maintenance';
import { parsePreset, exportPreset } from '@/lib/preset-parser';
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
async function select(name: string, value: string) {
  await act(async () => {
    const node = document.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
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
  router = createMemoryRouter([{ path: '/presets', element: <PresetLibrary /> }, { path: '/presets/:id', element: <PresetDetail /> }, { path: '/regex', element: <RegexTool /> }], { initialEntries: ['/presets'] });
  await act(async () => root!.render(<TooltipProvider><RouterProvider router={router!} /></TooltipProvider>));
  await settle(() => expect(document.querySelectorAll('[data-preset-series]')).not.toHaveLength(0));
  if (preview) await click(button('预览'));
}

it('automatically migrates flat legacy files on entry without maintenance buttons or rewriting organized versions', async () => {
  const fs = createMemFs(), item = preset('legacy', 'v1');
  await fs.writeText('资产/预设/旧文件.json', JSON.stringify({ ...JSON.parse(exportPreset(item.preset)), __ste: { ...item, preset: undefined } }));
  const vault = createVault(fs); setActiveVault(vault);
  await mount([], false);
  await settle(() => expect(document.querySelector('[data-preset-series]')).not.toBeNull());
  expect(await vault.pathOf('presets', item.id)).toBe('资产/预设/星海叙事/星海叙事-Claude-v1.json.json');
  expect([...document.querySelectorAll('button')].map(button => button.textContent?.trim())).not.toContain('刷新文件');
  expect([...document.querySelectorAll('button')].map(button => button.textContent?.trim())).not.toContain('整理系列文件夹');
  expect(await vault.repo('presets').get(item.id)).toEqual(item);
  const write = vi.spyOn(fs, 'writeText');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await settle(() => expect(document.querySelector('[data-preset-series]')).not.toBeNull());
  expect(write).not.toHaveBeenCalled();
});

it('coalesces migration notifications into one catalog read after moving several legacy files', async () => {
  const fs = createMemFs();
  for (let index = 0; index < 4; index++) {
    const item = preset(`legacy-${index}`, `v${index}`);
    await fs.writeText(`资产/预设/旧文件${index}.json`, JSON.stringify({ ...JSON.parse(exportPreset(item.preset)), __ste: { ...item, preset: undefined } }));
  }
  const vault = createVault(fs); setActiveVault(vault);
  const reads = vi.spyOn(vault.repo('characters'), 'listLight');
  await mount([], false);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(await vault.repo('presets').listLight()).toHaveLength(4);
});

it('opens the series page in normal mode, protects version changes, saves its independent name and returns to the filtered library', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second], false);
  await input(document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')!, '星海');
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  expect(router!.state.location.pathname).toBe('/presets/v1');
  expect(document.querySelector('[aria-label="预设信息"] input[aria-label="名称"]')).not.toBeNull();
  expect(document.querySelector('button[aria-label^="切换预设版本"]')).not.toBeNull();
  await input(document.querySelector<HTMLInputElement>('[aria-label="名称"]')!, '独立名称');
  await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换预设版本"]')!);
  await click(namedButton(`切换版本 v2 ${second.title}`));
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click(button('返回继续整理'));
  expect(document.querySelector<HTMLInputElement>('[aria-label="名称"]')?.value).toBe('独立名称');
  await click(button('保存资料'));
  await settle(() => expect(button('保存资料')).toBeDisabled());
  expect((await getPreset('v1'))?.catalog).toMatchObject({ name: '独立名称', series: '星海叙事' });
  await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换预设版本"]')!);
  await click(namedButton(`切换版本 v2 ${second.title}`));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v2'));
  await click(button('返回预设库'));
  await settle(() => expect(document.querySelector('[data-preset-catalog]')).not.toBeNull());
  expect(document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')?.value).toBe('星海');
  expect(button('预览')).toHaveAttribute('aria-pressed', 'false');
});

it('selects the entire series by clicking the card and preserves untouched per-version fields', async () => {
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
  await input(document.querySelector<HTMLInputElement>('[aria-label="重命名 状态/常用"]')!, '常用新版');
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
  expect(button('v3', single)).toBeEnabled();
  const series = cards.find(card => card.querySelector('h2')?.textContent === '星海叙事')!;
  expect(series.textContent).toContain('2 个版本');

  for (const version of ['v1', 'v2']) {
    await click(button(version, series));
    await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', version));
    const details = document.querySelector('[data-preset-details]')!;
    expect(details.querySelector('input:not([type=file]),textarea,select')).toBeNull();
    await settle(() => expect(details.textContent).toContain('v2 说明'));
    await click(button('内容', details));
    await click(button('+开场', details));
    expect(details.textContent).toContain(`${version} 的完整正文`);
    await click(button('附带文件', details));
    await click(button('+说明 · README.md', details));
    expect(details.textContent).toContain(`${version} 的附件原文`);
    expect(details.querySelector('input:not([type=file]),textarea,select')).toBeNull();
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

it('shares status tags across the series and clears selection when leaving batch management', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second]);
  expect(document.querySelector('[role="checkbox"]')).toBeNull();
  await click(button('批量管理'));
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(3);
  await click(namedButton(`选择 ${first.title}`));
  expect(button('整理所选')).toBeEnabled();
  expect(document.body.textContent).toContain('已选 1 份');
  await click(button('整理所选'));
  const tag = [...document.querySelectorAll('label')].find(label => label.textContent === '状态/在用')!;
  await click(tag.querySelector('button')!);
  await click(button('保存到所选预设'));
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect((await getPreset(first.id))?.catalog?.tags).toEqual(['状态/在用']);
  expect((await getPreset(second.id))?.catalog?.tags).toEqual(['状态/在用']);
  expect((await getPreset(second.id))?.preset).toEqual(second.preset);
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

it('keeps the series title and the matching version visible after filtering, and toggles the preview off on a second click', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  second.catalog!.models = ['Gemini'];
  await mount([first, second]);
  await select('筛选模型', 'Claude');
  const card = document.querySelector('[data-preset-series]')!;
  expect(card.querySelector('h2')?.textContent).toBe('星海叙事');
  expect(card.textContent!.match(/星海叙事/g)).toHaveLength(1);
  expect(button('v1', card)).toBeEnabled();
  expect([...card.querySelectorAll('button')].some(node => node.textContent === 'v2')).toBe(false);
  await click(button('v1', card));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')?.textContent).toContain('v2 说明'));
  await click(button('v1', card));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toBeNull());
  expect(new URLSearchParams(router!.state.location.search).has('presetId')).toBe(false);
});

it.each(['隐藏', '删除'])('clears a tag filter after the selected label is removed from the sidebar by %s', async action => {
  const first = preset('v1', 'v1'), second = preset('other', 'v1', '其他系列');
  first.catalog!.tags = ['状态/在用'];
  await mount([first, second]); await select('筛选标签', '状态/在用');
  expect(document.querySelectorAll('[data-preset-series]')).toHaveLength(1);
  await click(namedButton('管理预设标签'));
  const row = document.querySelector('[aria-label="删除预设标签 状态/在用"]')!.parentElement!;
  await click(button(action, row));
  if (action === '删除') await click(button('确认删除标签'));
  await settle(() => expect(document.querySelector<HTMLSelectElement>('[aria-label="筛选标签"]')?.value).toBe(''));
  await click(button('完成', document.querySelector('[role="dialog"]')!));
  expect(document.querySelector('[aria-label="预设筛选"] button[title="状态/在用"]')).toBeNull();
  expect(document.querySelector('[aria-label="筛选标签"] option[value="状态/在用"]')).toBeNull();
  expect(document.querySelectorAll('[data-preset-series]')).toHaveLength(2);
  if (action === '隐藏') expect((await getPreset(first.id))?.catalog?.tags).toEqual(['状态/在用']);
  else expect((await getPreset(first.id))?.catalog?.tags).toEqual([]);
});

it('groups by series with each matching version separately and restores the grouping after returning from details', async () => {
  await mount([preset('v1', 'v1'), preset('v2', 'v2')]);
  await select('预设分组', 'series');
  const group = document.querySelector('section[aria-label="星海叙事"]')!;
  expect(group.querySelectorAll('[data-preset-series]')).toHaveLength(2);
  expect(button('v1', group)).toBeEnabled(); expect(button('v2', group)).toBeEnabled();
  await click(button('v2', group));
  await settle(() => expect(button('查看详情')).toBeEnabled());
  await click(button('查看详情'));
  await settle(() => expect(router!.state.location.pathname).toBe('/presets/v2'));
  await click(button('返回预设库'));
  await settle(() => expect(document.querySelector<HTMLSelectElement>('[aria-label="预设分组"]')?.value).toBe('series'));
});

it('preprocesses the series name and individual version values without changing preset bodies', async () => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  await mount([first, second]);
  await click(button('批量管理')); await click(namedButton('选择 星海叙事')); await click(button('整理所选'));
  const label = [...document.querySelectorAll('[role="dialog"] label')].find(node => node.textContent === '统一系列')!;
  await click(label.querySelector('button')!);
  await input(document.querySelector<HTMLInputElement>('[aria-label="批量系列"]')!, '重新整理系列');
  await input(document.querySelector<HTMLInputElement>(`[aria-label="版本号 ${first.title}"]`)!, '1.0');
  await input(document.querySelector<HTMLInputElement>(`[aria-label="版本号 ${second.title}"]`)!, '2.1');
  await click(button('保存到所选预设'));
  await settle(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect((await getPreset(first.id))?.catalog).toMatchObject({ series: '重新整理系列', version: '1.0' });
  expect((await getPreset(second.id))?.catalog).toMatchObject({ series: '重新整理系列', version: '2.1' });
  expect((await getPreset(first.id))?.preset).toEqual(first.preset); expect((await getPreset(second.id))?.preset).toEqual(second.preset);
  expect(document.querySelector('[data-preset-series] h2')?.textContent).toBe('重新整理系列');
});

it('edits and previews Markdown notes, preserves the draft when organizing, and persists it when reopening', async () => {
  await mount([preset('v1', 'v1')]); await click(button('v1'));
  await settle(() => expect(button('笔记')).toBeEnabled());
  expect([...document.querySelectorAll('[data-preset-details] [role="tab"]')].map(node => node.textContent)).toEqual(['作者说明', '笔记', '内容', '正则与脚本', '附带文件']);
  await click(button('笔记')); await click(button('编辑笔记'));
  await input(document.querySelector<HTMLTextAreaElement>('[aria-label="预设笔记正文"]')!, '# 用法\n\n先挂载角色。\n\n## 感受\n\n记录测试结果。');
  expect(namedButton('收藏预设')).toBeDisabled();
  await click(button('预览笔记'));
  const heading = document.querySelector<HTMLElement>('[aria-label="预设笔记"] h2')!;
  const scroll = vi.fn(); heading.scrollIntoView = scroll;
  await click(button('感受', document.querySelector('nav[aria-label="笔记目录"]')!));
  expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  await click(button('整理资料'));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="我的使用笔记"]')?.value).toContain('记录测试结果');
  await click(button('保存资料'));
  await settle(() => expect(button('整理资料')).toBeEnabled());
  expect((await getPreset('v1'))?.catalog?.notes).toContain('先挂载角色');
  await click(namedButton('关闭预设资料')); await click(button('v1'));
  await settle(() => expect(button('笔记')).toBeEnabled()); await click(button('笔记'));
  expect(document.querySelector('[aria-label="预设笔记"]')?.textContent).toContain('记录测试结果');
});

it('protects unsaved full-page notes before importing and uses one final deletion confirmation', async () => {
  await mount([preset('v1', 'v1')], false); await click(button('v1'));
  await settle(() => expect(router!.state.location.pathname).toBe('/presets/v1'));
  await click(button('笔记')); await click(button('编辑笔记'));
  await input(document.querySelector<HTMLTextAreaElement>('[aria-label="预设笔记正文"]')!, '保留当前草稿');
  await click(button('导入同系列'));
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click(button('返回继续整理'));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="预设笔记正文"]')?.value).toBe('保留当前草稿');
  await click(namedButton('删除预设'));
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('尚未保存的笔记');
  await settle(() => expect(button('确认删除')).toBeEnabled()); await click(button('确认删除'));
  await settle(() => expect(router!.state.location.pathname).toBe('/presets'));
  expect(await getPreset('v1')).toBeUndefined();
});

it('opens temporary trial from a separate action and keeps its draft while returning to the three detail tabs', async () => {
  await mount([preset('v1', 'v1')], false); await click(button('v1'));
  await settle(() => expect(button('临时试用')).toBeEnabled());
  expect([...document.querySelectorAll('[data-preset-details] [role="tab"]')].map(node => node.textContent)).toEqual(['作者说明', '笔记', '内容', '正则与脚本', '附带文件']);
  await click(button('临时试用'));
  await settle(() => expect(document.querySelector<HTMLTextAreaElement>('[aria-label="试用消息"]')).not.toBeNull());
  await input(document.querySelector<HTMLTextAreaElement>('[aria-label="试用消息"]')!, '保留试用草稿');
  await click(button('返回预设资料')); await click(button('临时试用'));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="试用消息"]')?.value).toBe('保留试用草稿');
  await click(button('返回预设资料'));
  expect(document.querySelector('[role="tablist"]')?.closest('.hidden')).toBeNull();
});

it.each([{ bulk: false, deleteFiles: false }, { bulk: false, deleteFiles: true }, { bulk: true, deleteFiles: false }, { bulk: true, deleteFiles: true }])('deletes versions through retention (batch: $bulk, recycle after 30 days: $deleteFiles)', async ({ bulk, deleteFiles }) => {
  await mount([preset('v1', 'v1'), preset('v2', 'v2')]);
  if (bulk) { await click(button('批量管理')); await click(namedButton('选择 星海叙事')); await click(button('删除所选')); }
  else { await click(button('v1')); await settle(() => expect(namedButton('删除预设')).toBeEnabled()); await click(namedButton('删除预设')); }
  await settle(() => expect(button('确认删除')).toBeEnabled());
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain('同时删除 STE 库内文件');
  if (deleteFiles) await click(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  await click(button('确认删除'));
  await settle(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
  expect(await getPreset('v1')).toBeUndefined();
  if (bulk) expect(await getPreset('v2')).toBeUndefined(); else expect(await getPreset('v2')).toBeDefined();
  const retained = (await scanVaultFiles(getActiveVault()!)).entries.filter(entry => entry.category === 'retained');
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.every(entry => deleteFiles ? typeof entry.recycleAfter === 'number' : entry.recycleAfter === undefined)).toBe(true);
});


it.each(['embedded', 'attachment'] as const)('edits model variants directly and opens %s regex after a guarded version switch', async source => {
  const first = preset('v1', 'v1'), second = preset('v2', 'v2');
  first.packageFiles!.push({ id: 'regex-file', name: '关联正则.json', kind: 'regex', text: JSON.stringify([{ id: 'attachment', scriptName: '附件清理规则', findRegex: 'hello', replaceString: 'world', placement: [2] }]) });
  first.preset.regexRules = [{ id: 'cleanup', name: '关联清理规则', findRegex: 'hello', replaceString: 'world', placement: ['all'], disabled: false }];
  Object.defineProperty(File.prototype, 'text', { configurable: true, value: function () { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(this); }); } });
  await mount([first, second], false);
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  const info = document.querySelector('[aria-label="预设信息"]')!;
  await click(namedButton('移除适配型号 Claude'));
  await input(info.querySelector<HTMLInputElement>('[aria-label="适配模型"]')!, 'gemini3.1，gemini3.8');
  expect(info.querySelector<HTMLInputElement>('[aria-label="适配模型"]')!.value).toBe('gemini3.1，gemini3.8');
  await click(button('保存资料'));
  await settle(() => expect(button('保存资料')).toBeDisabled());
  expect((await getPreset('v1'))?.catalog?.models).toEqual(['gemini3.1', 'gemini3.8']);
  await input(info.querySelector<HTMLInputElement>('[aria-label="名称"]')!, '临时草稿');
  await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换预设版本"]')!);
  await click(namedButton(`切换版本 v2 ${second.title}`));
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click(button('放弃修改'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v2'));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换预设版本"]')!);
  await click(namedButton(`切换版本 v1 ${first.title}`));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  await click(button('内容'));
  await click(button(source === 'attachment' ? '附带文件' : '正则与脚本'));
  await click(button(source === 'embedded' ? '读取到正则库并管理' : '打开正则 · 关联正则.json'));
  await settle(() => expect(router!.state.location.pathname).toBe('/regex'));
  await settle(() => expect(document.body.textContent).toContain(source === 'embedded' ? '关联清理规则' : '附件清理规则'));
});


it.each([false, true])('refreshes an externally deleted preset when returning to the window; preview=%s', async preview => {
  await mount([preset('v1', 'v1')], preview);
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  const vault = getActiveVault()!;
  await vault.fs.removeFile((await vault.pathOf('presets', 'v1'))!);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toBeNull());
  expect(await getPreset('v1')).toBeUndefined();
  if (!preview) expect(document.body.textContent).toContain('预设文件已不存在');
});


it('retains a dirty preview draft after the underlying preset is deleted outside the app', async () => {
  await mount([preset('v1', 'v1')]);
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details', 'v1'));
  await click(button('整理资料'));
  const notes = document.querySelector<HTMLTextAreaElement>('[aria-label="我的使用笔记"]')!;
  await input(notes, '外部文件删除后仍可复制的草稿');
  const vault=getActiveVault()!;
  await vault.fs.removeFile((await vault.pathOf('presets','v1'))!);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle(() => expect(document.querySelector<HTMLTextAreaElement>('[aria-label="我的使用笔记"]')?.value).toBe('外部文件删除后仍可复制的草稿'));
  await click(button('保存资料'));
  await settle(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('预设已不存在'));
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="我的使用笔记"]')?.value).toBe('外部文件删除后仍可复制的草稿');
});


it('uses a noninteractive single version label and keeps author editing and attachments in their own tabs', async () => {
  await mount([preset('single','v1')], false);
  await click(button('v1'));
  await settle(() => expect(document.querySelector('[data-preset-details]')).toHaveAttribute('data-preset-details','single'));
  expect(document.querySelector('button[aria-label^="切换预设版本"]')).toBeNull();
  expect(document.querySelector('[aria-label="当前版本"]')?.textContent).toBe('v1');
  expect(document.querySelector('[aria-label="预设信息"] textarea')).toBeNull();
  expect([...document.querySelectorAll('[data-preset-details] [role="tab"]')].map(node=>node.textContent)).toEqual(['作者说明','笔记','内容','正则与脚本','附带文件']);
  expect(document.querySelector('[aria-label="预设附带文件"]')).toBeNull();
  await click(button('编辑说明'));
  await input(document.querySelector<HTMLTextAreaElement>('[aria-label="作者发布说明"]')!,`# 作者说明

可以在主内容区宽松编辑。`);
  expect((await getPreset('single'))?.catalog?.releaseNotes).not.toContain('宽松编辑');
  await click(button('保存资料'));
  await settle(()=>expect(button('保存资料')).toBeDisabled());
  expect((await getPreset('single'))?.catalog?.releaseNotes).toContain('宽松编辑');
  await click(button('附带文件'));
  expect(document.querySelector('[aria-label="预设附带文件"]')?.textContent).toContain('README.md');
  await click(button('笔记'));
  expect(document.querySelector('[aria-label="预设附带文件"]')).toBeNull();
  expect(document.querySelector('[aria-label="预设笔记"]')).not.toBeNull();
});

it('shows version dates, caps model badges and offers a seeded new version import', async () => {
  const first=preset('v1','v1'), second=preset('v2','v2');
  first.catalog!.models=['Claude','Gemini','DeepSeek','fourth-model'];
  await mount([first,second],false);
  await click(button('v1'));
  await settle(()=>expect(document.querySelector('button[aria-label^="切换预设版本"]')).not.toBeNull());
  await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换预设版本"]')!);
  const menu=document.querySelector('[aria-label="同系列版本"]')!;
  expect(menu.textContent).toContain(new Date(first.createdAt).toLocaleDateString('zh-CN'));
  expect(menu.textContent).not.toContain('fourth-model');
  expect(menu.querySelector('[aria-current="page"]')).toBeDisabled();
  await click(button('新建版本', menu));
  await settle(()=>expect(document.querySelector('input[aria-label="选择预设和附带文件"]')).not.toBeNull());
  const uploaded=new File([JSON.stringify({prompts:[],prompt_order:[]})], '星海-v3.json');
  Object.defineProperty(uploaded,'text',{value:async()=>JSON.stringify({prompts:[],prompt_order:[]})});
  await act(async()=>{ const control=document.querySelector<HTMLInputElement>('input[aria-label="选择预设和附带文件"]')!; Object.defineProperty(control,'files',{value:[uploaded],configurable:true}); control.dispatchEvent(new Event('change',{bubbles:true})); });
  await settle(()=>expect(document.querySelector('[role="dialog"] input[aria-label="系列"]')).not.toBeNull());
  expect(document.querySelector<HTMLInputElement>('[role="dialog"] input[aria-label="系列"]')?.value).toBe('星海叙事');
  expect(document.querySelector('[aria-label="同系列版本"]')).toBeNull();
});


it('previews the current older version author draft before saving while ordinary reading starts with the latest notes', async () => {
  const first=preset('v1','v1'), second=preset('v2','v2');
  await mount([first,second],false);
  await click(button('v1'));
  await settle(()=>expect(document.querySelector('[data-preset-details]')?.textContent).toContain('v2 说明'));
  await click(button('编辑说明'));
  await input(document.querySelector<HTMLTextAreaElement>('[aria-label="作者发布说明"]')!, '# v1 当前草稿：新的安装说明');
  await click(button('预览说明'));
  expect(document.querySelector('[data-preset-details]')?.textContent).toContain('v1 当前草稿：新的安装说明');
  expect(document.querySelector('[data-preset-details]')?.textContent).not.toContain('v2 说明');
  expect((await getPreset('v1'))?.catalog?.releaseNotes).toBe(first.catalog!.releaseNotes);
  await click(button('保存资料'));
  await settle(()=>expect(button('保存资料')).toBeDisabled());
  expect(document.querySelector('[data-preset-details]')?.textContent).toContain('v1 当前草稿：新的安装说明');
  expect((await getPreset('v1'))?.catalog?.releaseNotes).toContain('v1 当前草稿');
  expect((await getPreset('v2'))?.catalog?.releaseNotes).toBe(second.catalog!.releaseNotes);
  await click(button('查看最新说明'));
  await settle(()=>expect(document.querySelector('[data-preset-details]')?.textContent).toContain('v2 说明'));
});
