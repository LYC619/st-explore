import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { ArchiveCharacter } from '@/types/archive';
const api = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/portrait-cloud', async (importOriginal) => ({ ...await importOriginal<object>(), downloadPortrait: api.download }));
import { processPortraitImport, type PortraitImportRequest } from '@/lib/portrait-import-parser';
import { tinyPngBytes } from './fixtures/images';
import { PortraitCloudImport } from '@/components/character/PortraitCloudImport';
import { PortraitCloudTasks } from '@/components/character/PortraitCloudTasks';
import { portraitCloudTasks } from '@/lib/portrait-cloud-task';
import { closeDB } from '@/lib/idb';
import { getCharacter, saveCharacter } from '@/lib/archive-db';
import { setActiveVault } from '@/lib/vault/active';
import { savePortraitImportPreferences } from '@/lib/portrait-import-preferences';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class PreviewWorker {
  onmessage?: (message: { data: { result: ReturnType<typeof processPortraitImport> } }) => void;
  postMessage(request: PortraitImportRequest) {
    queueMicrotask(() => this.onmessage?.({ data: { result: processPortraitImport(request) } }));
  }
  terminate() {}
}
let root: Root, host: HTMLDivElement;
const character = { id: 'cloud-ui', name: '奏枝', tags: [], card: { name: '奏枝' }, status: '未开始', createdAt: 1, updatedAt: 1, portraitRows: [{ id: 'expressions', title: '表情', items: [] }] } as ArchiveCharacter;
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)!;
  expect(button, label).toBeTruthy();
  await act(async () => button.click());
}
beforeEach(async () => {
  closeDB(); globalThis.indexedDB = new IDBFactory(); setActiveVault(null); portraitCloudTasks.dismiss();
  localStorage.clear();
  vi.stubGlobal('Worker', PreviewWorker);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await saveCharacter(character);
});
afterEach(async () => {
  await act(async () => { root.unmount(); setActiveVault(null); });
  host.remove(); closeDB(); vi.unstubAllGlobals();
});

it('keeps the target row and download alive after closing the popup and navigating away', async () => {
  let finish!: (file: File) => void;
  api.download.mockImplementation((_link, signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return new Promise<File>(resolve => { finish = resolve; });
  });
  await act(async () => root.render(<MemoryRouter><PortraitCloudImport character={character} /><PortraitCloudTasks /></MemoryRouter>));
  await click('从图床导入');
  const source = document.querySelector<HTMLTextAreaElement>('[aria-label="名称或世界书片段"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, '奏枝 开心：立绘abc123.png');
    source.dispatchEvent(new Event('input', { bubbles: true }));
    const row = document.querySelector<HTMLSelectElement>('[aria-label="保存到分行"]')!;
    row.value = 'expressions'; row.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  await click('导入所选（1）');
  await click('Close');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.render(<MemoryRouter><p>其他模块</p><PortraitCloudTasks /></MemoryRouter>));
  expect(document.querySelector('[aria-label="立绘下载任务"]')).toHaveTextContent('表情');
  await act(async () => finish(new File([tinyPngBytes()], '奏枝 开心.png', { type: 'image/png' })));
  await act(async () => { await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed')); });
  const saved = await getCharacter(character.id);
  expect(saved?.portraitRows?.[0].items.map(item => item.name)).toEqual(['奏枝 开心.png']);
});

it('reports a deleted target row without silently importing into the ungrouped row', async () => {
  api.download.mockResolvedValue(new File(['png'], 'image.png', { type: 'image/png' }));
  portraitCloudTasks.start({ characterId: character.id, characterName: character.name, rowId: 'deleted-row', rowTitle: '已删分行' }, [{ name: 'image', url: 'https://x.test/a.png' }]);
  await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed'));
  expect(portraitCloudTasks.getSnapshot()?.items[0]).toMatchObject({ status: 'failed', error: '图片保存失败或目标分行已删除' });
  expect((await getCharacter(character.id))?.portraitRows).toEqual(character.portraitRows);
});

it('advanced endpoint URLs remain selectable after correcting the URL and import real image bytes', async () => {
  const original = await vi.importActual<typeof import('@/lib/portrait-cloud')>('@/lib/portrait-cloud');
  api.download.mockImplementation(original.downloadPortrait);
  const fetcher = vi.fn(async () => new Response(tinyPngBytes(), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  savePortraitImportPreferences({ version: 1, mode: 'advanced', pattern: '^([^:]+): (.+)$', template: 'https://image.example/render?id=$2', host: 'https://image.example/', encode: true });
  await act(async () => root.render(<MemoryRouter><PortraitCloudImport character={character} /></MemoryRouter>));
  await click('从图床导入');
  const source = document.querySelector<HTMLTextAreaElement>('[aria-label="名称或世界书片段"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, 'Alice: first');
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  const input = document.querySelector<HTMLInputElement>('[aria-label="第 1 行链接或文件码"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://image.example/render?id=corrected');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(document.querySelector('[aria-label="选择第 1 行"]')).toBeChecked();
  await click('导入所选（1）');
  await act(async () => { await vi.waitFor(() => expect(portraitCloudTasks.getSnapshot()?.status).toBe('completed')); });
  expect(portraitCloudTasks.getSnapshot()?.items[0].status).toBe('saved');
  expect(fetcher).toHaveBeenCalledWith('https://image.example/render?id=corrected', expect.objectContaining({ credentials: 'omit' }));
  expect((await getCharacter(character.id))!.portraitRows!.flatMap(row => row.items))
    .toEqual([expect.objectContaining({ importSource: expect.objectContaining({ url: 'https://image.example/render?id=corrected' }) })]);
});
