import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { StoryIndexEntry } from '@/lib/archive-index';
import type { SummaryItem } from '@/types/summary';

const api = vi.hoisted(() => ({ summaries: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/summary-db', () => ({ getAllSummaries: api.summaries, saveSummary: vi.fn() }));
vi.mock('@/lib/story-tree-db', () => ({ getAllStoryTrees: vi.fn(async () => []) }));
vi.mock('@/components/ai-tools', () => ({ loadAPIConfig: () => ({ apiKey: '' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock('@/components/character/InlineStoryReader', () => ({ InlineStoryReader: () => null }));

import { NotesSection } from '@/components/character/NotesSection';
import { StoryRecordsView } from '@/components/character/StoryRecordsView';
import { ReviewCharacterContent } from '@/components/library/review/ReviewCharacterContent';
import { ReviewEdits } from '@/components/library/review/ReviewEdits';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const markdown = '## 相遇\n\n**重要线索**\n\n- 沿河寻找\n- 返回村庄';
const character = { id: 'c', name: '旅人', card: { name: '旅人' }, tags: [], status: '未开始', notes: [{ id: 'n', body: markdown, at: 1 }], createdAt: 1, updatedAt: 1 } as ArchiveCharacter;
const story = { id: 's', characterId: 'c', title: '森林', session: { id: 'session-s', title: '森林', character: { name: '旅人' }, user: { name: '玩家' }, messages: [], createdAt: 1 }, markers: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1 } as ArchiveStory;
const summary = { id: 'r', bookId: 's', bookTitle: '森林', title: '第一卷', kind: 'volume', content: markdown, floorStart: 0, floorEnd: 1, createdAt: 1, updatedAt: 1 } as SummaryItem;

async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
function expectMarkdown(scope: ParentNode) {
  expect(scope.querySelector('h2')).toHaveTextContent('相遇');
  expect(scope.querySelector('strong')).toHaveTextContent('重要线索');
  expect(scope.querySelectorAll('li')).toHaveLength(2);
}

beforeEach(() => {
  vi.clearAllMocks(); api.summaries.mockResolvedValue([summary]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('renders detail notes as Markdown and keeps their source in the editor', async () => {
  await render(<NotesSection notes={character.notes!} onChange={vi.fn()} />);
  expectMarkdown(host);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="编辑备注"]')!.click());
  expect(document.querySelector('textarea')).toHaveValue(markdown);
});

it.each(['volume', 'diary'] as const)('renders %s Markdown before and after expanding a detail record', async kind => {
  api.summaries.mockResolvedValue([{ ...summary, kind }]);
  await render(<StoryRecordsView stories={[story]} kind={kind} onGoGenerate={vi.fn()} />);
  expectMarkdown(host);
  await act(async () => host.querySelector<HTMLElement>('strong')!.click());
  expectMarkdown(host);
});

it('renders review notes as Markdown and keeps their source in the editor', async () => {
  await render(<ReviewEdits character={character} notesVisible onCharacterChange={vi.fn()} />);
  expectMarkdown(host);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '编辑备注')!.click());
  expect(document.querySelector('textarea')).toHaveValue(markdown);
});

it('renders overview notes and summary excerpts as Markdown without discarding the document tail', async () => {
  const tail = '\n\n' + '沿途记录\n\n'.repeat(40) + '**最后一段**';
  await render(<ReviewCharacterContent
    character={{ ...character, notes: [{ ...character.notes![0], body: markdown + tail }] }}
    stories={[story as unknown as StoryIndexEntry]} summaries={[{ ...summary, content: markdown + tail }]}
    tab="overview" loading={false} error={null} onRetry={vi.fn()} onTabChange={vi.fn()}
    onStoryChange={vi.fn()} onCharacterChange={vi.fn()} onStoriesChange={vi.fn()}
    onOpenEditor={vi.fn()} readerRef={createRef()} onReaderReady={vi.fn()} restoreFloor
  />);
  expect(host.querySelectorAll('h2')).toHaveLength(2);
  expect([...host.querySelectorAll('strong')].filter(node => node.textContent === '最后一段')).toHaveLength(2);
});
