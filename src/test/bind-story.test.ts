import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB, closeDB } from '@/lib/idb';
import { bindSessionToCharacter } from '@/lib/bind-story';
import { getArchiveStory } from '@/lib/archive-db';
import type { ChatSession } from '@/types/chat';

beforeEach(() => {
  closeDB();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

function seed(store: string, item: Record<string, unknown>): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

const session: ChatSession = {
  id: 's1',
  title: '绑定测试',
  messages: [
    { id: 'm1', role: 'user', content: 'hi' },
    { id: 'm2', role: 'assistant', content: 'hello（改过）' },
  ],
  character: { name: 'B' },
  user: { name: 'A' },
  createdAt: 1,
};

describe('bindSessionToCharacter（阶段5：绑定=未绑定故事补 characterId）', () => {
  it('绑定正在编辑的分支保留主线，后台新回复不能被旧绑定快照覆盖', async () => {
    const main = { ...session, title: '主线', messages: [session.messages[0]] };
    await seed('archiveStories', { id: 'branch-story', title: '主线', session: main, markers: [],
      branches: [{ id: 'b', name: '分支', session, markers: [], favorites: [], createdAt: 1, updatedAt: 1 }],
      meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1 });
    const edited = { ...session, title: '分支改名', messages: [...session.messages, { id: 'new', role: 'assistant' as const, content: '新内容' }] };
    const result = await bindSessionToCharacter({ characterId: 'character', storyId: 'branch-story', branchId: 'b',
      expectedSession: session, session: edited, markers: [], favorites: [] });
    expect(result.story.session).toEqual(main); expect(result.story.title).toBe('主线');
    expect(result.story.branches?.[0].session).toEqual(edited);
    await expect(bindSessionToCharacter({ characterId: 'other', storyId: 'branch-story', branchId: 'b',
      expectedSession: session, session, markers: [], favorites: [] })).rejects.toThrow('新的聊天内容');
    expect((await getArchiveStory('branch-story'))?.branches?.[0].session).toEqual(edited);
  });
  it('已有未绑定故事：原地升级（同 id），当前编辑态落库，成果计数不重指', async () => {
    const now = Date.now();
    await seed('archiveStories', {
      id: 'astory_u1',
      title: '旧标题',
      session: { ...session, messages: [session.messages[0]] }, // 库里是旧快照
      markers: [],
      meta: { modelsUsed: [], playTimeMs: null },
      createdAt: now,
      updatedAt: now,
    });
    // 未绑定期间的成果本就挂在故事 id 上
    await seed('summaries', { id: 'sm1', bookId: 'astory_u1', bookTitle: '旧标题', kind: 'volume', title: '卷一', floorStart: 0, floorEnd: 1, content: 'x', createdAt: now, updatedAt: now });
    await seed('stories', { id: 'tr1', bookId: 'astory_u1', title: '树', nodes: [], createdAt: now, updatedAt: now });

    const { story, carried } = await bindSessionToCharacter({
      characterId: 'char_1',
      storyId: 'astory_u1',
      session,
      markers: [{ messageId: 'm2', messageIndex: 1, title: '第一章', createdAt: now } as never],
      favorites: ['m2'],
    });

    expect(story.id).toBe('astory_u1'); // 同 id 原地升级，成果无需重指
    expect(story.characterId).toBe('char_1');
    expect(story.title).toBe('绑定测试');
    expect(carried).toBe(2);

    const persisted = await getArchiveStory('astory_u1');
    expect(persisted?.characterId).toBe('char_1');
    expect(persisted?.session.messages).toHaveLength(2); // 最新编辑态已落库
    expect(persisted?.favorites).toEqual(['m2']);
  });

  it('storyId 为 null（示例数据等未落库会话）：新建绑定故事，carried=0', async () => {
    const { story, carried } = await bindSessionToCharacter({
      characterId: 'char_2',
      storyId: null,
      session,
      markers: [],
      favorites: [],
    });
    expect(story.characterId).toBe('char_2');
    expect(carried).toBe(0);
    const persisted = await getArchiveStory(story.id);
    expect(persisted?.session.messages).toHaveLength(2);
  });
});
