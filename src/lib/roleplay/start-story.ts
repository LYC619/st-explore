import { buildStoryFromSession, getRoleplayPreferences, readCharacterInQueue, withArchiveStoryLock, type ArchiveMetaRecord } from '@/lib/archive-db';
import { getCurrentRepo } from '@/lib/repo';
import { getVaultEpoch } from '@/lib/vault/active';
import { normalizeCharacterCard } from '@/lib/adapters/st';
import type { ArchiveStory } from '@/types/archive';

/** A new story starts empty; the original Tavern expands and saves its selected greeting. */
export async function startCharacterStory(characterId: string): Promise<string> {
  const epoch = getVaultEpoch(), stories = getCurrentRepo<ArchiveStory>('archiveStories');
  const current = () => getVaultEpoch() === epoch;
  const preferences = await getRoleplayPreferences(getCurrentRepo<ArchiveMetaRecord>('archiveMeta'));
  if (!current()) throw new Error('文件库已切换，请重新打开角色');
  return readCharacterInQueue(characterId, async character => {
    if (!character) throw new Error('角色已删除');
    const normalized = normalizeCharacterCard(character.card);
    const name = typeof preferences.tavern?.username === 'string' && preferences.tavern.username.trim() ? preferences.tavern.username : 'User';
    const story = buildStoryFromSession({ id: crypto.randomUUID(), title: `${character.name} · 新聊天`, createdAt: Date.now(),
      user: { name }, character: { name: normalized.name || character.name }, messages: [],
      rawMetadata: { chat_metadata: { ste_pending_initial_greeting: true } } }, characterId);
    await withArchiveStoryLock(story.id, async () => {
      if (!current()) throw new Error('文件库已切换，新聊天未创建');
      await stories.put(story);
    });
    if (!current()) throw new Error('文件库已切换，新聊天保留在原文件库');
    return story.id;
  }, { isCurrent: current });
}
