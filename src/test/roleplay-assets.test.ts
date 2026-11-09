import { afterEach, expect, it } from 'vitest';
import { createVault } from '@/lib/vault/vault-backend';
import { createMemFs } from '@/lib/vault/fs';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { parseWorldBook, type WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';
import { createRoleplayAssets } from '@/lib/roleplay/assets';
import { parsePreset } from '@/lib/preset-parser';

afterEach(() => setActiveVault(null));
it('can import the same preset again after deleting it in the chat editor', async () => {
  const { assets, presets } = await fixture();
  const data = { temperature: 0.7, prompts: [], prompt_order: [] };
  await assets.savePreset('合成预设', data);
  const oldId = (await presets.list())[0].id;
  await assets.deletePreset('合成预设');
  await assets.refreshPresets();
  await assets.savePreset('合成预设', data);
  const list = await presets.list();
  expect(list).toHaveLength(1);
  expect(list[0].id).not.toBe(oldId);
  expect(assets.presetData().get('合成预设')).toMatchObject(data);
});
async function fixture() {
  setActiveVault(createVault(createMemFs()));
  const worldbooks = getCurrentRepo<WorldBookItem>('worldbooks');
  const presets = getCurrentRepo<PresetItem>('presets');
  await worldbooks.put({ id: 'north', title: '北门', createdAt: 1, updatedAt: 1,
    worldbook: parseWorldBook({ entries: { 1: { uid: 1, key: ['门'], content: '向北开', position: 4, depth: 2, unknown: 7 } } }) });
  const assets = await createRoleplayAssets({ worldbooks, presets, isCurrent: () => true });
  return { assets, worldbooks, presets };
}
it('round trips original worldbook fields and saves into the same STE asset', async () => {
  const { assets, worldbooks } = await fixture();
  const data = await assets.readWorld('北门');
  data.entries['1'].content = '正门向北开';
  await assets.saveWorld('北门', data);
  expect((await worldbooks.list())).toHaveLength(1);
  expect((await assets.readWorld('北门')).entries['1']).toMatchObject({ content: '正门向北开', position: 4, unknown: 7 });
});
it('rejects overwriting a worldbook changed by another editor', async () => {
  const { assets, worldbooks } = await fixture();
  const data = await assets.readWorld('北门');
  const current = (await worldbooks.get('north'))!;
  current.worldbook.entries['1'].content = '其他编辑';
  await worldbooks.put(current);
  await expect(assets.saveWorld('北门', data)).rejects.toThrow(/修改/);
  expect((await worldbooks.get('north'))!.worldbook.entries['1'].content).toBe('其他编辑');
});
it('keeps an older editor revision stale even when a tool rereads the updated worldbook', async () => {
  const { assets, worldbooks } = await fixture();
  const editor = await assets.readWorld('北门');
  const current = (await worldbooks.get('north'))!;
  current.worldbook.entries['1'].content = '用户从外部更新的设定';
  await worldbooks.put(current);
  await assets.readWorld('北门');
  editor.entries['1'].content = '旧编辑器稍后提交';
  await expect(assets.saveWorld('北门', editor)).rejects.toThrow(/修改/);
  expect((await worldbooks.get('north'))!.worldbook.entries['1'].content).toBe('用户从外部更新的设定');
});
it('preserves unknown preset and prompt fields through the original save route', async () => {
  const { assets, presets } = await fixture();
  await assets.savePreset('叙述', { temperature: 0.9, foreign: { keep: 1 }, prompts: [
    { identifier: 'voice', name: '文风', content: '简洁', role: 'system', foreign: true },
  ], prompt_order: [] });
  const list = await presets.list();
  expect(list).toHaveLength(1);
  expect(assets.presetData().get('叙述')).toMatchObject({ foreign: { keep: 1 }, prompts: [{ foreign: true }] });
});
it('returns the next world editor revision without putting host fields into the original asset', async () => {
  const { assets, worldbooks } = await fixture();
  const data = await assets.readWorld('北门');
  data.entries['1'].content = '第一次编辑';
  Object.assign(data, await assets.saveWorld('北门', data));
  data.entries['1'].content = '第二次编辑';
  Object.assign(data, await assets.saveWorld('北门', data));
  expect((await worldbooks.get('north'))!.worldbook.entries['1'].content).toBe('第二次编辑');
  expect(JSON.stringify((await worldbooks.get('north'))!.worldbook)).not.toContain('_ste_revision');
});
it('does not promote a legacy editor baseline after a background read', async () => {
  const { assets, worldbooks } = await fixture();
  const data = await assets.readWorld('北门'); delete data._ste_revision;
  const current = (await worldbooks.get('north'))!;
  current.worldbook.entries['1'].content = '外部变更'; await worldbooks.put(current);
  await assets.readWorld('北门');
  await expect(assets.saveWorld('北门', data)).rejects.toThrow(/修改/);
});
it('maps duplicate titles to distinct names and maps STE references without guessing', async () => {
  const f = await fixture();
  await f.worldbooks.put({ ...(await f.worldbooks.get('north'))!, id: 'south' });
  const assets = await createRoleplayAssets({ worldbooks: f.worldbooks, presets: f.presets });
  const names = assets.worldNames();
  expect(new Set(names).size).toBe(2);
  expect(assets.worldName('north')).not.toBe(assets.worldName('south'));
  expect(assets.worldName('missing')).toBeUndefined();
});
it('refreshes preset aliases and expiry while keeping stale editor writes protected', async () => {
  const f = await fixture();
  const preset = { id: 'preset-1', title: '原始文件名', catalog: { name: '自用名', version: 'v1' },
    preset: parsePreset({ prompts: [], prompt_order: [], temperature: 0.5 }), createdAt: 1, updatedAt: 1 };
  await f.presets.put(preset);
  await f.assets.refreshPresets();
  expect(f.assets.presetName(preset.id)).toBe('自用名 · v1');
  const stale = f.assets.presetData().get('自用名 · v1');
  const oldRevision = f.assets.presetRevisions()['自用名 · v1'];
  await f.presets.put({ ...preset, preset: parsePreset({ prompts: [], prompt_order: [], temperature: 0.8 }) });
  await f.assets.refreshPresets();
  await expect(f.assets.savePreset('自用名 · v1', stale)).rejects.toThrow('其他编辑修改');
  expect(() => f.assets.selectPreset('自用名 · v1', oldRevision)).toThrow('列表已变化');
  const fresh = f.assets.presetData().get('自用名 · v1');
  f.assets.selectPreset('自用名 · v1', f.assets.presetRevisions()['自用名 · v1']);
  await expect(f.assets.savePreset('自用名 · v1', fresh)).resolves.toBeUndefined();
  await f.presets.put({ ...preset, catalog: { name: '改名', version: 'v1' } });
  expect(await f.assets.refreshPresets()).toEqual({ '自用名 · v1': '改名 · v1' });
  await expect(f.assets.savePreset('自用名 · v1', stale)).rejects.toThrow('名称已变化');
  await f.presets.put({ ...preset, catalog: { ...preset.catalog, tags: ['状态/过期'] } });
  await f.assets.refreshPresets();
  expect(f.assets.presetData().size).toBe(0);
  expect(await f.presets.get(preset.id)).toBeDefined();
});
