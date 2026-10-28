import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { PresetPackageImport } from '@/components/preset/PresetPackageImport';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { parsePreset } from '@/lib/preset-parser';
import { getAllPresets, getPreset } from '@/lib/preset-db';
import type { PresetCatalog, PresetItem } from '@/types/preset';
import { createRoleplayAssets } from '@/lib/roleplay/assets';
import type { WorldBookItem } from '@/types/worldbook';

let root: Root | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); });
const original: PresetItem = { id: 'old', title: 'old preset', createdAt: 1, updatedAt: 1,
  preset: parsePreset({ prompts: [{ identifier: 'p', content: 'old prompt' }], prompt_order: [] }),
  catalog: { author: '作者', series: '系列', version: 'v1', tags: ['状态/过期', '评价/良好'], status: 'retired', notes: 'old note' } };
async function mount(seed: PresetCatalog) {
  setActiveVault(createVault(createMemFs()));
  await getCurrentRepo<PresetItem>('presets').put(structuredClone(original));
  const imported = vi.fn(), close = vi.fn(), host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<TooltipProvider><PresetPackageImport seed={seed} onClose={close} onImported={imported} /></TooltipProvider>));
  const source = JSON.stringify({ prompts: [{ identifier: 'p', content: 'new prompt' }], prompt_order: [] });
  const file = new File([source], 'series-v2.json'); Object.defineProperty(file, 'text', { value: async () => source });
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="选择预设和附带文件"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return { imported, close };
}
function button(text: string) { const node = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === text); if (!node) throw new Error(`Missing button: ${text}`); return node; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function save(imported: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(button('导入 1 份预设')).toBeEnabled());
  await click(button('导入 1 份预设'));
  await vi.waitFor(() => expect(imported).toHaveBeenCalledOnce());
  return (await getAllPresets()).find(item => item.id !== original.id)!;
}

it('inherits existing series tags through the real import dialog so a retired series stays hidden in ST', async () => {
  const { imported } = await mount({ author: '作者', series: '系列' });
  const added = await save(imported);
  expect(added.catalog).toMatchObject({ tags: ['状态/过期', '评价/良好'], status: 'retired', version: 'v2' });
  expect(added.preset.prompts[0].content).toBe('new prompt'); expect(await getPreset(original.id)).toEqual(original);
  const assets = await createRoleplayAssets({ presets: getCurrentRepo<PresetItem>('presets'), worldbooks: getCurrentRepo<WorldBookItem>('worldbooks') });
  expect(assets.presetData().size).toBe(0);
});

it('applies an explicit import tag change to every existing version without replacing per-version data', async () => {
  const { imported } = await mount({ author: '作者', series: '系列', tags: ['状态/过期', '评价/良好'] });
  await click(button('在用'));
  const added = await save(imported), old = (await getPreset(original.id))!;
  expect(added.catalog).toMatchObject({ tags: ['评价/良好', '状态/在用'], status: 'active' });
  expect(old.catalog).toMatchObject({ tags: ['评价/良好', '状态/在用'], status: 'active', version: 'v1', notes: 'old note' });
  expect(old.preset).toEqual(original.preset);
});
