import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { StoryRecordsView } from '@/components/character/StoryRecordsView';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
import type { SummaryItem } from '@/types/summary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; setActiveVault(null); });
async function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text);
  expect(button, text).toBeTruthy(); await act(async () => button!.click());
}
async function input(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it.each(['volume', 'diary'] as const)('edits %s in character details and persists after reopening the vault', async kind => {
  const fs = createMemFs(), vault = createVault(fs); setActiveVault(vault);
  const story = buildStoryFromSession({ id: 'fixture', title: '合成故事', character: { name: 'c' }, user: { name: 'u' }, messages: [], createdAt: 1 }, 'c');
  await vault.repo('archiveStories').put(story);
  const item: SummaryItem = { id: 'record', bookId: story.id, bookTitle: story.title, kind, title: '原标题', content: '原记录', floorStart: 0, floorEnd: 49, volumeNumber: 2, createdAt: 1, updatedAt: 1, genParams: { model: 'fixture' } };
  await vault.repo('summaries').put(item);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<StoryRecordsView stories={[story]} kind={kind} onGoGenerate={() => {}} />));
  await click('编辑记录');
  await input('记录标题', '修订标题');
  await input('记录正文', '修订后的合成记录');
  await click('保存修改');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount());
  const reopened = createVault(fs); setActiveVault(reopened);
  expect(await reopened.repo('summaries').get(item.id)).toMatchObject({ title: '修订标题', content: '修订后的合成记录', floorStart: 0, floorEnd: 49, volumeNumber: 2, genParams: item.genParams });
  root = createRoot(host); await act(async () => root.render(<StoryRecordsView stories={[story]} kind={kind} onGoGenerate={() => {}} />));
  expect(host.textContent).toContain('修订后的合成记录');
});
