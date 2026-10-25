import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SummaryWorkspace } from '@/components/organize/SummaryWorkspace';
import { StoryRecordsView } from '@/components/character/StoryRecordsView';
import { CaptureRecordDialog } from '@/components/summary/CaptureRecordDialog';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
import type { SummaryItem } from '@/types/summary';
import { summaryToObsidian } from '@/lib/obsidian-export';
import { SummaryGallery } from '@/components/summary/SummaryGallery';
import { SavedSummaryList } from '@/components/summary/SavedSummaryList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; setActiveVault(null); vi.restoreAllMocks(); });
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
async function fill(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  expect(el, label).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function setup() {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  const story = buildStoryFromSession({ id: 's', title: '故事', createdAt: 1, character: { name: 'c' }, user: { name: 'u' }, messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `正文${i}` })) });
  await vault.repo('archiveStories').put(story);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
  return { fs, vault, story, host };
}

it.each(['volume', 'diary'] as const)('real %s workspace edits volume, guards metadata-only changes, and persists other category', async kind => {
  const { fs, vault, story } = await setup();
  await act(async () => root!.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SummaryWorkspace story={story} currentBranchId={null} kind={kind} onKindChange={() => {}} /></MemoryRouter>));
  const add = document.querySelector<HTMLButtonElement>('[aria-label="手动添加总结"]')!;
  expect(add.textContent).toContain('手动添加');
  await act(async () => add.click());
  await fill('记录卷号', '2');
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="生成的总结将显示在这里，可自由编辑。"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '手动正文'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('保存').click());
  let saved = (await vault.repo<SummaryItem>('summaries').list())[0];
  expect(saved.volumeNumber).toBe(2);
  await fill('记录卷号', '3');
  await act(async () => button('返回已生成总结').click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => button('继续编辑').click());
  await fill('记录卷数类型', 'other');
  await act(async () => button('返回已生成总结').click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await act(async () => button('继续编辑').click());
  await act(async () => button('保存').click());
  saved = (await vault.repo<SummaryItem>('summaries').list())[0];
  expect(saved).toMatchObject({ volumeCategory: 'other', content: '手动正文' });
  expect(saved.volumeNumber).toBeUndefined();
  const reopened = await createVault(fs).repo<SummaryItem>('summaries').get(saved.id);
  expect(reopened).toMatchObject({ volumeCategory: 'other', content: '手动正文' });
  expect(summaryToObsidian(reopened!)).toContain('volumeCategory: other');
  await act(async () => button('返回已生成总结').click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[title="查看或编辑"]')!.click());
  expect(document.querySelector<HTMLSelectElement>('[aria-label="记录卷数类型"]')!.value).toBe('other');
});

it.each(['volume', 'diary'] as const)('saved and gallery %s lists share stable order, with other last', async kind => {
  const { vault, story, host } = await setup();
  for (const [id, volumeNumber, floorStart, volumeCategory] of [
    ['other', undefined, 0, 'other'], ['two', 2, 0, undefined], ['old', undefined, 8, undefined], ['one', 1, 0, undefined],
  ] as const) await vault.repo<SummaryItem>('summaries').put({ id, title: id, bookId: story.id, bookTitle: story.title, kind,
    content: '正文', volumeNumber, volumeCategory, floorStart, floorEnd: 9, createdAt: 1, updatedAt: id === 'two' ? 999 : 1 });
  for (const component of [
    <SavedSummaryList currentBookId={story.id} refreshKey={0} kind={kind} onAdd={() => {}} onView={() => {}} onRegenerate={() => {}} />,
    <SummaryGallery currentBookId={story.id} refreshKey={0} kind={kind} />,
  ]) {
    await act(async () => root!.render(component));
    const titles = [...host.querySelectorAll('span[title]')].map(element => element.getAttribute('title'));
    expect(titles).toEqual(['one', 'two', 'old', 'other']);
  }
});

it('character capture permits a partial range and defaults a pasted record to all floors', async () => {
  const { vault, story } = await setup();
  const render = () => root!.render(<CaptureRecordDialog storyId={story.id} branchId={null} initialContent="记录正文" onClose={() => {}} onSaved={() => {}} />);
  await act(async () => render());
  await fill('覆盖起始楼', '2'); await fill('覆盖结束楼', '4');
  await act(async () => button('保存并继续添加').click());
  expect((await vault.repo<SummaryItem>('summaries').list())[0]).toMatchObject({ floorStart: 2, floorEnd: 4, rangeDetached: false });
});

it.each(['volume', 'diary'] as const)('character %s records keep volume order after edits', async kind => {
  const { vault, story, host } = await setup();
  for (const n of [2, 1]) await vault.repo<SummaryItem>('summaries').put({ id: `r${n}`, bookId: story.id, bookTitle: story.title, kind, title: `卷${n}`, volumeNumber: n, floorStart: 0, floorEnd: 2, content: '正文', createdAt: n, updatedAt: n * 100 });
  await act(async () => root!.render(<StoryRecordsView stories={[story]} kind={kind} onGoGenerate={() => {}} />));
  expect(host.textContent!.indexOf('卷1')).toBeLessThan(host.textContent!.indexOf('卷2'));
});
