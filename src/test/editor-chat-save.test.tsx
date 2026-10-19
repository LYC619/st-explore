import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChatSession } from '@/types/chat';
import type { ArchiveStory } from '@/types/archive';

const fixture = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), toast: vi.fn(), edit: undefined as undefined | ((next: ChatSession) => void) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixture.toast }) }));
vi.mock('@/components/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/GuidedTour', () => ({ GuidedTour: () => null }));
vi.mock('@/components/chat/ChatWorkbench', () => ({ ChatWorkbench: ({ onSessionChange }: { onSessionChange: (next: ChatSession) => void }) => { fixture.edit = onSessionChange; return null; } }));
vi.mock('@/lib/archive-db', async original => ({ ...await original<typeof import('@/lib/archive-db')>(),
  getArchiveStory: fixture.get, updateArchiveStory: fixture.update, getAllArchiveStories: async () => [],
}));
import Index from '@/pages/Index';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('serializes delayed autosaves and rejects a genuine concurrent reply without overwriting it', async () => {
  vi.useFakeTimers();
  const initial: ChatSession = { id: 's', title: 'test', messages: [{ id: 'm', role: 'assistant', content: 'initial' }], user: { name: 'u' }, character: { name: 'c' }, createdAt: 1 };
  let story = { id: 'story', title: 'test', session: initial, markers: [], favorites: [], createdAt: 1, updatedAt: 1 } as unknown as ArchiveStory;
  fixture.get.mockImplementation(async () => story);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  fixture.update.mockImplementation(async (_id, update) => {
    if (first) { first = false; await gate; }
    story = { ...story, ...update(story) }; return story;
  });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const edited = (text: string) => ({ ...initial, messages: [{ ...initial.messages[0], content: text }] });
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/chat?storyId=story']}><Index /></MemoryRouter>));
    await act(async () => fixture.edit!(edited('first')));
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    await act(async () => fixture.edit!(edited('second')));
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    expect(fixture.update).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(fixture.update).toHaveBeenCalledTimes(2);
    expect(story.session.messages[0].content).toBe('second');
    expect(fixture.toast).not.toHaveBeenCalled();
    story = { ...story, session: edited('background reply') };
    await act(async () => fixture.edit!(edited('stale editor')));
    await act(async () => { await vi.advanceTimersByTimeAsync(850); });
    expect(story.session.messages[0].content).toBe('background reply');
    expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '聊天处理内容尚未保存' }));
  } finally { await act(async () => root.unmount()); container.remove(); }
});
