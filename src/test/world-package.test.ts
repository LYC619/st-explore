import { beforeEach, afterEach, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { closeDB } from '@/lib/idb';
import { createMemFs } from '@/lib/vault/fs';
import { WorldRepo } from '@/play/storage/world-repo';
import { WorldMediaRepo } from '@/play/media/media-repo';
import { bytesFromBase64, imageDimensions } from '@/play/media/asset';
import { createWorld, stepWorld } from '@/play/world/simulation';
import { withIntelligence } from '@/play/agents/state';
import { startGal, sceneFromText } from '@/play/gal/scene';
import { publicSnapshot, readPackage } from '@/play/storage/world-package';
import { sha256 } from 'js-sha256';
import { saveFact } from '@/play/memory/console';
beforeEach(() => { closeDB(); globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange; });
afterEach(closeDB);
it('公开快照不复活过期事实，仍有效的事实保留期限', async () => {
  const repo = new WorldRepo(createMemFs()); let state = withIntelligence(createWorld(73)); state.tick = 10;
  state = saveFact(state, { text: '昨日闭市', type: 'event', subject: '集市', visibility: 'public', expiresAt: 9 });
  state = saveFact(state, { text: '今夜开放', type: 'event', subject: '集市', visibility: 'public', expiresAt: 12 });
  const shared = publicSnapshot(await repo.create('有效期', state));
  expect(shared.state.intelligence!.facts.map(f => f.text)).toEqual(['今夜开放']);
  expect(shared.state.intelligence!.facts[0].expiresAt).toBe(12);
});
for (const backend of ['idb','vault']) it(`${backend} 完整包保留素材/秘密/断点，公开快照不带私密历史与剧场`, async () => {
  const fs = backend === 'vault' ? createMemFs() : null, repo = new WorldRepo(fs), media = new WorldMediaRepo(fs);
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=', bytes = bytesFromBase64(data);
  const asset = { id:sha256(bytes), data, ...imageDimensions(bytes), updatedAt:1 }; await media.put(asset);
  let state = withIntelligence(createWorld(73)); state.intelligence!.personas.a0.privateNotes = 'PRIVATE_EXPORT_CANARY';
  state = startGal(state, sceneFromText('私密故事','林照晚','PRIVATE_PROSE_CANARY'), 'story','a0'); state.gal!.portraitAsset = asset.id;
  const first = await repo.create('测试', state), text = await repo.exportPackage(first.worldId);
  const otherFs = backend === 'vault' ? createMemFs() : null;
  if (!otherFs) { closeDB(); globalThis.indexedDB = new IDBFactory(); }
  const target = new WorldRepo(otherFs), restored = await target.importPackage(text);
  expect(restored.state).toEqual(state); expect(await new WorldMediaRepo(otherFs).get(asset.id)).toEqual(asset);
  const share = await target.exportPackage(restored.worldId,'public'), publicWorld = [...readPackage(share).records()][0];
  expect(JSON.stringify(publicWorld)).not.toMatch(/PRIVATE_EXPORT_CANARY|PRIVATE_PROSE_CANARY/); expect(publicWorld.state.gal).toBeUndefined();
  const broken = JSON.parse(text); broken.assets = [];
  await expect(target.importPackage(JSON.stringify(broken))).rejects.toThrow('缺少');
  expect((await target.listSummaries()).length).toBe(1);
});
it('读取长档只保留最新完整状态，回放按版本读取；目录列表不扫每轮正文', async () => {
  const fs = createMemFs(), repo = new WorldRepo(fs); let last = await repo.create('有界历史', createWorld(73));
  for (let i=0; i<60; i++) last = await repo.append(last,stepWorld(last.state),'step');
  const opened = await repo.open(last.worldId); expect(opened.latest).toEqual(last); expect(opened.index).toHaveLength(61);
  expect(opened.index.every(row => !('state' in row))).toBe(true);
  expect((await repo.readVersion(last.worldId,15,opened.index[15].hash)).state.tick).toBe(15);
  let reads = 0; const original = fs.readText.bind(fs); fs.readText = async path => { reads++; return original(path); };
  expect((await repo.listSummaries())[0].tick).toBe(60); expect(reads).toBe(1);
});
