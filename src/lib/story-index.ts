import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { computeStoryTimeRange } from './story-meta';

export interface StoryChatIndex {
  characterName: string;
  avatar?: string;
  lines: { branchId: string | null; name: string; updatedAt: number; fileName?: string; aliases: string[] }[];
}

/** Display/identity projection only. Never save it as an ArchiveStory. */
export type StoryIndexEntry = Omit<ArchiveStory, 'session' | 'branches'> & {
  floorCount: number;
  storyTimeRange?: { startedAt?: number; endedAt?: number };
  branchIndex?: { id: string; name: string }[];
  chatIndex?: StoryChatIndex;
};

function chatIndex(story: ArchiveStory): StoryChatIndex {
  const line = (session: ChatSession, branchId: string | null, name: string, updatedAt: number) => {
    const metadata = session?.rawMetadata?.ste_catalog;
    return { branchId, name, updatedAt,
      fileName: typeof metadata?.fileName === 'string' ? metadata.fileName : undefined,
      aliases: Array.isArray(metadata?.aliases) ? metadata.aliases.filter((alias: unknown): alias is string => typeof alias === 'string') : [],
    };
  };
  const avatar = story.session.rawMetadata?.ste_catalog?.avatar;
  return { characterName: story.session.character?.name ?? '',
    avatar: typeof avatar === 'string' ? avatar : undefined,
    lines: [line(story.session, null, story.title, story.updatedAt),
      ...(Array.isArray(story.branches) ? story.branches : []).filter(branch => branch && typeof branch.id === 'string')
        .map(branch => line(branch.session, branch.id, branch.name, branch.updatedAt))],
  };
}

/** Accept full IDB records and already projected vault records without restoring bodies. */
export function toStoryIndex(story: ArchiveStory): StoryIndexEntry {
  const { session, branches, ...rest } = story as ArchiveStory & StoryIndexEntry;
  return {
    ...rest,
    storyTimeRange: rest.storyTimeRange ?? computeStoryTimeRange(session?.messages ?? []),
    floorCount: rest.floorCount ?? session?.messages?.length ?? 0,
    branchIndex: (Array.isArray(branches) ? branches.filter(branch => branch && typeof branch.id === 'string').map(({ id, name }) => ({ id, name })) : undefined) ?? rest.branchIndex ?? [],
    chatIndex: session ? chatIndex(story) : rest.chatIndex,
  };
}
