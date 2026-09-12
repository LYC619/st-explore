import { describe, expect, it } from 'vitest';
import { buildStoryFromSession } from '@/lib/archive-db';
import { openStorySession } from '@/lib/roleplay/story-session';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import type { ArchiveStory } from '@/types/archive';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('roleplay saving through a file vault', () => {
  it('accepts the next save after a chat catalog read overlaps the first greeting write', async () => {
    const fs = createMemFs();
    const reached = deferred(), release = deferred();
    let hold = false;
    const vault = createVault({ ...fs, async writeText(path, text) {
      if (hold && path.endsWith('/故事.json')) { reached.resolve(); await release.promise; }
      await fs.writeText(path, text);
    } });
    const repo = vault.repo<ArchiveStory>('archiveStories');
    const story = buildStoryFromSession({ id: 'session', title: '新聊天', createdAt: 1,
      user: { name: '旅人' }, character: { name: '林' }, messages: [],
      rawMetadata: { chat_metadata: { ste_pending_initial_greeting: true } },
    });
    await repo.put(story);
    const live = await openStorySession(story.id, null, { repo });
    const payload = live.payload();
    delete payload[0].chat_metadata!.ste_pending_initial_greeting;
    payload.push({ name: '林', is_user: false, mes: '请进。',
      extra: { ste_runtime: { messageId: 'greeting', role: 'assistant' } } });
    hold = true;
    const firstSave = live.save(payload);
    await reached.promise;
    // The catalog is allowed to see the old snapshot while a write is in progress.
    expect((await repo.list())[0].session.messages).toHaveLength(0);
    hold = false; release.resolve();
    await firstSave;
    payload[1].mes = '请进，外面在下雨。';
    await expect(live.save(payload)).resolves.toMatchObject({ storyId: story.id });
    expect((await repo.get(story.id))?.session.messages[0].content).toBe('请进，外面在下雨。');
  });

  it.each([false, true])('does not let a late %s light read repopulate a cache after a completed write', async light => {
    const fs = createMemFs();
    const reached = deferred(), release = deferred();
    let hold = false;
    const vault = createVault({ ...fs, async readText(path) {
      const text = await fs.readText(path);
      if (hold && path.endsWith('/故事.json')) { reached.resolve(); await release.promise; }
      return text;
    } });
    const repo = vault.repo<ArchiveStory>('archiveStories');
    const story = buildStoryFromSession({ id: 'session', title: '旧标题', createdAt: 1,
      user: { name: '旅人' }, character: { name: '林' }, messages: [],
    });
    await repo.put(story);
    hold = true;
    const oldRead = light ? repo.listLight!() : repo.get(story.id);
    await reached.promise;
    hold = false;
    // Keeping the same title avoids moving directories; only the record is changed.
    await repo.put({ ...story, rating: 8 });
    release.resolve();
    await oldRead;
    const current = light ? (await repo.listLight!())[0] : await repo.get(story.id);
    expect(current?.rating).toBe(8);
  });
});
