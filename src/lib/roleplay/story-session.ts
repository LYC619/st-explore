import { getCurrentRepo, type Repo } from '@/lib/repo';
import { getBranchLine, updateArchiveStory, updateBranchLine } from '@/lib/archive-db';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession } from '@/types/chat';
import { decodeLiveChat, encodeLiveChat, type LiveChatPayload } from './live-chat';

export interface StorySessionOptions {
  repo?: Repo<ArchiveStory>;
  isCurrent?: () => boolean;
}

export interface StoryCommit {
  storyId: string;
  branchId: string | null;
  previous: ChatSession;
  session: ChatSession;
}

export interface RoleplayStorySession {
  readonly storyId: string;
  readonly branchId: string | null;
  payload(): LiveChatPayload;
  save(payload: unknown, activeUserName?: string): Promise<StoryCommit>;
  flush(): Promise<void>;
  close(): void;
}

/** Key order and absent optional fields are not changes to the stored session. */
function sessionVersion(session: ChatSession): string {
  return JSON.stringify(session, (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

export async function openStorySession(storyId: string, branchId: string | null, options: StorySessionOptions = {}): Promise<RoleplayStorySession> {
  // Capture once: a lazy createRepo proxy could send a delayed write into another vault.
  const repo = options.repo ?? getCurrentRepo<ArchiveStory>('archiveStories');
  const story = await repo.get(storyId);
  if (!story) throw new Error('故事不存在');
  const line = getBranchLine(story, branchId);
  if (!line) throw new Error('故事分支不存在');
  let acknowledged = structuredClone(line.session);
  let version = sessionVersion(acknowledged);
  let closed = false;
  let tail = Promise.resolve();
  let lastError: unknown;

  function assertCurrent() {
    if (closed) throw new Error('游玩会话已关闭，迟到的保存已停止');
    if (options.isCurrent && !options.isCurrent()) throw new Error('文件库或游玩会话已切换，迟到的保存已停止');
  }

  return {
    storyId, branchId,
    payload: () => encodeLiveChat(acknowledged),
    save(payload, activeUserName) {
      const incoming = structuredClone(payload);
      const operation = tail.then(async () => {
        assertCurrent();
        const previous = structuredClone(acknowledged);
        const saved = await updateArchiveStory(storyId, current => {
          assertCurrent();
          const currentLine = getBranchLine(current, branchId);
          if (!currentLine) throw new Error('故事分支不存在');
          if (sessionVersion(currentLine.session) !== version) {
            throw new Error('这条故事分支已被其他编辑修改，请重新打开后继续；当前正文未覆盖');
          }
          const session = decodeLiveChat(incoming, currentLine.session, activeUserName);
          const indices = new Map(session.messages.map((message, index) => [message.id, index]));
          return updateBranchLine(current, branchId, {
            session,
            markers: currentLine.markers.filter(marker => indices.has(marker.messageId))
              .map(marker => ({ ...marker, messageIndex: indices.get(marker.messageId)! })),
            ...(currentLine.favorites ? { favorites: currentLine.favorites.filter(id => indices.has(id)) } : {}),
          });
        }, repo);
        if (!saved) throw new Error('故事不存在');
        acknowledged = structuredClone(getBranchLine(saved, branchId)!.session);
        version = sessionVersion(acknowledged);
        return { storyId, branchId, previous, session: structuredClone(acknowledged) };
      });
      // A failed disk write remains visible to flush(), but does not block an explicit retry.
      tail = operation.then(() => { lastError = undefined; }, error => { lastError = error; });
      return operation;
    },
    async flush() {
      await tail;
      if (lastError !== undefined) throw lastError;
    },
    close() { closed = true; },
  };
}
