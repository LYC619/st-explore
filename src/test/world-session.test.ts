import { expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { WorldRepo } from '@/play/storage/world-repo';
import { createWorld, stepWorld } from '@/play/world/simulation';
import { WorldSession } from '@/play/world/session';
import type { StepResult } from '@/play/world/schema';

it('暂停后到达的 Worker 结果不能写入；同时拒绝重复推进', async () => {
  const repo = new WorldRepo(createMemFs()), first = await repo.create('延迟', createWorld(73));
  let deliver!: (result: StepResult) => void;
  const session = new WorldSession(repo, first, () => new Promise(resolve => { deliver = resolve; }));
  const running = session.step();
  await expect(session.step()).rejects.toThrow('本轮尚未结束');
  session.stop(); deliver(stepWorld(first.state));
  await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  expect((await repo.load(first.worldId)).commits).toHaveLength(1);
});
it('持久化失败后显示状态与当前提交保持原样', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs), first = await repo.create('磁盘满', createWorld(73));
  fs.rename = async () => { throw new Error('磁盘满'); };
  const session = new WorldSession(repo, first, async state => stepWorld(state));
  await expect(session.step()).rejects.toThrow('磁盘满');
  expect(session.current).toBe(first);
});
