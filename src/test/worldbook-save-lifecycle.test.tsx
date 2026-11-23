import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_ENTRY, type WorldBookItem } from '@/types/worldbook';
const mocks = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), get: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/GuidedTour', () => ({ GuidedTour: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/worldbook-db', () => ({ saveWorldBook: mocks.save, getAllWorldBooks: mocks.list, getWorldBook: mocks.get, deleteWorldBook: vi.fn() }));
import WorldBookPage from '@/pages/WorldBook';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.hasPointerCapture = () => false;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};
Element.prototype.scrollIntoView = () => {};
let root: Root, container: HTMLDivElement, stored: WorldBookItem;
beforeEach(async () => {
  sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks();
  stored = { id: 'synthetic-wb', title: 'Synthetic original', worldbook: { entries: { '1': { ...DEFAULT_ENTRY, uid: 1, comment: 'Synthetic entry', content: 'Synthetic text' } } }, createdAt: 1, updatedAt: 1 };
  mocks.list.mockImplementation(async () => [structuredClone(stored)]);
  mocks.get.mockImplementation(async () => structuredClone(stored));
  mocks.save.mockImplementation(async (item) => { stored = structuredClone(item); });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/worldbook?assetId=synthetic-wb']}><WorldBookPage /></MemoryRouter>); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function enterName(name: string) {
  const input = container.querySelector('input[aria-label="世界书名称"]') as HTMLInputElement;
  await act(async () => { input.focus(); });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
it('Escape after entering a replacement title should cancel the rename', async () => {
  const input = await enterName('Synthetic replacement');
  await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(stored.title).toBe('Synthetic original');
});
it('renaming during an in-flight save should persist the acknowledged title', async () => {
  let release!: () => void;
  mocks.save.mockImplementationOnce(async (item) => { await new Promise<void>(resolve => { release = resolve; }); stored = structuredClone(item); });
  const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '保存')!;
  await act(async () => { saveButton.click(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const input = await enterName('Synthetic replacement');
  await act(async () => { input.blur(); });
  expect(mocks.toast.mock.calls.some(([value]) => value.title === '世界书已重命名')).toBe(false);
  await act(async () => { release(); });
  expect(mocks.toast.mock.calls.some(([value]) => value.title === '世界书已重命名')).toBe(true);
  expect(stored.title).toBe('Synthetic replacement');
});
it('a failed blank-worldbook create can be retried with Save', async () => {
  const originalId = stored.id;
  mocks.get.mockImplementation(async (id: string) => id === originalId ? structuredClone(stored) : undefined);
  mocks.save.mockRejectedValueOnce(new Error('Synthetic temporary write failure'));
  const createButton = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '新建空白')!;
  await act(async () => { createButton.click(); });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.toast.mock.calls.some(([value]) => value.title === '保存世界书失败')).toBe(true);
  expect(mocks.toast.mock.calls.some(([value]) => value.title.startsWith('已创建'))).toBe(false);
  const saveButton = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '保存')!;
  await act(async () => { saveButton.click(); });
  expect(mocks.save).toHaveBeenCalledTimes(2);
});

it('a failed file import remains dirty and saves the imported draft on retry', async () => {
  const originalId = stored.id;
  mocks.get.mockImplementation(async (id: string) => id === originalId ? structuredClone(stored) : undefined);
  mocks.save.mockRejectedValueOnce(new Error('Synthetic temporary write failure'));
  const file = { name: 'Synthetic import.json', lastModified: 1234,
    text: async () => JSON.stringify({ entries: { '3': { ...DEFAULT_ENTRY, uid: 3, content: 'Synthetic imported content' } } }) };
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === '替换当前')!.click());
  const beforeUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(beforeUnload);
  expect(beforeUnload.defaultPrevented).toBe(true);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '保存')!.click());
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(stored.title).toBe('Synthetic import');
  expect(stored.sourceModifiedAt).toBe(1234);
  expect(stored.worldbook.entries['3'].content).toBe('Synthetic imported content');
});

it('failed rename retains its title and remains retryable', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Synthetic temporary write failure'));
  const input = await enterName('Synthetic retry title');
  await act(async () => input.blur());
  expect(input.value).toBe('Synthetic retry title');
  expect(stored.title).toBe('Synthetic original');
  expect(mocks.toast.mock.calls.some(([value]) => value.title === '世界书已重命名')).toBe(false);
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '保存')!.click());
  expect(stored.title).toBe('Synthetic retry title');
});
