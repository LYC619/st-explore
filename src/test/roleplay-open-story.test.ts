import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveStory } from '@/types/archive';
import { setActiveVault } from '@/lib/vault/active';
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/archive-db', async actual => ({ ...await actual<typeof import('@/lib/archive-db')>(), getArchiveStory: read }));
import { prepareStoryPlay } from '@/lib/roleplay/open-story';
const story = { id: 'story /1', lastViewedBranchId: 'branch /1', branches: [{ id: 'branch /1', session: { messages: [] } }], session: { messages: [] } } as unknown as ArchiveStory;
afterEach(() => vi.clearAllMocks());
describe('existing story chat entry', () => {
  it('restores the last branch but can explicitly open main, without creating a story', async () => {
    read.mockResolvedValue(story);
    expect(await prepareStoryPlay(story.id)).toEqual({ storyId: story.id, branchId: 'branch /1', path: '/play/story%20%2F1?branch=branch%20%2F1' });
    expect(await prepareStoryPlay(story.id, null)).toEqual({ storyId: story.id, branchId: null, path: '/play/story%20%2F1?branch=' });
  });
  it('rejects missing stories and explicit missing branches', async () => {
    read.mockResolvedValue(story); await expect(prepareStoryPlay(story.id, 'deleted')).rejects.toThrow('分支不存在');
    read.mockResolvedValue(undefined); await expect(prepareStoryPlay('deleted')).rejects.toThrow('故事不存在');
  });
  it('rejects a lookup completed after switching vaults', async () => {
    read.mockImplementation(async () => { setActiveVault(null); return story; });
    await expect(prepareStoryPlay(story.id)).rejects.toThrow('文件库已切换');
  });
});
