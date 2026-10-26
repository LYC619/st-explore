import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QuickModelSwitcher } from '@/components/ai-tools/QuickModelSwitcher';
import { ApiStatusLine } from '@/components/ai-tools/ApiStatusLine';
import { APIConfigCard } from '@/components/ai-tools/APIConfigCard';
import { activateApiModel, getActiveProfile, getAPIConfigForSelection, loadApiProfiles, persistProfiles, type ApiModelSelection } from '@/components/ai-tools/api-profiles';
import { callOpenAIMessages } from '@/components/ai-tools/useOpenAI';

vi.mock('@/lib/vault/tauri-fs', () => ({ isTauri: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const a = { id: 'a', name: '服务甲', apiKey: 'fixture-key-a', apiUrl: 'https://a.example/v1/chat/completions', model: 'alpha', modelList: ['alpha', 'beta'], favoriteModels: ['alpha'] };
const b = { id: 'b', name: '服务乙', apiKey: 'fixture-key-b', apiUrl: 'https://b.example/v1/chat/completions', model: 'gamma', modelList: ['gamma', 'delta'] };
beforeEach(() => {
  localStorage.clear(); persistProfiles([a, b], 'a');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected network call'))));
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks();
});
async function render(node: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter>{node}</MemoryRouter>));
}
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label); }
async function click(element: HTMLElement | undefined | null) { expect(element).toBeTruthy(); await act(async () => element!.click()); }
async function input(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ?? document.querySelector<HTMLInputElement>(label === '模型名称' ? '#api-model-name' : 'missing');
  expect(field).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field!.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function openSwitcher() { await click(document.querySelector<HTMLButtonElement>('button[aria-label^="切换模型"]')); }

it('groups saved models by service, searches fetched names and switches globally without exposing credentials or making requests', async () => {
  await render(<><QuickModelSwitcher /><ApiStatusLine /></>);
  await openSwitcher();
  expect(document.querySelector('section[aria-label="服务甲"]')).not.toBeNull();
  expect(document.querySelector('section[aria-label="服务乙"]')).not.toBeNull();
  expect(button('使用 服务乙 的 delta')).toBeUndefined();
  await input('搜索服务或模型', 'delta');
  await click(button('使用 服务乙 的 delta'));
  expect(getActiveProfile()).toMatchObject({ id: 'b', model: 'delta' });
  const triggers = [...document.querySelectorAll('button[aria-label^="切换模型"]')];
  expect(triggers).toHaveLength(2);
  expect(triggers.every(element => element.textContent?.includes('服务乙 · delta'))).toBe(true);
  expect(document.body.textContent).not.toContain(a.apiKey);
  expect(document.body.textContent).not.toContain(b.apiKey);
  expect(fetch).not.toHaveBeenCalled();
});

it('controlled selection stays in its workspace and custom models remain available as favorites', async () => {
  function Local() { const [value, setValue] = useState<ApiModelSelection>({ profileId: 'a', model: 'alpha' }); return <QuickModelSwitcher value={value} onChange={setValue} />; }
  await render(<Local />);
  await openSwitcher(); await click(button('使用 服务乙 的 gamma'));
  expect(getActiveProfile().id).toBe('a');
  await openSwitcher(); await click(button('自定义模型')); await input('自定义模型名称', 'custom-beta'); await click(button('加入常用并使用'));
  expect(document.querySelector('button[aria-label^="切换模型"]')?.textContent).toContain('服务乙 · custom-beta');
  expect(loadApiProfiles().profiles.find(profile => profile.id === 'b')?.favoriteModels).toContain('custom-beta');
  expect(getActiveProfile()).toMatchObject({ id: 'a', model: 'alpha' });
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps the running request on its original profile/model while quick switching for the next request', async () => {
  let finish!: (response: Response) => void;
  const network = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', network);
  const snapshot = getAPIConfigForSelection({ profileId: 'a', model: 'alpha' })!;
  const request = callOpenAIMessages(snapshot, [{ role: 'user', content: 'fixture' }]);
  await render(<QuickModelSwitcher busy />);
  await openSwitcher(); expect(document.body.textContent).toContain('切换用于下一次请求');
  await click(button('使用 服务乙 的 gamma'));
  finish(new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 }));
  expect(await request).toBe('done');
  expect(network).toHaveBeenCalledTimes(1);
  expect(network.mock.calls[0][0]).toBe(a.apiUrl);
  expect(JSON.parse(network.mock.calls[0][1]!.body as string).model).toBe('alpha');
  expect(getActiveProfile().model).toBe('gamma');
});

async function selectService(name: string) {
  const trigger = button('选择提供商')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === name);
  expect(option).toBeTruthy();
  await act(async () => option!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}

it('fetches an entire service catalogue, saves favorites and custom models, and protects unsaved service switching', async () => {
  const network = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ id: 'fresh-one' }, { id: 'fresh-two' }] }), { status: 200 })); vi.stubGlobal('fetch', network);
  await render(<APIConfigCard />);
  expect(document.querySelector('input[aria-label="API Key"]')).toHaveAttribute('type', 'password');
  await click(button('获取模型'));
  expect(button('选择模型 fresh-one')).toBeTruthy(); expect(button('选择模型 fresh-two')).toBeTruthy();
  expect(network.mock.calls[0][0]).toBe('https://a.example/v1/models');
  await click(button('收藏模型 fresh-two'));
  await input('模型名称', 'custom-local'); await click(button('当前模型加入常用'));
  await input('提供商名称', '甲的新名称');
  await selectService('服务乙');
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('服务配置还未保存');
  expect(getActiveProfile().id).toBe('a');
  await click(button('继续编辑'));
  expect(document.querySelector('input[aria-label="提供商名称"]')).toHaveValue('甲的新名称');
  await selectService('服务乙'); await click(button('保存并切换'));
  expect(getActiveProfile().id).toBe('b');
  expect(loadApiProfiles().profiles[0]).toMatchObject({ name: '甲的新名称', model: 'custom-local', favoriteModels: ['alpha', 'fresh-two', 'custom-local'] });
  await selectService('甲的新名称');
  expect(document.querySelector('#api-model-name')).toHaveValue('custom-local');
  expect(document.querySelector('[aria-label="常用模型"]')?.textContent).toContain('fresh-two');
});

it('a late model response cannot overwrite a different service after switching', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  await render(<APIConfigCard />); await click(button('获取模型')); await selectService('服务乙');
  await act(async () => finish(new Response(JSON.stringify({ data: [{ id: 'late-alpha' }] }), { status: 200 })));
  expect(getActiveProfile()).toMatchObject({ id: 'b', modelList: ['gamma', 'delta'] });
  expect(document.querySelector('#api-model-name')).toHaveValue('gamma');
  expect(document.body.textContent).not.toContain('late-alpha');
});

it('an externally switched profile does not make a dirty form save into or delete the other service', async () => {
  await render(<APIConfigCard />); await input('提供商名称', '甲的草稿');
  await act(async () => activateApiModel({ profileId: 'b', model: 'delta' }));
  expect(document.body.textContent).toContain('这里保留的是「甲的草稿」的草稿');
  await click(button('保存配置'));
  expect(getActiveProfile()).toMatchObject({ id: 'b', name: '服务乙' });
  expect(loadApiProfiles().profiles[0].name).toBe('甲的草稿');
});
