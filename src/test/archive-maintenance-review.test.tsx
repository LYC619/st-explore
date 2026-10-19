import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { saveCharacter, getCharacter } from '@/lib/archive-db';
import { getAllWorldBooks, getWorldBook, saveWorldBook } from '@/lib/worldbook-db';
import { DEFAULT_ENTRY, type WorldBookItem } from '@/types/worldbook';
import type { ArchiveCharacter } from '@/types/archive';

// Only shell chrome is omitted. The editor, router, COW, reference update and repositories are real.
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/GuidedTour', () => ({ GuidedTour: () => null }));
import WorldBookPage from '@/pages/WorldBook';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// These cases mount the real editor, commit through the repository, and reopen it.
vi.setConfig({ testTimeout: 15_000 });
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
let root: Root, container: HTMLDivElement;
const routers = new Set<ReturnType<typeof createMemoryRouter>>();
beforeEach(() => {
  closeDB(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.hasPointerCapture = () => false; Element.prototype.scrollIntoView = () => {};
  sessionStorage.clear(); localStorage.clear(); setActiveVault(null);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); for (const router of routers) router.dispose(); routers.clear(); });
  container.remove(); setActiveVault(null); closeDB(); vi.unstubAllGlobals();
});
async function eventually(assertion: () => void | Promise<void>) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await assertion();
  }, { timeout: 8000, interval: 20 });
}
const shared: WorldBookItem = { id: 'shared', title: '原世界书', createdAt: 1, updatedAt: 1,
  worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, comment: '卷总结', content: '原内容 A' } } } };
async function seed() {
  await saveWorldBook(structuredClone(shared));
  for (const id of ['c1', 'c2']) await saveCharacter({ id, name: id, card: { name: id }, tags: [], status: '未开始', createdAt: 1, updatedAt: 1,
    assets: [{ kind: 'worldbook', assetId: 'shared', relations: ['embedded'] }] } as ArchiveCharacter);
}
async function mount(id = 'shared') {
  const router = createMemoryRouter([
    { path: '/worldbook', element: <WorldBookPage /> }, { path: '/done', element: <p>已返回</p> },
  ], { initialEntries: ['/done', `/worldbook?assetId=${id}&characterId=c1`], initialIndex: 1 });
  routers.add(router);
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await eventually(() => {
    expect(document.querySelector('[data-entry-key="7"]')).not.toBeNull();
    expect(document.body.textContent).toContain('为「c1」处理');
  });
  return router;
}
async function edit(value: string) {
  const entry = document.querySelector<HTMLElement>('[data-entry-key="7"]');
  await act(async () => entry!.click());
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
  expect(textarea).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
    textarea!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function waitForNavigation(router: ReturnType<typeof createMemoryRouter>, path: string) {
  await eventually(() => expect(router.state.location.pathname).toBe(path));
}


import * as characterRefs from '@/lib/character-asset-ref';
import * as worldbooks from '@/lib/worldbook-db';
import { portraitCloudTasks } from '@/lib/portrait-cloud-task';
import { buildPortraitLinks } from '@/lib/portrait-cloud';
import { tinyPngBytes } from './fixtures/images';
import * as packageFiles from '@/lib/roleplay/export-package-file';
import { processPortraitImport } from '@/lib/portrait-import-parser';
import { buildPortraitPreview } from '@/lib/portrait-import-preferences';
import { worldbookRecoveryKey } from '@/hooks/use-worldbook-session';

afterEach(() => { vi.restoreAllMocks(); portraitCloudTasks.dismiss(); });
it('regression: retry recovers when derived content saved but reference update failed once', async () => {
  await seed(); const router = await mount();
  const reference = vi.spyOn(characterRefs, 'updateCharacterAssetReference').mockRejectedValueOnce(new Error('temporary character write failure'));
  await edit('待保存的新内容');
  await act(async () => { await router.navigate('/done'); });
  await eventually(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('失败'));
  expect(reference).toHaveBeenCalledTimes(1);
  expect((await getAllWorldBooks()).length).toBe(2);
  expect((await getCharacter('c1'))!.assets![0].assetId).toBe('shared');
  const retry = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '保存')!;
  await act(async () => { retry.click(); });
  await eventually(() => expect(document.querySelector('[role="status"]')?.textContent).toBe('已保存'));
  expect((await getCharacter('c1'))!.assets![0].assetId).not.toBe('shared');
  const id = (await getCharacter('c1'))!.assets![0].assetId;
  expect((await getWorldBook(id))!.worldbook.entries['7'].content).toBe('待保存的新内容');
  expect((await getCharacter('c2'))!.assets![0].assetId).toBe('shared');
  expect(await getAllWorldBooks()).toHaveLength(2);
});

async function clickSave() {
  const save = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '保存')!;
  await act(async () => { save.click(); });
  await eventually(() => expect(document.querySelector('[role="status"]')?.textContent).toMatch(/已保存|失败/));
}

it.each(['browser', 'vault'])('restoring the plain tool route cannot overwrite a newer library revision (%s)', async mode => {
  if (mode === 'vault') setActiveVault(createVault(createMemFs()));
  await seed();
  sessionStorage.setItem('wb-active-session', JSON.stringify({ worldbook: shared.worldbook, filename: shared.title, currentItemId: shared.id }));
  const external = structuredClone(shared);
  external.worldbook.entries['8'] = { ...DEFAULT_ENTRY, uid: 8, comment: '外部新增', content: '不可丢失的新内容' };
  await saveWorldBook(external);
  const router = createMemoryRouter([{ path: '/worldbook', element: <WorldBookPage /> }], { initialEntries: ['/worldbook'] });
  routers.add(router);
  await act(async () => { root.render(<RouterProvider router={router} />); });
  await eventually(() => expect(document.querySelector('[data-entry-key="7"]')).not.toBeNull());
  await edit('旧会话继续编辑 C'); await clickSave();
  expect((await getWorldBook(shared.id))!.worldbook.entries['8']?.content).toBe('不可丢失的新内容');
  expect(document.querySelector('[role="status"]')?.getAttribute('title')).toContain('其他位置修改');
  expect(document.querySelector('textarea')).toHaveValue('旧会话继续编辑 C');
});

it.each(['recent', 'import'])('switching books keeps failed recovery drafts with the new target (%s)', async mode => {
  await seed();
  const other = { ...structuredClone(shared), id: 'other', title: '另一本书' };
  await saveWorldBook(other); const router = await mount();
  if (mode === 'recent') {
    await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('最近打开'))!.click());
    await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await act(async () => Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent?.includes(other.title))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await eventually(() => expect(router.state.location.search).toContain('assetId=other'));
  } else {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([JSON.stringify(other.worldbook)], '导入书.json', { type: 'application/json' });
    // jsdom's File lacks Blob.text(); only supply the missing browser boundary.
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(other.worldbook) });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await eventually(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '替换当前')!.click());
    await eventually(async () => expect((await getAllWorldBooks()).length).toBe(3));
  }
  const targetId = new URLSearchParams(router.state.location.search).get('assetId')!;
  vi.spyOn(worldbooks, 'saveWorldBook').mockRejectedValueOnce(new Error('disk full'));
  await edit('新书失败草稿'); await clickSave();
  await eventually(() => expect(localStorage.getItem(worldbookRecoveryKey(targetId, 'c1')) ?? '').toContain('新书失败草稿'));
  expect(localStorage.getItem(worldbookRecoveryKey('shared', 'c1'))).toBeNull();
});

it('switching away from a failed save does not overwrite the next book recovery draft', async () => {
  await seed();
  const other = { ...structuredClone(shared), id: 'other', title: '另一本书' };
  await saveWorldBook(other);
  const recovery = { worldbook: { entries: { '7': { ...DEFAULT_ENTRY, uid: 7, content: '另一本书未保存草稿' } } }, filename: other.title, currentItemId: other.id };
  localStorage.setItem(worldbookRecoveryKey(other.id, 'c1'), JSON.stringify(recovery));
  await mount();
  vi.spyOn(worldbooks, 'saveWorldBook').mockRejectedValueOnce(new Error('disk full'));
  await edit('当前书失败草稿'); await clickSave();
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('最近打开'))!.click());
  await eventually(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await act(async () => Array.from(document.querySelectorAll('[role="dialog"] button')).find(button => button.textContent?.includes(other.title))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await eventually(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
  await act(async () => Array.from(document.querySelectorAll('[role="alertdialog"] button')).find(button => button.textContent?.includes('确认加载'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await eventually(() => expect(document.body.textContent).toContain('恢复草稿并重试保存'));
  expect(JSON.parse(localStorage.getItem(worldbookRecoveryKey(other.id, 'c1'))!).worldbook.entries['7'].content).toBe('另一本书未保存草稿');
});

it.each(['browser', 'vault'])('retries a partially saved book after further edits (%s)', async mode => {
  if (mode === 'vault') setActiveVault(createVault(createMemFs()));
  await seed(); const router = await mount();
  vi.spyOn(characterRefs, 'updateCharacterAssetReference').mockRejectedValueOnce(new Error('temporary reference failure'));
  await edit('第一次草稿'); await clickSave();
  expect(document.querySelector('[role="status"]')?.getAttribute('title')).toContain('引用切换失败');
  const partial = (await getAllWorldBooks()).find(book => book.id !== 'shared')!;
  await edit('继续编辑的草稿'); await clickSave();
  expect((await getCharacter('c1'))!.assets![0].assetId).toBe(partial.id);
  expect((await getWorldBook(partial.id))!.worldbook.entries['7'].content).toBe('继续编辑的草稿');
  expect((await getWorldBook('shared'))!.worldbook.entries['7'].content).toBe('原内容 A');
  expect(await getAllWorldBooks()).toHaveLength(2);
  await act(async () => { await router.navigate('/done'); });
  await waitForNavigation(router, '/done');
  expect(router.state.location.pathname).toBe('/done');
  act(() => root.unmount()); root = createRoot(container);
  await mount(partial.id);
  await act(async () => document.querySelector<HTMLElement>('[data-entry-key="7"]')!.click());
  expect(document.querySelector('textarea')).toHaveValue('继续编辑的草稿');
});

it('a real external change to the partial copy still blocks retry', async () => {
  await seed(); await mount();
  const reference = vi.spyOn(characterRefs, 'updateCharacterAssetReference').mockRejectedValueOnce(new Error('temporary reference failure'));
  await edit('本地草稿'); await clickSave();
  const partial = (await getAllWorldBooks()).find(book => book.id !== 'shared')!;
  partial.worldbook.entries['7'].content = '外部新内容'; await saveWorldBook(partial);
  await clickSave();
  expect(reference).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="status"]')?.getAttribute('title')).toContain('其他位置修改');
  expect((await getWorldBook(partial.id))!.worldbook.entries['7'].content).toBe('外部新内容');
  expect((await getCharacter('c1'))!.assets![0].assetId).toBe('shared');
  expect(document.querySelector('textarea')).toHaveValue('本地草稿');
});

it('opening a source book does not silently overwrite an existing different derived copy', async () => {
  await seed();
  const copy = structuredClone(shared);
  copy.id = 'existing-copy';
  copy.worldbook.entries['7'].content = '已存在的角色专用内容';
  copy.derived = { characterId: 'c1', derivedFrom: 'shared', diverged: true, createdAt: 1, updatedAt: 1 };
  await saveWorldBook(copy);
  await mount(); await edit('基于来源的草稿'); await clickSave();
  expect(document.querySelector('[role="status"]')?.getAttribute('title')).toContain('其他位置修改');
  expect((await getWorldBook(copy.id))!.worldbook.entries['7'].content).toBe('已存在的角色专用内容');
});

it('retries an asset write failure without inventing a partial commit', async () => {
  await seed(); await mount();
  vi.spyOn(worldbooks, 'saveWorldBook').mockRejectedValueOnce(new Error('disk full'));
  await edit('待保存内容'); await clickSave();
  expect(await getAllWorldBooks()).toHaveLength(1);
  expect((await getCharacter('c1'))!.assets![0].assetId).toBe('shared');
  await clickSave();
  const id = (await getCharacter('c1'))!.assets![0].assetId;
  expect(id).not.toBe('shared');
  expect((await getWorldBook(id))!.worldbook.entries['7'].content).toBe('待保存内容');
});

import { exportCharactersToDirectory } from '@/lib/character-batch-export';
import { buildCharacterExportSnapshot } from '@/lib/character-export-snapshot';
it('regression: native Library directory export includes the current bound worldbook', async () => {
  await seed();
  const character = (await getCharacter('c1'))!;
  character.card.character_book = { name: '旧书', entries: [{ id: 7, content: '原内容 A', keys: [], extensions: {}, enabled: true, insertion_order: 0 }] };
  await saveCharacter(character);
  const book = (await getWorldBook('shared'))!;
  book.worldbook.entries['7'].content = '当前内容 B';
  await saveWorldBook(book);
  const snapshot = await buildCharacterExportSnapshot('c1');
  expect(JSON.stringify(snapshot.card)).toContain('当前内容 B');
  const fs = createMemFs();
  const result = await exportCharactersToDirectory([character], fs);
  expect(result.failed).toEqual([]);
  const output = await fs.readText(result.exported[0].fileName);
  expect(output).toContain('当前内容 B');
});

it('regression: existing advanced URL templates without a path extension still import real PNG bytes', async () => {
  setActiveVault(createVault(createMemFs())); await seed();
  const links = buildPortraitLinks({source:'portrait-1', pattern:'(.+)', template:'https://image.example/render?id=$1', encode:true});
  const fetcher=vi.fn(async()=>new Response(tinyPngBytes(),{headers:{'content-type':'image/png'}}));
  vi.stubGlobal('fetch',fetcher);
  portraitCloudTasks.start({characterId:'c1', characterName:'c1', rowId:null,rowTitle:'未分行'},links);
  for(let n=0;n<100 && portraitCloudTasks.getSnapshot()?.status==='running';n++) await new Promise(resolve=>setTimeout(resolve,10));
  expect(portraitCloudTasks.getSnapshot()?.items[0].status).toBe('saved');
  const saved = (await getCharacter('c1'))!;
  const parsed = processPortraitImport({ mode: 'advanced', source: 'portrait-1', pattern: '(.+)', template: 'https://image.example/render?id=$1', encode: true });
  expect(buildPortraitPreview(parsed, [], saved)[0]).toMatchObject({ alreadySaved: true, selected: false });
  portraitCloudTasks.start({characterId:'c1', characterName:'c1', rowId:null,rowTitle:'未分行'},links);
  await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
  expect(portraitCloudTasks.getSnapshot()?.items[0].status).toBe('skipped');
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['([^:]+): (.+)', '([^:]+)(?=: (.+))'])('regression: changed advanced source does not inherit the old manual image URL (%s)', async pattern => {
  await seed();
  const character = (await getCharacter('c1'))!;
  const rules = { mode: 'advanced' as const, pattern, template: 'https://image.example/$2', encode: true };
  const before = buildPortraitPreview(processPortraitImport({ ...rules, source: 'Alice: abcd.png' }), [], character);
  before[0] = { ...before[0], manualUrl: true, url: 'https://image.example/manual.png', input: 'https://image.example/manual.png' };
  const parsed = processPortraitImport({ ...rules, source: 'Alice: efgh.png' });
  expect(parsed.items[0].url).toBe('https://image.example/efgh.png');
  const after = buildPortraitPreview(parsed, before, character);
  expect(after[0].url).toBe('https://image.example/efgh.png');
});

it('regression: conflicting draft can be exported using the instructed recovery action', async () => {
  await seed(); await mount();
  await edit('本地草稿 C');
  const external = (await getWorldBook('shared'))!;
  external.worldbook.entries['7'].content = '其他位置保存 B';
  await saveWorldBook(external);
  const save = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '保存')!;
  await act(async () => { save.click(); });
  await eventually(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('失败'));
  expect(document.querySelector('[role="status"]')?.getAttribute('title')).toContain('请先导出草稿');
  const output = vi.spyOn(packageFiles, 'saveTextFile').mockResolvedValue('downloaded');
  const exportButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '导出未保存草稿');
  expect(exportButton).toBeDefined();
  await act(async () => { exportButton!.click(); });
  await eventually(() => expect(output).toHaveBeenCalledOnce());
  expect(output).toHaveBeenCalledOnce();
  expect(output.mock.calls[0][0]).toMatchObject({ fileName: expect.stringContaining('未保存草稿'), text: expect.stringContaining('本地草稿 C') });
  expect((await getWorldBook('shared'))!.worldbook.entries['7'].content).toBe('其他位置保存 B');
  expect(await getAllWorldBooks()).toHaveLength(1);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('失败');
});
