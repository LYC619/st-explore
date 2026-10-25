import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresetSelect } from '@/components/preset/PresetSelect';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { parsePreset } from '@/lib/preset-parser';
import { presetOptionLabel, suggestPresetModels } from '@/lib/preset-catalog';
import { toAssetIndex } from '@/lib/asset-index-entry';
import type { PresetItem } from '@/types/preset';

const originalData = {
  prompts: [{ identifier: 'main', name: '主提示词', content: 'fixture content' }], prompt_order: [],
  chat_completion_source: 'makersuite', google_model: 'gemini-2.5-pro', claude_model: 'claude-3-opus', openai_model: 'gpt-4',
};
const oldPreset: PresetItem = { id: 'old-unorganized', title: '旧系列 v1', preset: parsePreset(originalData), createdAt: 1, updatedAt: 2 };
let root: Root | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ''; setActiveVault(null); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('shared preset identity at selection entrypoints', () => {
  it('suggests the active provider model without inactive provider leftovers', () => {
    expect(suggestPresetModels(oldPreset.title, oldPreset.preset)).toEqual(['Gemini']);
    expect(suggestPresetModels('[Claude]新版 v2', oldPreset.preset)).toEqual(['Claude']);
    expect(suggestPresetModels(oldPreset.title, parsePreset({ ...originalData, chat_completion_source: 'custom' }))).toEqual([]);
  });

  it('uses the same full/light label and does not repeat the DIY suffix or version', () => {
    const diy: PresetItem = { ...oldPreset, title: '旧系列 v1 · DIY', catalog: { series: '旧系列', version: 'v1', variant: 'DIY', originId: oldPreset.id } };
    const label = presetOptionLabel(diy);
    expect(label.match(/DIY/g)).toHaveLength(1);
    expect(label.match(/v1/g)).toHaveLength(1);
    expect(label).toContain('Gemini');
    expect(label).not.toContain('Claude');
    expect(presetOptionLabel(toAssetIndex(diy))).toBe(label);
  });

  it('filters and selects an unorganized legacy preset using its projected active model', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    const vault = createVault(createMemFs()); setActiveVault(vault);
    await vault.repo<PresetItem>('presets').put(oldPreset);
    await vault.repo<PresetItem>('presets').put({ ...oldPreset, id: 'manual-claude', title: '另一套 v2', catalog: { models: ['Claude'] } });
    const changed = vi.fn();
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(<PresetSelect value={null} onChange={changed} />));
    const filter = document.querySelector<HTMLSelectElement>('select[aria-label="按适配模型筛选预设"]')!;
    await vi.waitFor(() => expect([...filter.options].map(option => option.value)).toContain('Gemini'));
    await act(async () => { filter.value = 'Gemini'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="挂载预设"]')!;
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    const legacy = options.find(option => option.textContent?.includes('旧系列'));
    expect(legacy?.textContent).toContain('Gemini');
    expect(options.some(option => option.textContent?.includes('另一套'))).toBe(false);
    await act(async () => legacy!.click());
    expect(changed).toHaveBeenCalledWith('old-unorganized');
    expect((await vault.repo<PresetItem>('presets').get('old-unorganized'))?.catalog).toBeUndefined();
  });
});
