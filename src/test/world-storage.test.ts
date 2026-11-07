import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { createWorld, stepWorld } from '@/play/world/simulation';
import { WorldRepo } from '@/play/storage/world-repo';
import { collectFullBackup, importBackup, parseBackupFile, previewBackup } from '@/lib/storage-utils';
import { createVault } from '@/lib/vault/vault-backend';
import { scanVaultFiles } from '@/lib/vault/file-maintenance';

beforeEach(() => { closeDB(); globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange; });
afterEach(() => closeDB());
for (const storage of ['idb', 'vault'] as const) describe(`世界存档 ${storage}`, () => {
  it('完整提交、重开、回放、分支与删除恢复', async () => {
    const fs = storage === 'vault' ? createMemFs() : null, repo = new WorldRepo(fs);
    const first = await repo.create('测试山海', createWorld(73));
    const next = await repo.append(first, stepWorld(first.state), 'step');
    expect((await new WorldRepo(fs).load(first.worldId)).commits.at(-1)).toEqual(next);
    const branch = await repo.fork(first, '雨中支线');
    const rain = await repo.append(branch, stepWorld(branch.state, { type: 'rain', duration: 4 }), 'step');
    expect(rain.state.weather.rainUntil).toBe(4);
    expect((await repo.load(first.worldId)).commits.at(-1)?.state.weather.rainUntil).toBe(0);
    const deleted = await repo.archive(next, true);
    expect((await repo.list()).find(w => w.worldId === first.worldId)?.deleted).toBe(true);
    await repo.archive(deleted, false);
    expect((await repo.load(first.worldId)).commits.at(-1)?.deleted).toBe(false);
  });
  it('拒绝过期与并发写入，不丢弃已落盘轮次', async () => {
    const fs = storage === 'vault' ? createMemFs() : null, repo = new WorldRepo(fs);
    const first = await repo.create('竞争写入', createWorld(73));
    const result = stepWorld(first.state);
    const writes = await Promise.allSettled([repo.append(first, result, 'step'), new WorldRepo(fs).append(first, result, 'step')]);
    expect(writes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.load(first.worldId)).commits).toHaveLength(2);
  });
  it('导出后重导入为独立世界，校验损坏记录', async () => {
    const repo = new WorldRepo(storage === 'vault' ? createMemFs() : null);
    const first = await repo.create('原世界', createWorld(9));
    const bundle = await repo.export(first.worldId);
    const imported = await repo.import(bundle);
    expect(imported.worldId).not.toBe(first.worldId);
    expect(imported.state).toEqual(first.state);
    const broken = JSON.parse(bundle); broken.commits[0].state.actors[0].bag.food = 999;
    await expect(repo.import(JSON.stringify(broken))).rejects.toThrow();
  });
});
it('Vault 写中断只遗留临时文件，重开仍是旧的完整一轮', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs);
  const first = await repo.create('中断测试', createWorld(73));
  const original = fs.rename; fs.rename = async () => { throw new Error('模拟断电'); };
  await expect(repo.append(first, stepWorld(first.state), 'step')).rejects.toThrow('模拟断电');
  fs.rename = original;
  expect((await repo.load(first.worldId)).commits).toHaveLength(1);
  await repo.append(first, stepWorld(first.state), 'step');
  expect((await repo.load(first.worldId)).commits).toHaveLength(2);
});
it('切换文件库后会话拒绝写入', async () => {
  let current = true;
  const repo = new WorldRepo(createMemFs(), () => { if (!current) throw new Error('文件库已切换'); });
  const first = await repo.create('切库', createWorld(73)); current = false;
  await expect(repo.append(first, stepWorld(first.state), 'step')).rejects.toThrow('文件库已切换');
});
it('网页整库备份包含世界，并可恢复', async () => {
  const repo = new WorldRepo(null), first = await repo.create('备份世界', createWorld(73));
  const data = await collectFullBackup();
  expect((data.worldCommits as unknown[]).length).toBe(1);
  closeDB(); globalThis.indexedDB = new IDBFactory();
  const file = { name: 'backup.json', type: 'application/json', size: 1000, text: async () => JSON.stringify(data) } as File;
  await importBackup(await parseBackupFile(file));
  expect((await repo.load(first.worldId)).commits[0].state).toEqual(first.state);
});
it('旧整库备份恢复整条世界历史，不残留未来轮次；坏链拒绝写入', async () => {
  const repo = new WorldRepo(null), first = await repo.create('整链恢复', createWorld(73));
  const data = await collectFullBackup();
  await repo.append(first, stepWorld(first.state), 'step');
  const parsed = { version: 12, byStore: { worldCommits: data.worldCommits as unknown[] } };
  expect((await previewBackup(parsed)).stores.find(s => s.key === 'worldCommits')?.remove).toBe(1);
  await importBackup(parsed);
  expect((await repo.load(first.worldId)).commits).toHaveLength(1);
  const bad = structuredClone(data.worldCommits) as { state: { tick: number } }[]; bad[0].state.tick = 50;
  await expect(importBackup({ version: 12, byStore: { worldCommits: bad } })).rejects.toThrow();
  expect((await repo.load(first.worldId)).commits).toHaveLength(1);
});
it('损坏尾提交可读取最后完整版本并分支，不能覆盖坏文件', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs), first = await repo.create('坏尾恢复', createWorld(73));
  await repo.append(first, stepWorld(first.state), 'step');
  const path = `世界/${first.worldId}/000001.json`;
  await fs.writeText(path, '{ broken');
  const history = await repo.load(first.worldId);
  expect(history.commits).toHaveLength(1); expect(history.warnings).toHaveLength(1);
  await expect(repo.append(first, stepWorld(first.state), 'step')).rejects.toThrow();
  expect((await repo.fork(first, '恢复分支')).state).toEqual(first.state);
  expect(await fs.readText(path)).toBe('{ broken');
});
it('有效世界文件不进入清理候选，未知附件保持保护', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs), first = await repo.create('保留', createWorld(73));
  await fs.writeText(`世界/${first.worldId}/私人笔记.txt`, '保留我');
  const scan = await scanVaultFiles(createVault(fs));
  expect(scan.entries.some(e => e.path.endsWith('000000.json'))).toBe(false);
  expect(scan.entries.find(e => e.path.endsWith('私人笔记.txt'))?.selectable).toBe(false);
});
it('追加一轮只读取直接父提交，不重读全部历史正文', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs);
  let latest = await repo.create('长档追加', createWorld(73));
  for (let i = 0; i < 30; i++) latest = await repo.append(latest, stepWorld(latest.state), 'step');
  const read = fs.readText.bind(fs); let bodies = 0;
  fs.readText = async path => { if (path.endsWith('.json')) bodies++; return read(path); };
  await repo.append(latest, stepWorld(latest.state), 'step');
  expect(bodies).toBeLessThanOrEqual(1);
});
