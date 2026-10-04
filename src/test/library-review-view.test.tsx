import { act, createRef, forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';
import { setCurrentVaultId } from '@/lib/vault/vault-scope';
import { setActiveVault } from '@/lib/vault/active';
import { getReviewSession } from '@/components/library/review/review-session';

const api = vi.hoisted(() => ({ summaries: vi.fn(), updateCharacter: vi.fn(), updateStory: vi.fn(), flush: vi.fn(), reader: vi.fn(), ready: vi.fn() }));
vi.mock('@/lib/summary-db', () => ({ getAllSummaries: api.summaries }));
vi.mock('@/lib/archive-db', () => ({ updateCharacter: api.updateCharacter, updateArchiveStory: api.updateStory }));
vi.mock('@/components/character/InlineStoryReader', () => ({ InlineStoryReader: forwardRef(function Reader({ storyId, onReadyChange }: { storyId: string; onReadyChange?: (ready: boolean) => void }, ref) {
  useLayoutEffect(() => { onReadyChange?.(false); api.ready(onReadyChange); return () => onReadyChange?.(false); }, [onReadyChange]);
  api.reader(storyId); useImperativeHandle(ref, () => ({ flushPendingSave: api.flush })); return <p>正文 {storyId}</p>;
}) }));
import { LibraryReviewView, type LibraryReviewHandle } from '@/components/library/review/LibraryReviewView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView = () => {};
let root: Root; let host: HTMLDivElement; let counter = 0;
const characters = ['a', 'b', 'c'].map(id => ({ id, name: `角色${id}`, tags: [], card: { name: id }, status: '未开始', createdAt: 1, updatedAt: 1 } as ArchiveCharacter));
const stories = ['a', 'b'].map(id => ({ id: `s-${id}`, characterId: id, title: `故事${id}`, markers: [], floorCount: 3, createdAt: 1, updatedAt: 1, meta: { modelsUsed: [], playTimeMs: null } } as StoryIndexEntry));
const summaries = ['a', 'b'].map(id => ({ id, bookId: `s-${id}`, bookTitle: id, title: `总结${id}`, kind: 'volume', content: `${id} 的总结全文`, floorStart: 0, floorEnd: 2, createdAt: 1, updatedAt: 1 } as SummaryItem));
const changed = vi.fn();
const reviewRef = createRef<LibraryReviewHandle>();
async function render(cards = characters, key = 'default') { await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LibraryReviewView ref={reviewRef} key={key} characters={cards} storyIndex={stories} onCharacterChange={changed} onStoriesChange={async () => {}} /></MemoryRouter>)); }
async function click(text: string) { const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function input(label: string, value: string) { const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; expect(el).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { setCurrentVaultId(`review-test-${++counter}`); vi.clearAllMocks(); api.summaries.mockResolvedValue(summaries); api.flush.mockResolvedValue(undefined); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); setCurrentVaultId(null); });

it('opens overview then keeps summary tab and restores each character scroll without rereading all records', async () => {
  await render(); expect(document.querySelector('[role=tab][aria-selected=true]')).toHaveTextContent('总览');
  await click('总结'); expect(host).toHaveTextContent('a 的总结全文');
  const pane = document.querySelector<HTMLElement>('[data-review-scroll]')!;
  await act(async () => { pane.scrollTop = 217; pane.dispatchEvent(new Event('scroll')); });
  await click('选择角色b'); expect(host).toHaveTextContent('b 的总结全文'); expect(pane.scrollTop).toBe(0);
  await click('选择角色a'); expect(pane.scrollTop).toBe(217);
  await click('选择角色c'); expect(document.querySelector('[role=tab][aria-selected=true]')).toHaveTextContent('总结'); expect(host).toHaveTextContent('还没有总结');
  expect(api.summaries).toHaveBeenCalledTimes(1); expect(api.reader).not.toHaveBeenCalled();
});
it('restores story pixels only when the mounted reader is ready and ignores loading scroll events', async () => {
  const session = getReviewSession(); session.selectedId = 'a'; session.tab = 'stories';
  session.characters.set('a', { storyId: 's-a', scroll: {}, storyScroll: 450 });
  await render(); const pane = document.querySelector<HTMLElement>('[data-review-scroll]')!;
  await act(async () => { pane.scrollTop = 0; pane.dispatchEvent(new Event('scroll')); });
  expect(session.characters.get('a')?.storyScroll).toBe(450);
  const ready = api.ready.mock.calls.at(-1)?.[0] as ((value: boolean) => void) | undefined;
  expect(ready).toBeTypeOf('function');
  await act(async () => ready!(true)); expect(pane.scrollTop).toBe(450);
  await click('选择角色b'); await click('选择角色a');
  await act(async () => { pane.scrollTop = 0; pane.dispatchEvent(new Event('scroll')); });
  expect(session.characters.get('a')?.storyScroll).toBe(450);
  await act(async () => api.ready.mock.calls.at(-1)![0](true)); expect(pane.scrollTop).toBe(450);
});
it('distinguishes read failure from empty and retries', async () => {
  api.summaries.mockRejectedValueOnce(new Error('磁盘不可读')); await render(); await click('总结');
  expect(host).toHaveTextContent('读取总结和日记失败'); expect(host).not.toHaveTextContent('还没有总结');
  await click('重试读取'); expect(host).toHaveTextContent('a 的总结全文');
});
it('only-with-stories filters the directory while preserving the active tab', async () => {
  await render(); await click('总结');
  const checkbox = document.querySelector<HTMLInputElement>('[aria-label="仅有故事"]')!;
  await act(async () => checkbox.click()); expect(document.querySelector('[aria-label="选择角色c"]')).toBeNull();
  expect(document.querySelector('[role=tab][aria-selected=true]')).toHaveTextContent('总结');
});
it('waits for reader save and keeps the current content on failure', async () => {
  await render(); await click('故事'); await click('阅读 故事a'); expect(host).toHaveTextContent('正文 s-a');
  api.flush.mockRejectedValueOnce(new Error('只读目录')); await click('选择角色b');
  expect(host).toHaveTextContent('正文 s-a'); expect(host).toHaveTextContent('故事尚未保存');
  await click('选择角色b'); expect(host).not.toHaveTextContent('正文 s-a');
  await click('选择角色a'); expect(host).toHaveTextContent('正文 s-a');
});
it('keeps failed note inputs and retries with the entity captured when the editor opened', async () => {
  api.updateCharacter.mockRejectedValueOnce(new Error('写入失败')).mockImplementation(async (id, update) => ({ ...characters.find(c => c.id === id), ...await update(characters.find(c => c.id === id)) }));
  await render(); await click('备注'); await click('新建备注'); await input('备注内容', '新的心得'); await click('保存备注');
  expect(document.querySelector('textarea')).toHaveValue('新的心得'); expect(document.body).toHaveTextContent('写入失败');
  await click('保存备注'); expect(api.updateCharacter.mock.calls.map(c => c[0])).toEqual(['a', 'a']); expect(changed).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', notes: [expect.objectContaining({ body: '新的心得' })] }));
  expect(changed.mock.calls[0][0].updatedAt).toBeGreaterThan(1);
});
it('saves rating and labels through the shared domain, including the rating tier', async () => {
  api.updateCharacter.mockImplementation(async (id, update) => ({ ...characters[0], ...await update(characters[0]) }));
  await render(); await click('编辑评分和标签'); await input('评分', '8'); await input('标签', '人物/少女'); await click('保存评分和标签');
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ rating: 8, tags: expect.arrayContaining(['人物/少女', '评价/精品']) }));
  expect(changed.mock.calls[0][0].updatedAt).toBeGreaterThan(1);
});
it('does not submit an edit twice or change its entity when selection moves during a save', async () => {
  let finish!: (value: ArchiveCharacter) => void;
  api.updateCharacter.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await click('备注'); await click('新建备注'); await input('备注内容', 'A 的心得'); await click('保存备注');
  await click('保存中…'); expect(api.updateCharacter).toHaveBeenCalledTimes(1);
  await click('选择角色b'); await act(async () => finish({ ...characters[0], notes: [{ id: 'n', body: 'A 的心得', at: 2 }] }));
  expect(api.updateCharacter.mock.calls[0][0]).toBe('a'); expect(changed.mock.calls[0][0].id).toBe('a');
  expect(document.querySelector('h2')).toHaveTextContent('角色b');
});
it('keeps a failed story status selection for retry', async () => {
  api.updateStory.mockRejectedValueOnce(new Error('状态写入失败')).mockResolvedValue({ id: 's-a', status: '已完结' });
  await render(); await click('故事'); const select = document.querySelector<HTMLSelectElement>('select')!;
  await act(async () => { select.value = '已完结'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await click('保存状态');
  expect(host).toHaveTextContent('状态写入失败'); expect(select.value).toBe('已完结'); await click('保存状态');
  expect(api.updateStory.mock.calls.map(call => call[0])).toEqual(['s-a', 's-a']); expect(await api.updateStory.mock.calls[1][1]({})).toMatchObject({ status: '已完结' });
  expect((await api.updateStory.mock.calls[1][1]({})).updatedAt).toBeGreaterThan(1);
});
it('shows a real empty directory when the upstream filter removes every character', async () => {
  await render(); await render([]); expect(document.querySelector('h2')).toBeNull(); expect(host).toHaveTextContent('没有符合条件的角色');
});
it('uses a late records response only for the currently selected character', async () => {
  let finish!: (value: SummaryItem[]) => void; api.summaries.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); await click('总结'); expect(host).toHaveTextContent('加载中…'); expect(host).not.toHaveTextContent('还没有总结');
  await click('选择角色b'); await act(async () => finish(summaries)); expect(host).toHaveTextContent('b 的总结全文'); expect(host).not.toHaveTextContent('a 的总结全文');
});
it('invalidates a late record request after a vault remount', async () => {
  let finish!: (value: SummaryItem[]) => void; api.summaries.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); await click('总结'); setCurrentVaultId('review-next-vault'); setActiveVault(null); api.summaries.mockResolvedValue([]); await render(characters, 'next-vault'); await click('总结');
  await act(async () => finish(summaries)); expect(host).toHaveTextContent('还没有总结'); expect(host).not.toHaveTextContent('a 的总结全文');
});
it('does not replace a remembered long-document position with the clamped loading placeholder', async () => {
  const session = getReviewSession(); session.selectedId = 'a'; session.tab = 'volume'; session.characters.set('a', { scroll: { volume: 845 } });
  let finish!: (value: SummaryItem[]) => void; api.summaries.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); const pane = document.querySelector<HTMLElement>('[data-review-scroll]')!;
  await act(async () => { pane.scrollTop = 0; pane.dispatchEvent(new Event('scroll')); });
  await act(async () => finish(summaries)); expect(pane.scrollTop).toBe(845);
});
it('lets the toolbar await saves and only records navigation position after success', async () => {
  await render(); await click('故事'); await click('阅读 故事a');
  await act(async () => api.ready.mock.calls.at(-1)![0](true));
  const pane = document.querySelector<HTMLElement>('[data-review-scroll]')!; pane.scrollTop = 351;
  api.flush.mockRejectedValueOnce(new Error('不能保存'));
  expect(reviewRef.current).not.toBeNull(); await expect(reviewRef.current!.flushPendingSave()).rejects.toThrow('不能保存');
  expect(getReviewSession().characters.get('a')?.storyScroll).toBeUndefined();
  await reviewRef.current!.flushPendingSave(); expect(getReviewSession().characters.get('a')?.storyScroll).toBe(351);
});
