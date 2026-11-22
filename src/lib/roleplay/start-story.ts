import { buildStoryFromSession, getRoleplayPreferences, readCharacterInQueue, withArchiveStoryLock, type ArchiveMetaRecord } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import { normalizeCharacterCard } from '@/lib/adapters/st';
import type { ArchiveStory } from '@/types/archive';
import type { ChatMessage } from '@/types/chat';

export interface StartCharacterStoryOptions {
  /** 指定用第几条开场白开聊：0 = 默认开场白，1..N = 备选开场白 */
  greetingIndex?: number;
}

export function expandGreetingMacros(text: string, userName: string, charName: string): string {
  return text
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/\{\{char\}\}/gi, charName);
}

/**
 * 新建角色聊天故事：
 * - 未指定 greetingIndex 时保留空消息并由内嵌酒馆按默认开场展开；
 * - 指定 greetingIndex 时直接以所选开场白建立首楼，并仅将非空开场白写入候选供酒馆内左右切换。
 */
export async function startCharacterStory(
  characterId: string,
  options?: StartCharacterStoryOptions,
): Promise<string> {
  const epoch = getVaultEpoch();
  const stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const current = () => getVaultEpoch() === epoch;
  const preferences = await getRoleplayPreferences(getCurrentRepo<ArchiveMetaRecord>('archiveMeta'));
  if (!current()) throw new Error('文件库已切换，请重新打开角色');

  return readCharacterInQueue(characterId, async (character) => {
    if (!character) throw new Error('角色已删除');
    const normalized = normalizeCharacterCard(character.card);
    const displayTitleName = character.displayMeta?.name?.trim() || normalized.name || character.name;
    const charName = displayTitleName;
    const userName = typeof preferences.tavern?.username === 'string' && preferences.tavern.username.trim()
      ? preferences.tavern.username.trim()
      : 'User';

    const greetingIndex = options?.greetingIndex;
    let messages: ChatMessage[] = [];
    let title = `${displayTitleName} · 新聊天`;
    let pendingInitialGreeting = true;

    if (greetingIndex !== undefined) {
      const rawGreetings = [normalized.firstMessage, ...normalized.alternateGreetings];
      if (!Number.isInteger(greetingIndex) || greetingIndex < 0 || greetingIndex >= rawGreetings.length) {
        throw new Error('所选开场白不存在，请先保存开场白后再试');
      }
      const expandedGreetings = rawGreetings.map((g) => expandGreetingMacros(g, userName, charName));
      const chosen = expandedGreetings[greetingIndex] ?? '';
      if (!chosen.trim()) {
        throw new Error('这条开场白还是空的，先写点内容再来开聊吧');
      }
      const nonEmptyEntries = expandedGreetings
        .map((text, idx) => ({ text, idx }))
        .filter((entry) => entry.text.trim().length > 0);
      const nonEmptySwipes = nonEmptyEntries.map((entry) => entry.text);
      const resolvedSwipeId = Math.max(
        0,
        nonEmptyEntries.findIndex((entry) => entry.idx === greetingIndex),
      );
      const messageId = crypto.randomUUID();
      const now = Date.now();
      messages = [
        {
          id: messageId,
          role: 'assistant',
          is_user: false,
          name: charName,
          content: chosen,
          timestamp: now,
          rawData: {
            name: charName,
            is_user: false,
            mes: chosen,
            send_date: now,
            swipes: nonEmptySwipes,
            swipe_id: resolvedSwipeId,
          },
        },
      ];
      title = greetingIndex === 0
        ? `${displayTitleName} · 默认开场`
        : `${displayTitleName} · 备选开场 ${greetingIndex}`;
      pendingInitialGreeting = false;
    }

    const story = buildStoryFromSession(
      {
        id: crypto.randomUUID(),
        title,
        createdAt: Date.now(),
        user: { name: userName },
        character: { name: charName },
        messages,
        rawMetadata: {
          chat_metadata: pendingInitialGreeting ? { ste_pending_initial_greeting: true } : {},
        },
      },
      characterId,
    );

    await withArchiveStoryLock(story.id, async () => {
      if (!current()) throw new Error('文件库已切换，新聊天未创建');
      await stories.put(story);
    });
    if (!current()) throw new Error('文件库已切换，新聊天保留在原文件库');
    return story.id;
  }, { isCurrent: current });
}
