import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PresetTagManager } from '@/components/preset/PresetTagManager';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { listAssetIndex } from '@/lib/asset-index';
import { getPreset } from '@/lib/preset-db';
import { loadPresetTags } from '@/lib/preset-tags';
import { parsePreset } from '@/lib/preset-parser';
import type { PresetItem } from '@/types/preset';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
async function click(node: HTMLElement) {
  expect(node).toBeTruthy();
  await act(async () => { node.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function renderManager(key = 'first') {
  const preferences = await loadPresetTags();
  const items = await listAssetIndex('presets');
  await act(async () => { root.render(<PresetTagManager key={key} preferences={preferences} items={items} onClose={() => undefined} onChanged={() => undefined} />); });
}
beforeEach(() => {
  setActiveVault(createVault(createMemFs()));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setActiveVault(null); });

it('deletes a default status through the real dialog, updates legacy presets and keeps stale item props from reviving it', async () => {
  await getCurrentRepo<PresetItem>('presets').put({ id: 'preset', title: '旧预设', createdAt: 1, updatedAt: 1,
    preset: parsePreset({ prompts: [], prompt_order: [] }), catalog: { status: 'active', notes: '原笔记' } });
  await renderManager();
  expect(button('类型')).toBeUndefined(); expect(button('风格')).toBeUndefined();
  await click(document.body.querySelector<HTMLButtonElement>('[aria-label="删除预设标签 状态/在用"]')!);
  expect((await getPreset('preset'))?.catalog?.status).toBe('active');
  await click(button('确认删除标签'));
  expect(document.body.querySelector('[aria-label="删除预设标签 状态/在用"]')).toBeNull();
  expect((await getPreset('preset'))?.catalog).toMatchObject({ status: 'unreviewed', notes: '原笔记', tags: [] });
  expect((await loadPresetTags()).deleted).toContain('状态/在用');
  await renderManager('reopened');
  expect(document.body.querySelector('[aria-label="删除预设标签 状态/在用"]')).toBeNull();

  const input = document.body.querySelector<HTMLInputElement>('[aria-label="新建预设标签"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '在用');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('添加标签'));
  expect(document.body.querySelector('[aria-label="删除预设标签 状态/在用"]')).not.toBeNull();
  expect((await loadPresetTags()).deleted).not.toContain('状态/在用');
});

it('deletes a default first-level group and all its children immediately and after reopening', async () => {
  await getCurrentRepo<PresetItem>('presets').put({ id: 'preset', title: '有评价', createdAt: 1, updatedAt: 1,
    preset: parsePreset({ prompts: [], prompt_order: [] }), catalog: { tags: ['评价/优秀', '状态/备用'] } });
  await renderManager();
  await click(button('评价')); await click(button('删除一级标签')); await click(button('确认删除标签'));
  expect(button('评价')).toBeUndefined();
  expect(document.body.querySelector('[aria-label="删除预设标签 评价/优秀"]')).toBeNull();
  expect((await getPreset('preset'))?.catalog?.tags).toEqual(['状态/备用']);
  await renderManager('reopened');
  expect(button('评价')).toBeUndefined();
  const saved = await loadPresetTags();
  expect(saved.deletedCategories).toContain('评价');
  expect(saved.tags).not.toContain('评价/优秀');
});
