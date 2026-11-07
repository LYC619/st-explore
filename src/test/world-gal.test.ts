import { expect, it, vi } from 'vitest';
import { createWorld, stepWorld } from '@/play/world/simulation';
import { startGal, sceneFromText, stageChoice, advanceBeat, acceptScene, currentBeat, validateScene, encounterTheater, parseGeneratedScene } from '@/play/gal/scene';
import { takeControl } from '@/play/adventure/control';
import { createMemFs } from '@/lib/vault/fs';
import { WorldRepo } from '@/play/storage/world-repo';
import { StageMediaPool } from '@/play/media/pool';
import { imageDimensions, bytesFromBase64, validWorldMedia } from '@/play/media/asset';
import { WorldMediaRepo } from '@/play/media/media-repo';
import { sha256 } from 'js-sha256';

it('对白图断边、循环、不可达节点与空选项均拒绝', () => {
  const scene = sceneFromText('长夜', '林照晚', '一'.repeat(600)); validateScene(scene);
  const bad = structuredClone(scene); bad.beats[0].next = 'missing'; expect(() => validateScene(bad)).toThrow('断边');
  bad.beats[0].next = 'b0'; expect(() => validateScene(bad)).toThrow('循环');
  bad.beats[0].next = undefined; expect(() => validateScene(bad)).toThrow('不可达');
  expect(() => parseGeneratedScene({ ...scene, choices: [] })).toThrow();
});
it('对白推进只保存本地断点，选项防重入，失败后的待续选择重开可恢复', async () => {
  const repo = new WorldRepo(createMemFs()); let current = await repo.create('视觉故事', startGal(createWorld(73), sceneFromText('长夜', '林照晚', '一'.repeat(600)), 'story', 'a0'));
  expect(() => stageChoice(current.state, 0, 'ask')).toThrow('还未读到');
  for (let i = 0; i < 2; i++) current = await repo.append(current, { state: advanceBeat(current.state, i), events: [] }, 'configure');
  expect(currentBeat(current.state.gal!).next).toBeUndefined();
  const chosen = stageChoice(current.state, 2, 'ask');
  expect(() => stageChoice(chosen, 2, 'ask')).toThrow();
  current = await repo.append(current, { state: chosen, events: [] }, 'configure');
  const restored = (await repo.load(current.worldId)).commits.at(-1)!;
  expect(restored.state.gal!.pending!.input).toContain('询问');
  const nextScene = sceneFromText('天亮', '林照晚', '晨光终于照进庭院。');
  expect(() => acceptScene(restored.state, 'stale', nextScene)).toThrow('过期');
  const next = acceptScene(restored.state, restored.state.gal!.pending!.id, nextScene);
  expect(next.gal!.choices).toHaveLength(1); expect(next.gal!.pending).toBeUndefined();
  expect((await repo.fork(restored, '岔路')).state.gal!.pending).toEqual(chosen.gal!.pending);
});
it('遭遇剧场的选项回到真实规则，状态与剧场一并提交，重复选择不能再次领奖', () => {
  let state = takeControl(createWorld(73), 'a0'); const control = state.adventure!.control!;
  state = stepWorld(state, { type: 'action', ...control, actionId: 'explore' }).state; state = stepWorld(state).state;
  state = encounterTheater(state); const encounterId = state.gal!.encounterId!;
  const result = stepWorld(state, { type: 'encounter', ...control, encounterId, choice: 'face' });
  expect(result.state.gal).toBeUndefined(); expect(result.state.adventure!.resolved).toBe(1);
  expect(() => stepWorld(result.state, { type: 'encounter', ...control, encounterId, choice: 'face' })).toThrow('已失效');
});
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
it('素材按内容校验保存，不接受脚本或超大像素；20次切换与退出释放URL', async () => {
  const bytes = bytesFromBase64(pixel), dims = imageDimensions(bytes), asset = { id: sha256(bytes), data: pixel, ...dims, updatedAt: 1 };
  expect(validWorldMedia(asset)).toBe(true);
  const repo = new WorldMediaRepo(createMemFs()); await repo.put(asset); expect(await repo.get(asset.id)).toEqual(asset);
  expect(() => imageDimensions(new TextEncoder().encode('<svg onload="evil"/>'))).toThrow('静态');
  const huge = bytes.slice(); new DataView(huge.buffer).setUint32(16, 9000); expect(() => imageDimensions(huge)).toThrow('尺寸过大');
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:' + Math.random()), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const pool = new StageMediaPool(8); // two decoded 1px fixtures
  for (let i = 0; i < 20; i++) { const h = pool.acquire({ ...asset, id: String(i) }); h.release(); expect(pool.bytes).toBeLessThanOrEqual(8); }
  expect(pool.size).toBe(2); pool.dispose(); expect(pool.bytes).toBe(0); expect(revoke).toHaveBeenCalledTimes(20);
  create.mockRestore(); revoke.mockRestore();
});
