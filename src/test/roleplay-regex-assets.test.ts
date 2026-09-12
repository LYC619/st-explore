import { afterEach, expect, it } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { ruleToSTScript, stScriptToRule, type STRegexScript } from '@/lib/st-regex-interop';
import type { RegexCollectionItem } from '@/types/regex';
import type { AssetRef } from '@/types/archive';
import { createRoleplayRegexAssets } from '@/lib/roleplay/regex-assets';

afterEach(() => setActiveVault(null));
const script = (overrides: Partial<STRegexScript> = {}): STRegexScript => ({ id: 'same-rule-id', scriptName: '规则',
  findRegex: '/old/g', replaceString: 'new', placement: [4, 5], disabled: false,
  trimStrings: ['prefix'], promptOnly: true, runOnEdit: false, minDepth: 2, maxDepth: 7,
  foreign: { retained: ['原始字段'] }, ...overrides });
const ref = (assetId: string): AssetRef => ({ kind: 'regex', assetId });

async function fixture(storyAssets = [ref('story-regex')], characterAssets = [ref('character-regex')]) {
  setActiveVault(createVault(createMemFs()));
  const regexes = getCurrentRepo<RegexCollectionItem>('regexes');
  for (const id of ['story-regex', 'character-regex', 'unrelated']) {
    await regexes.put({ id, title: '同名正则集', createdAt: 1, updatedAt: 1, sourcePath: '/original/' + id,
      rules: [stScriptToRule(script({ replaceString: id }))] });
  }
  const options = { regexes, storyAssets, characterAssets };
  return { regexes, options, assets: createRoleplayRegexAssets(options) };
}

it('projects references once with stable collection identities and story priority', async () => {
  const f = await fixture([ref('story-regex'), ref('story-regex'), { kind: 'worldbook', assetId: 'unrelated' }, ref('missing')],
    [ref('story-regex'), ref('character-regex')]);
  const first = await f.assets.read();
  expect(first.globalScripts).toHaveLength(1);
  expect(first.embeddedScripts).toHaveLength(1);
  expect(first.globalScripts[0].id).not.toBe(first.embeddedScripts[0].id);
  expect(first.globalScripts[0]).toMatchObject({ scriptName: '规则', placement: [4, 5], foreign: { retained: ['原始字段'] } });
  expect(first.missingAssetIds).toEqual(['missing']);
  expect(first.assets.map(asset => [asset.assetId, asset.lane])).toEqual([
    ['story-regex', 'globalScripts'], ['character-regex', 'embeddedScripts'],
  ]);
  const renamed = (await f.regexes.get('story-regex'))!;
  await f.regexes.put({ ...renamed, title: '新标题' });
  const reopened = await createRoleplayRegexAssets(f.options).read();
  expect(reopened.globalScripts[0].id).toBe(first.globalScripts[0].id);
});

it('saves original-editor fields to the same asset while retaining omitted foreign fields and separating ordinary globals', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  const originalCharacter = await f.regexes.get('character-regex');
  const ordinary = script({ id: 'ordinary-global', foreign: { ordinary: true } });
  const edited = { id: loaded.globalScripts[0].id, scriptName: '新名称', findRegex: '/changed/g', replaceString: 'edited',
    placement: [3, 5], disabled: true, trimStrings: [], markdownOnly: false, promptOnly: false, runOnEdit: true,
    substituteRegex: 2, minDepth: null, maxDepth: 8 };
  const result = await f.assets.save({ globalScripts: [ordinary, edited], revisions: loaded.revisions });
  expect(result.globalScripts).toEqual([ordinary]);
  expect(result.embeddedScripts).toBeUndefined();
  const saved = (await f.regexes.get('story-regex'))!;
  expect(saved).toMatchObject({ id: 'story-regex', title: '同名正则集', createdAt: 1, sourcePath: '/original/story-regex' });
  expect(saved.rules).toHaveLength(1);
  expect(ruleToSTScript(saved.rules[0])).toMatchObject({ ...edited, id: 'same-rule-id', foreign: { retained: ['原始字段'] } });
  expect(await f.regexes.get('character-regex')).toEqual(originalCharacter);
  expect(await f.regexes.list()).toHaveLength(3);
  expect(JSON.stringify(saved)).not.toContain(edited.id);
  expect(result.revisions['story-regex']).not.toBe(loaded.revisions['story-regex']);
});

it('persists deleting the final asset rule without deleting the collection or the omitted lane', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  await f.assets.save({ globalScripts: [], revisions: loaded.revisions });
  expect(await f.regexes.get('story-regex')).toMatchObject({ id: 'story-regex', rules: [] });
  const reopened = await createRoleplayRegexAssets(f.options).read();
  expect(reopened.globalScripts).toEqual([]);
  expect(reopened.embeddedScripts).toHaveLength(1);
});

it('keeps ordinary embedded scripts out of assets and does not rewrite an omitted global lane', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  const ordinary = script({ id: 'card-inline', replaceString: 'ordinary embedded' });
  const originalStory = await f.regexes.get('story-regex');
  const edited = { ...loaded.embeddedScripts[0], replaceString: 'edited embedded asset' };
  const result = await f.assets.save({ embeddedScripts: [edited, ordinary], revisions: loaded.revisions });
  expect(result.embeddedScripts).toEqual([ordinary]);
  expect(result.globalScripts).toBeUndefined();
  expect(await f.regexes.get('story-regex')).toEqual(originalStory);
  expect((await f.regexes.get('character-regex'))!.rules[0].replaceString).toBe('edited embedded asset');
});

it('does not promote an old editor revision when the adapter rereads an external edit', async () => {
  const f = await fixture();
  const stale = await f.assets.read();
  const external = (await f.regexes.get('story-regex'))!;
  external.rules[0].replaceString = 'external edit';
  await f.regexes.put(external);
  await f.assets.read();
  await expect(f.assets.save({ globalScripts: [{ ...stale.globalScripts[0], replaceString: 'stale overwrite' }],
    revisions: stale.revisions })).rejects.toThrow(/修改|版本/);
  expect((await f.regexes.get('story-regex'))!.rules[0].replaceString).toBe('external edit');
});

it('checks every changed asset before writing any of a multi-collection edit', async () => {
  const f = await fixture([ref('story-regex'), ref('character-regex')], []);
  const loaded = await f.assets.read();
  const first = await f.regexes.get('story-regex');
  const second = (await f.regexes.get('character-regex'))!;
  second.rules[0].replaceString = 'external second'; await f.regexes.put(second);
  await expect(f.assets.save({ globalScripts: loaded.globalScripts.map(item => ({ ...item, replaceString: 'editor change' })),
    revisions: loaded.revisions })).rejects.toThrow(/修改|版本/);
  expect(await f.regexes.get('story-regex')).toEqual(first);
  expect((await f.regexes.get('character-regex'))!.rules[0].replaceString).toBe('external second');
});

it('serializes competing adapters so one stale writer cannot overwrite the winner', async () => {
  const f = await fixture();
  const other = createRoleplayRegexAssets(f.options);
  const one = await f.assets.read(), two = await other.read();
  const results = await Promise.allSettled([
    f.assets.save({ globalScripts: [{ ...one.globalScripts[0], replaceString: 'first' }], revisions: one.revisions }),
    other.save({ globalScripts: [{ ...two.globalScripts[0], replaceString: 'second' }], revisions: two.revisions }),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await f.regexes.get('story-regex'))!.rules[0].replaceString).toBe('first');
});

it('returns revisions usable for the next edit but rejects a delayed previous snapshot', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  const first = await f.assets.save({ globalScripts: [{ ...loaded.globalScripts[0], replaceString: 'first' }], revisions: loaded.revisions });
  await f.assets.save({ globalScripts: [{ ...loaded.globalScripts[0], replaceString: 'second' }], revisions: first.revisions });
  await expect(f.assets.save({ globalScripts: [{ ...loaded.globalScripts[0], replaceString: 'delayed first' }],
    revisions: loaded.revisions })).rejects.toThrow(/修改|版本/);
  expect((await f.regexes.get('story-regex'))!.rules[0].replaceString).toBe('second');
});

it('does not rewrite unchanged asset scripts or leak returned object mutations into the baseline', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  const before = await f.regexes.get('story-regex');
  await f.assets.save({ globalScripts: loaded.globalScripts, revisions: loaded.revisions });
  expect(await f.regexes.get('story-regex')).toEqual(before);
  (loaded.globalScripts[0].foreign as { retained: string[] }).retained.push('mutated output');
  expect((await f.assets.read()).globalScripts[0].foreign).toEqual({ retained: ['原始字段'] });
});

it('rejects asset identity duplication and cross-lane relocation before changing the library', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  const before = await f.regexes.list();
  await expect(f.assets.save({ globalScripts: [loaded.globalScripts[0], loaded.globalScripts[0]], revisions: loaded.revisions })).rejects.toThrow(/重复/);
  await expect(f.assets.save({ globalScripts: loaded.embeddedScripts, revisions: loaded.revisions })).rejects.toThrow(/作用域|关联/);
  await expect(f.assets.save({ globalScripts: [], revisions: {} })).rejects.toThrow(/版本|读取/);
  expect(await f.regexes.list()).toEqual(before);
});

it('does not recreate a removed referenced collection', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  await f.regexes.remove('story-regex');
  await expect(f.assets.save({ globalScripts: [], revisions: loaded.revisions })).rejects.toThrow(/不存在|删除|修改/);
  expect(await f.regexes.get('story-regex')).toBeUndefined();
});

it('rejects an old adapter after the active vault changes', async () => {
  const f = await fixture();
  const loaded = await f.assets.read();
  setActiveVault(createVault(createMemFs()));
  await expect(f.assets.read()).rejects.toThrow(/切换/);
  await expect(f.assets.save({ globalScripts: [], revisions: loaded.revisions })).rejects.toThrow(/切换/);
});
