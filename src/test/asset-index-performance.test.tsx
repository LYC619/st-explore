import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { GlobalSearch } from '@/components/GlobalSearch';
import { TooltipProvider } from '@/components/ui/tooltip';
import Home from '@/pages/Home';
import Tools from '@/pages/Tools';
import PresetLibrary from '@/pages/PresetLibrary';
import { listAssetIndex } from '@/lib/asset-index';
import { getCurrentRepo } from '@/lib/repo';
import type { WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';

vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  setActiveVault(null);
  vi.restoreAllMocks();
});

async function fixture() {
  const disk = createMemFs();
  const files = [
    ['资产/世界书/世界.json', { entries: { '0': { uid: 0, content: '大段世界书正文'.repeat(2000) } }, __ste: { id: 'w', title: '测试世界书', createdAt: 1, updatedAt: 2 } }],
    ['资产/预设/预设.json', { prompts: [{ identifier: 'p', name: 'p', role: 'system', content: '大段预设正文'.repeat(2000) }], prompt_order: [], __ste: { id: 'p', title: '测试预设', createdAt: 1, updatedAt: 2 } }],
    ['资产/正则/规则.json', { rules: [{ id: 'r', scriptName: 'r', findRegex: 'a', replaceString: '长替换'.repeat(2000) }], __ste: { id: 'r', title: '测试规则', createdAt: 1, updatedAt: 2 } }],
  ] as const;
  for (const [path, data] of files) await disk.writeText(path, JSON.stringify(data));
  const reads: string[] = [];
  const vault = createVault({ ...disk, async readText(path) { reads.push(path); return disk.readText(path); } });
  setActiveVault(vault);
  return { disk, vault, reads };
}

it('asset listings reuse cold scan projections without cloning payloads, while full reads preserve them', async () => {
  const { vault, reads } = await fixture();
  await vault.pathOf('worldbooks', 'w');
  reads.length = 0;
  for (const [store, id, payload] of [['worldbooks', 'w', 'worldbook'], ['presets', 'p', 'preset'], ['regexes', 'r', 'rules']] as const) {
    const repo = vault.repo(store);
    const entries = await repo.listLight();
    expect(entries).toHaveLength(1);
    expect(Object.hasOwn(entries[0], payload)).toBe(false);
    expect(entries[0]).toMatchObject({ id, entryCount: 1 });
  }
  expect(reads).toEqual([]);
  expect(await vault.repo('worldbooks').get('w')).toHaveProperty('worldbook.entries.0.content');
  expect(await vault.repo('presets').get('p')).toHaveProperty('preset.prompts');
  expect(await vault.repo('regexes').get('r')).toHaveProperty('rules');
});

it.each(['vault', 'idb'] as const)('%s summaries track writes/removal without changing lossless asset data', async backend => {
  const { vault } = await fixture();
  const source = (await vault.repo<WorldBookItem>('worldbooks').get('w'))!;
  if (backend === 'idb') setActiveVault(null);
  const repo = getCurrentRepo<WorldBookItem>('worldbooks');
  const original = { ...source, provenance: { unknown: 'preserve' } };
  await repo.put(original);
  expect(await listAssetIndex('worldbooks')).toMatchObject([{ id: 'w', entryCount: 1 }]);
  const full = (await repo.get('w'))!;
  expect(full).toEqual(original);
  const updated = { ...full, title: '已改名', worldbook: { ...full.worldbook, entries: {
    ...full.worldbook.entries, '1': { ...full.worldbook.entries['0'], uid: 1, content: '新增正文' },
  } } };
  await repo.put(updated);
  const entries = await listAssetIndex('worldbooks');
  expect(entries).toMatchObject([{ id: 'w', title: '已改名', entryCount: 2 }]);
  expect(Object.keys(entries[0]).sort()).toEqual(['id', 'title', 'createdAt', 'updatedAt', 'entryCount', 'autoSaved', 'sourceModifiedAt'].sort());
  expect(await repo.get('w')).toEqual(updated);
  entries[0].title = 'caller edit';
  expect((await listAssetIndex('worldbooks'))[0].title).toBe('已改名');
  await repo.remove('w');
  expect(await listAssetIndex('worldbooks')).toEqual([]);
  setActiveVault(createVault(createMemFs()));
  expect(await listAssetIndex('worldbooks')).toEqual([]);
});

it.each(['home', 'search', 'worldbook', 'preset'] as const)('%s reads only asset summaries and keeps display/navigation intact', async scene => {
  const { vault } = await fixture();
  await vault.pathOf('worldbooks', 'w');
  const clonedPayloads: string[] = [];
  const clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
    if (value && typeof value === 'object' && 'id' in value && ('worldbook' in value || 'preset' in value || 'rules' in value)) clonedPayloads.push(String(value.id));
    return clone(value);
  });
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const path = scene === 'preset' ? '/presets?mode=select' : scene === 'worldbook' ? '/tools?focus=worldbook' : '/';
  await act(async () => root!.render(<MemoryRouter initialEntries={[path]}><TooltipProvider>{scene === 'home' ? <Home /> : scene === 'search' ? <GlobalSearch /> : scene === 'preset' ? <PresetLibrary /> : <Tools />}</TooltipProvider></MemoryRouter>));
  if (scene === 'search') {
    const input = container.querySelector('input')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '测试');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('测试世界书');
    expect(container.textContent).toContain('测试预设');
    expect(container.textContent).toContain('测试规则');
  } else if (scene === 'worldbook' || scene === 'preset') {
    if (scene === 'worldbook') expect(container.textContent).toContain('1 个条目');
    expect(container.textContent).toContain(scene === 'worldbook' ? '测试世界书' : '测试预设');
  } else {
    expect(container.textContent).toContain('世界书');
    expect(container.textContent).toContain('预设');
  }
  expect(clonedPayloads).toEqual([]);
});
import 'fake-indexeddb/auto';

function SearchLocation() {
  const location = useLocation();
  return <output data-search-location>{location.pathname}{location.search}</output>;
}

it('real global search finds preset metadata and inferred series using summaries, then opens the selected library entry', async () => {
  const { vault, reads } = await fixture();
  const repo = vault.repo<PresetItem>('presets');
  const preset = (await repo.get('p'))!;
  await repo.put({ ...preset, catalog: { author: '墨舟', series: '星港', version: 'v3.2', models: ['Claude'], purposes: ['写卡'], tags: ['慢热'], notes: '附带说明' },
    preset: { ...preset.preset, originalData: { ...preset.preset.originalData, chat_completion_source: 'google', google_model: 'gemini-3-pro' } } });
  await repo.put({ ...preset, id: 'inferred', title: '幻_境 v2.0', catalog: undefined });
  // Writes intentionally evict projections. Rebuild the same bounded index the
  // preset library uses before measuring whether search loads full records.
  await listAssetIndex('presets');
  reads.length = 0;
  const clonedPayloads: string[] = [], clone = globalThis.structuredClone;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
    if (value && typeof value === 'object' && 'id' in value && ('worldbook' in value || 'preset' in value || 'rules' in value)) clonedPayloads.push(String(value.id));
    return clone(value);
  });
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><GlobalSearch /><SearchLocation /></MemoryRouter>));
  const input = container.querySelector('input')!;
  async function search(text: string) {
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return [...container.querySelectorAll<HTMLButtonElement>('[data-tour="global-search"] button')];
  }
  for (const query of ['墨舟', '星港', 'claude', 'v3.2', '写卡', '慢热', '附带说明']) {
    const results = await search(query);
    expect(results, query).toHaveLength(1);
    expect(results[0].textContent).toContain('测试预设');
    expect(results[0].textContent).toContain('墨舟 · v3.2 · Claude');
  }
  expect(await search('Gemini')).toHaveLength(0);
  const inferred = await search('幻 境');
  expect(inferred).toHaveLength(1);
  expect(inferred[0].textContent).toContain('幻 境');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(container.querySelector('[data-search-location]')?.textContent).toBe('/presets/inferred');
  expect(clonedPayloads).toEqual([]);
  expect(reads).toEqual([]);
});
