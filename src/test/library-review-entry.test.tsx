import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';

const getAllCharacters = vi.hoisted(() => vi.fn());
const listStoryIndex = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const flushPendingSave = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }), toast }));
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/lib/archive-db', () => ({
  CHARACTER_TYPES: ['人物', '剧情', '玩法', '综合', '同人'], getAllCharacters,
  getLibraryTagPreferences: vi.fn(async () => {
    const { normalizeLibraryTagPreferences } = await import('@/lib/library-tag-preferences');
    return normalizeLibraryTagPreferences(undefined);
  }),
  saveLibraryTagPreferences: vi.fn(), updateArchiveStory: vi.fn(), deleteCharacter: vi.fn(), saveCharacter: vi.fn(),
}));
vi.mock('@/lib/archive-index', () => ({ listStoryIndex }));
vi.mock('@/components/library/review/LibraryReviewView', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const LibraryReviewView = forwardRef<{ flushPendingSave: () => Promise<void> }, { characters: ArchiveCharacter[]; storyIndex: { id: string }[] }>((props, ref) => {
    useImperativeHandle(ref, () => ({ flushPendingSave }));
    return <section aria-label="回顾内容"><span>{props.characters.map((c) => c.name).join(',')}</span><span>索引 {props.storyIndex.length}</span></section>;
  });
  LibraryReviewView.displayName = 'ReviewStub';
  return { LibraryReviewView };
});
import Library from '@/pages/Library';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView = () => {};
let root: Root;
let container: HTMLDivElement;
const characters: ArchiveCharacter[] = Array.from({ length: 30 }, (_, i) => ({
  id: `c${i}`, name: `角色${i}`, card: { name: `角色${i}`, description: '' }, tags: ['人物/测试'],
  status: '未开始', createdAt: i, updatedAt: i,
}));
beforeEach(() => {
  localStorage.clear();
  flushPendingSave.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  setCurrentVaultId(crypto.randomUUID());
  getAllCharacters.mockResolvedValue(characters);
  listStoryIndex.mockResolvedValue([{ id: 'story', characterId: 'c1' }]);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setCurrentVaultId(null); });
async function render() {
  await act(async () => { root.render(<MemoryRouter><Library /></MemoryRouter>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
function button(label: string) { return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label); }
async function search(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="搜索角色或标签"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('恢复回顾偏好，传入完整筛选结果而非卡墙的一页', async () => {
  localStorage.setItem('ste-library-view', 'review'); await render();
  const review = container.querySelector('[aria-label="回顾内容"]');
  expect(review).not.toBeNull();
  expect(review!.textContent).toContain('角色0');
  expect(review!.textContent).toContain('角色29');
  expect(review!.textContent).toContain('索引 1');
  expect(button('批量管理')).toBeUndefined();
});
it('从网格一键进入回顾，并支持原有搜索筛选', async () => {
  await render(); expect(button('回顾')).toBeDefined();
  await act(async () => { button('回顾')!.click(); });
  await search('角色29');
  expect(container.querySelector('[aria-label="回顾内容"]')!.textContent).toBe('角色29索引 1');
  expect(localStorage.getItem('ste-library-view')).toBe('review');
});
it('从其他页面回来恢复回顾搜索，换库不继承旧搜索', async () => {
  localStorage.setItem('ste-library-view', 'review'); await render(); await search('角色29');
  await act(async () => { root.render(<div>编辑器</div>); }); await render();
  expect(container.querySelector<HTMLInputElement>('input[placeholder="搜索角色或标签"]')!.value).toBe('角色29');
  await act(async () => { root.render(<div>切库</div>); }); setCurrentVaultId('other-vault'); await render();
  expect(container.querySelector<HTMLInputElement>('input[placeholder="搜索角色或标签"]')!.value).toBe('');
});
it('退出回顾前等待保存，失败时保留原视图以便重试', async () => {
  localStorage.setItem('ste-library-view', 'review'); await render();
  flushPendingSave.mockRejectedValueOnce(new Error('磁盘已满'));
  await act(async () => { button('回顾')!.click(); });
  expect(container.querySelector('[aria-label="回顾内容"]')).not.toBeNull();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '暂时无法离开回顾', description: '磁盘已满' }));
  await act(async () => { button('回顾')!.click(); });
  expect(container.querySelector('[aria-label="回顾内容"]')).toBeNull();
  expect(localStorage.getItem('ste-library-view')).toBe('grid');
});
