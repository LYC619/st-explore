import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StoryRecordsView } from '@/components/character/StoryRecordsView';
import type { ArchiveStory } from '@/types/archive';
import type { SummaryItem } from '@/types/summary';
const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/summary-db', () => ({ getAllSummaries: list, saveSummary: vi.fn() }));
const stories = ['a', 'b'].map(id => ({ id, title: `故事${id}`, characterId: 'c', branches: [] } as unknown as ArchiveStory));
const records = stories.map(story => ({ id: `r-${story.id}`, bookId: story.id, kind: 'volume', title: `总结${story.id}`, content: `正文${story.id}`, updatedAt: 1, createdAt: 1 } as SummaryItem));
let root: Root, container: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { list.mockResolvedValue(records); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
async function render(items: ArchiveStory[]) { await act(async () => root.render(<StoryRecordsView stories={items} kind="volume" onGoGenerate={() => {}} />)); }
it('keeps the selected stable story when sorting changes and falls back only after it disappears', async () => {
  await render(stories); expect(container.textContent).toContain('总结a');
  await render([...stories].reverse()); expect(container.textContent).toContain('总结a'); expect(container.textContent).not.toContain('总结b');
  await render([stories[1]]); expect(container.textContent).toContain('总结b'); expect(container.textContent).not.toContain('总结a');
});
it('does not show old story records while a replacement list loads or accept the late source result', async () => {
  let resolve!: (items: SummaryItem[]) => void;
  list.mockReturnValueOnce(new Promise<SummaryItem[]>(done => { resolve = done; }));
  await render(stories); await render([stories[1]]);
  expect(container.textContent).toContain('总结b');
  await act(async () => resolve(records.filter(record => record.bookId === 'a')));
  expect(container.textContent).not.toContain('总结a'); expect(container.textContent).toContain('总结b');
});
it('reports repository failure without claiming an empty story', async () => {
  list.mockRejectedValueOnce(new Error('读取失败'));
  await render(stories); expect(container.textContent).toContain('读取失败');
  expect(container.textContent).not.toContain('这个故事还没有');
});
