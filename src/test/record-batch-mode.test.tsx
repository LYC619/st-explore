import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { StoryRecordsView } from '@/components/character/StoryRecordsView';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { buildStoryFromSession } from '@/lib/archive-db';
import type { SummaryItem } from '@/types/summary';
import type { ArchiveStory } from '@/types/archive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = '';
  setActiveVault(null);
});
const button = (name: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === name);
const choices = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label^="选择记录 "]')];
async function click(element: HTMLElement | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
async function setup(characterId: string | undefined = 'c') {
  const vault = createVault(createMemFs());
  setActiveVault(vault);
  const makeStory = (id: string): ArchiveStory => ({
    ...buildStoryFromSession({ id, title: id, character: { name: '角色' }, user: { name: '玩家' }, messages: [], createdAt: 1 }, characterId), id,
  });
  const stories = [makeStory('a'), makeStory('b')];
  for (const story of stories) {
    await vault.repo('archiveStories').put(story);
    for (const kind of ['volume', 'diary'] as const) {
      for (const i of [1, 2]) await vault.repo<SummaryItem>('summaries').put({
        id: `${story.id}-${kind}-${i}`, title: `${kind}${i}`, bookId: story.id, bookTitle: story.title, kind,
        content: `正文${i}`, floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1,
      });
    }
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const render = async (items = stories, kind: 'volume' | 'diary' = 'volume') => {
    await act(async () => root!.render(<StoryRecordsView stories={items} kind={kind} onGoGenerate={() => {}} />));
  };
  return { stories, render };
}

it.each(['volume', 'diary'] as const)('keeps %s browsing clean and clears selection when batch management is done', async kind => {
  const { stories, render } = await setup();
  await render(stories, kind);
  expect(choices()).toHaveLength(0);
  expect(button('加入世界书（0）')).toBeUndefined();
  await click(button('批量管理'));
  expect(choices()).toHaveLength(2);
  expect(button('加入世界书（0）')).toBeUndefined();
  await click(choices()[0]);
  expect(button('加入世界书（1）')).toBeTruthy();
  expect(document.querySelector('[aria-label="全选当前记录"]')).toHaveAttribute('data-state', 'indeterminate');
  await click(document.querySelector<HTMLButtonElement>('[aria-label="全选当前记录"]'));
  expect(choices().every(choice => choice.dataset.state === 'checked')).toBe(true);
  expect(button('加入世界书（2）')).toBeTruthy();
  await click(button('完成'));
  expect(choices()).toHaveLength(0);
  expect(button('加入世界书（2）')).toBeUndefined();
  await click(button('批量管理'));
  expect(choices().every(choice => choice.dataset.state === 'unchecked')).toBe(true);
});

it('leaves batch mode when switching kind or replacing the selected story', async () => {
  const { stories, render } = await setup();
  await render(); await click(button('批量管理')); await click(choices()[0]);
  await render(stories, 'diary');
  expect(choices()).toHaveLength(0);
  await click(button('批量管理')); expect(choices().every(choice => choice.dataset.state === 'unchecked')).toBe(true);
  await click(choices()[0]); await render([stories[1]], 'diary');
  expect(choices()).toHaveLength(0);
  await click(button('批量管理')); expect(choices().every(choice => choice.dataset.state === 'unchecked')).toBe(true);
});

it('does not offer inert selection for records without a character', async () => {
  const { stories, render } = await setup();
  await render(stories.map(story => ({ ...story, characterId: undefined })));
  expect(choices()).toHaveLength(0);
  expect(button('批量管理')).toBeUndefined();
  expect(button('手动录入')).toBeTruthy();
});
