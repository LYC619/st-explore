import { describe, expect, it } from 'vitest';
import type { Repo } from '@/lib/repo';
import type { ArchiveStory } from '@/types/archive';
import { buildStoryFromSession, updateArchiveStory } from '@/lib/archive-db';
import { openStorySession } from '@/lib/roleplay/story-session';

function fixture() {
  const initial = buildStoryFromSession({ id: 'session', title: '故事', createdAt: 1,
    character: { name: '林' }, user: { name: '旅人' },
    messages: [{ id: 'm1', role: 'user', content: '开门' }, { id: 'm2', role: 'assistant', content: '请进' }],
  });
  initial.id = 'story';
  initial.favorites = ['m2'];
  initial.markers = [{ messageId: 'm2', messageIndex: 1, title: '初见', createdAt: 1 }];
  initial.branches = [{ id: 'branch', name: '另一种发展', session: { ...structuredClone(initial.session), id: 'branch-session' }, markers: [], createdAt: 1, updatedAt: 1 }];
  let stored = structuredClone(initial);
  let fail = false;
  let writes = 0;
  const repo: Repo<ArchiveStory> = {
    list: async () => [structuredClone(stored)], listLight: async () => [structuredClone(stored)],
    get: async id => id === stored.id ? structuredClone(stored) : undefined,
    put: async item => { if (fail) throw new Error('磁盘写入失败'); stored = structuredClone(item); writes++; },
    remove: async () => {},
  };
  return { repo, get: () => stored, fail: (value: boolean) => { fail = value; }, writes: () => writes };
}

describe('captured roleplay story session', () => {
  it('uses the existing story queue and retains concurrent rating, bookmarks, and other branch edits', async () => {
    const f = fixture();
    const live = await openStorySession('story', null, { repo: f.repo });
    const payload = live.payload();
    payload[2].mes = '请进，外面在下雨。';
    await updateArchiveStory('story', current => ({ rating: 9, lastFloor: 1, branches: current.branches?.map(b => ({ ...b, name: '新分支名' })) }), f.repo);
    await live.save(payload);
    expect(f.get().session.messages[1].content).toBe('请进，外面在下雨。');
    expect(f.get()).toMatchObject({ rating: 9, lastFloor: 1, favorites: ['m2'] });
    expect(f.get().markers[0].messageId).toBe('m2');
    expect(f.get().branches?.[0].name).toBe('新分支名');
    expect(f.get().branches?.[0].session.messages[1].content).toBe('请进');
  });

  it('rejects a stale writer after another editor changed the same branch', async () => {
    const f = fixture();
    const first = await openStorySession('story', null, { repo: f.repo });
    const second = await openStorySession('story', null, { repo: f.repo });
    const firstPayload = first.payload(); firstPayload[2].mes = '第一个窗口';
    const secondPayload = second.payload(); secondPayload[2].mes = '过期窗口';
    await first.save(firstPayload);
    await expect(second.save(secondPayload)).rejects.toThrow(/已被.*修改/);
    expect(f.get().session.messages[1].content).toBe('第一个窗口');
  });

  it('persists only the selected branch and fails explicitly for a missing branch', async () => {
    const f = fixture();
    await expect(openStorySession('story', 'missing', { repo: f.repo })).rejects.toThrow(/分支不存在/);
    const live = await openStorySession('story', 'branch', { repo: f.repo });
    const payload = live.payload(); payload[2].mes = '分支回复';
    await live.save(payload);
    expect(f.get().session.messages[1].content).toBe('请进');
    expect(f.get().branches?.[0].session.messages[1].content).toBe('分支回复');
    expect(f.get().branches?.[0].session.id).toBe('branch-session');
  });

  it('does not acknowledge failed persistence; flush blocks transition until a successful retry', async () => {
    const f = fixture();
    const live = await openStorySession('story', null, { repo: f.repo });
    const payload = live.payload(); payload[2].mes = '待保存';
    f.fail(true);
    await expect(live.save(payload)).rejects.toThrow('磁盘写入失败');
    await expect(live.flush()).rejects.toThrow('磁盘写入失败');
    expect(f.get().session.messages[1].content).toBe('请进');
    f.fail(false);
    await live.save(payload);
    await live.flush();
    expect(f.get().session.messages[1].content).toBe('待保存');
  });

  it('serializes overlapping saves using immutable incoming snapshots', async () => {
    const f = fixture();
    const live = await openStorySession('story', null, { repo: f.repo });
    const payload = live.payload(); payload[2].mes = '第一次';
    const first = live.save(payload);
    payload[2].mes = '第二次';
    const second = live.save(payload);
    payload[2].mes = '调用后发生的变化';
    await Promise.all([first, second]);
    expect(f.get().session.messages[1].content).toBe('第二次');
    expect(f.writes()).toBe(2);
  });

  it('rejects late writes after closure or a vault session change', async () => {
    const f = fixture();
    let current = true;
    const live = await openStorySession('story', null, { repo: f.repo, isCurrent: () => current });
    current = false;
    await expect(live.save(live.payload())).rejects.toThrow(/已切换/);
    current = true;
    live.close();
    await expect(live.save(live.payload())).rejects.toThrow(/已关闭/);
    expect(f.writes()).toBe(0);
  });

  it('reindexes annotations by stable ID when a message is removed, without transferring them to a different floor', async () => {
    const f = fixture();
    const live = await openStorySession('story', null, { repo: f.repo });
    const payload = live.payload(); payload.splice(1, 1);
    await live.save(payload);
    expect(f.get().favorites).toEqual(['m2']);
    expect(f.get().markers[0]).toMatchObject({ messageId: 'm2', messageIndex: 0 });
  });

  it('rejects saving a branch deleted while the tavern is open', async () => {
    const f = fixture();
    const live = await openStorySession('story', 'branch', { repo: f.repo });
    await updateArchiveStory('story', () => ({ branches: [] }), f.repo);
    await expect(live.save(live.payload())).rejects.toThrow(/分支不存在/);
    expect(f.get().branches).toEqual([]);
  });
});
