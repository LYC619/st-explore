import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import * as archiveDb from '@/lib/archive-db';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { TooltipProvider } from '@/components/ui/tooltip';
import Tools from '@/pages/Tools';
import RegexTool from '@/pages/RegexTool';

vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '';
  setActiveVault(null);
  vi.restoreAllMocks();
});

async function mount(kind: 'tools' | 'regex') {
  const vault = createVault(createMemFs());
  setActiveVault(vault);
  const story = archiveDb.buildStoryFromSession({ id: 'session', title: '摘要故事', character: { name: '角色' }, user: { name: '用户' }, createdAt: 1,
    messages: [{ id: 'm1', role: 'user', content: '选中正文', timestamp: new Date(2020, 0, 2).getTime() }, { id: 'm2', role: 'assistant', content: '后续正文', timestamp: new Date(2020, 0, 4).getTime() }] });
  await archiveDb.saveArchiveStory(story);
  const all = vi.spyOn(archiveDb, 'getAllArchiveStories');
  const get = vi.spyOn(archiveDb, 'getArchiveStory');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter initialEntries={[kind === 'tools' ? '/tools?focus=summary' : '/regex']}><TooltipProvider>{kind === 'tools' ? <Tools /> : <RegexTool />}</TooltipProvider></MemoryRouter>));
  expect(all).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  return { story, get };
}

it('总结选择入口通过摘要显示楼数及真实游玩日期，无完整故事读取', async () => {
  await mount('tools');
  expect(document.body.textContent).toContain('摘要故事');
  expect(document.body.textContent).toContain('2 楼');
  expect(document.body.textContent).toContain(new Date(2020, 0, 2).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }));
  expect(document.body.textContent).toContain(new Date(2020, 0, 4).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }));
});

it('正则工具仅在点击取楼时读取选中的正文，并保留用户角色与深度', async () => {
  const { story, get } = await mount('regex');
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('[role="combobox"]')].find(node => node.textContent?.includes('从故事取样'))!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('摘要故事'))!;
  expect(option.textContent).toContain('2 楼');
  await act(async () => option.click());
  expect(get).not.toHaveBeenCalled();
  const floor = document.querySelector<HTMLInputElement>('input[placeholder="楼层号"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(floor, '1'); floor.dispatchEvent(new Event('input', { bubbles: true })); });
  const take = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '取该楼')!;
  await act(async () => take.click());
  expect(get).toHaveBeenCalledExactlyOnceWith(story.id);
  expect([...document.querySelectorAll('textarea')].some(node => node.value === '选中正文')).toBe(true);
  expect(document.body.textContent).toContain('按用户楼预览');
});

it.each(['manual', 'vault'] as const)('正则取样等待期间发生 %s 变更后，旧正文不覆盖当前样例', async change => {
  const { get, story } = await mount('regex');
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('[role="combobox"]')].find(node => node.textContent?.includes('从故事取样'))!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('摘要故事'))!;
  await act(async () => option.click());
  const floor = document.querySelector<HTMLInputElement>('input[placeholder="楼层号"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(floor, '1'); floor.dispatchEvent(new Event('input', { bubbles: true })); });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const selectedStory = await get(story.id);
  expect(selectedStory?.session.messages[0].content).toBe('选中正文');
  get.mockImplementationOnce(async () => { await delayed; return selectedStory; });
  const take = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === '取该楼')!;
  await act(async () => take.click());
  expect(get).toHaveBeenCalledTimes(2);
  const sample = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="在这里粘贴"]')!;
  if (change === 'manual') {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(sample, '手动新样例'); sample.dispatchEvent(new Event('input', { bubbles: true })); });
  } else {
    await act(async () => setActiveVault(createVault(createMemFs())));
  }
  const expected = sample.value;
  await act(async () => release());
  expect(sample.value).toBe(expected);
});
