import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Library from '@/pages/Library';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCharacter, getLibraryTagPreferences, saveCharacter, saveLibraryTagPreferences } from '@/lib/archive-db';
import { normalizeLibraryTagPreferences } from '@/lib/library-tag-preferences';
import type { ArchiveCharacter } from '@/types/archive';

vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast, useToast: () => ({ toast }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
let container: HTMLDivElement, root: Root;
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text)!;
const labelButton = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const visibleIds = () => [...document.querySelectorAll('[data-character-id]')].map(node => node.getAttribute('data-character-id')).sort();
async function click(node: HTMLElement) {
  expect(node).toBeTruthy();
  await act(async () => { node.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
}
const character = (id: string, extra: Partial<ArchiveCharacter>): ArchiveCharacter => ({
  id, name: id, tags: [], createdAt: 1, updatedAt: 1, status: '未开始',
  card: { name: id, description: '' }, ...extra,
} as ArchiveCharacter);
async function renderLibrary() {
  await act(async () => {
    root.render(<MemoryRouter><Library /></MemoryRouter>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
beforeEach(async () => {
  localStorage.clear(); setActiveVault(createVault(createMemFs()));
  await saveLibraryTagPreferences({ ...normalizeLibraryTagPreferences(undefined), hidden: [] });
  await saveCharacter(character('人物卡', { type: '人物', tags: ['人物/少女', '评价/精品'], rating: 8 }));
  await saveCharacter(character('剧情卡', { type: '剧情', tags: ['剧情/悬疑'] }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setActiveVault(null); });

it('clears a selected type filter when its default second-level tag is deleted through the actual manager', async () => {
  await renderLibrary();
  await click(document.querySelector<HTMLButtonElement>('[data-library-type-panel] button[title="人物"]')!);
  expect(visibleIds()).toEqual(['人物卡']);
  await click(labelButton('标签管理')); await click(button('类型互斥'));
  await click(labelButton('删除标签 类型/人物')); await click(button('确认删除'));
  expect(visibleIds()).toEqual(['人物卡', '剧情卡']);
  expect(document.querySelector('[data-library-type-panel] button[title="人物"]')).toBeNull();
  expect(labelButton('选择类型 人物')).toBeNull();
  expect((await getCharacter('人物卡'))?.type).toBeUndefined();
  expect((await getLibraryTagPreferences()).deleted).toContain('类型/人物');
});

it('deletes a first-level rating group and clears its selected filter while preserving numeric scores and source card tags', async () => {
  await renderLibrary();
  await click(document.querySelector<HTMLButtonElement>('[data-library-filter-rail] button[title="精品"]')!);
  expect(visibleIds()).toEqual(['人物卡']);
  await click(labelButton('标签管理'));
  const ratingCategory = document.querySelector<HTMLButtonElement>('[data-tag-category-row="评价"] button')!;
  await click(ratingCategory); await click(button('删除一级标签')); await click(button('确认删除'));
  expect(visibleIds()).toEqual(['人物卡', '剧情卡']);
  expect(document.querySelector('[data-library-filter-rail] button[title="精品"]')).toBeNull();
  const saved = await getCharacter('人物卡');
  expect(saved?.rating).toBe(8); expect(saved?.tags).toContain('人物/少女');
  expect(saved?.card).toEqual({ name: '人物卡', description: '' });
  expect((await getLibraryTagPreferences()).deletedCategories).toContain('评价');
});
