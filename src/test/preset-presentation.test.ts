import { describe, expect, it } from 'vitest';
import { getPresetPresentation, inferPresetIdentity } from '@/lib/preset-presentation';
import { toAssetIndex } from '@/lib/asset-index-entry';
import type { PresetItem } from '@/types/preset';
import { applyPresetBulkPatch } from '@/components/preset/PresetBulkEdit';

it('keeps an explicitly cleared model empty across the list summary', () => {
  const item = { title: '星海-Claude-v1', catalog: applyPresetBulkPatch({ models: ['Claude'] }, { models: { Claude: false }, tags: {} }) };
  expect(getPresetPresentation(item).models).toEqual([]);
});

describe('preset identity hints from real filename patterns', () => {
  it('keeps the named model edition and letter suffix as a version after a series name', () => {
    expect(inferPresetIdentity('斯拉预设 Gemini 3.1 B.json')).toMatchObject({
      displayName: '斯拉预设', series: '斯拉预设', version: 'Gemini 3.1 B', models: ['Gemini'],
    });
  });
  it('separates a bracketed model version from the preset version', () => {
    expect(inferPresetIdentity('[哈基米2.5]World_Builder_1.4.json')).toMatchObject({
      displayName: 'World Builder', series: 'World Builder', version: '1.4', models: ['Gemini'],
    });
  });
  it('groups explicit series versions without treating download duplicate suffixes as versions', () => {
    for (const name of ['【小猫之神】3.10 (1).json', '【小猫之神】3.11.json']) {
      expect(inferPresetIdentity(name).series).toBe('小猫之神');
    }
    expect(inferPresetIdentity('3.Klaude dramatron 1.23 (1)').version).toBe('1.23');
    expect(inferPresetIdentity('3.Klaude dramatron 1.23 (1)').displayName).toBe('Klaude dramatron');
  });
  it('uses a date label as a release hint while retaining useful name text', () => {
    expect(inferPresetIdentity('[Claude]MUR 鹿鹿 API 4月29日')).toMatchObject({
      version: '4月29日', models: ['Claude'], displayName: 'MUR 鹿鹿 API',
    });
    expect(inferPresetIdentity('【gemini】kemini 4o 0706超级版 (1)')).toMatchObject({version:'0706',models:['Gemini']});
  });
  it('keeps a visible prefix version ahead of a card-format suffix', () => {
    expect(inferPresetIdentity('[Claude]斯拉4.22神牢 用于V3')).toMatchObject({series:'斯拉',version:'4.22',models:['Claude']});
  });
  it('does not invent a series or version without evidence', () => {
    expect(inferPresetIdentity('Default.json')).toMatchObject({displayName:'Default',models:[]});
    expect(inferPresetIdentity('Default.json').series).toBeUndefined();
    expect(inferPresetIdentity('Default (1).json').version).toBeUndefined();
    expect(inferPresetIdentity('Claude 3.5 preset.json').version).toBeUndefined();
    expect(inferPresetIdentity('3.2 角色卡整理流程.json').version).toBeUndefined();
  });
  it('recognizes an explicit release after the model while excluding unmarked model generations', () => {
    expect(inferPresetIdentity('星海-Claude-v1')).toMatchObject({ series: '星海', version: 'v1', models: ['Claude'] });
    expect(inferPresetIdentity('星海-Gemini-ver1.2')).toMatchObject({ series: '星海', version: 'ver1.2', models: ['Gemini'] });
    expect(inferPresetIdentity('星海-Claude-3.5').version).toBeUndefined();
    expect(inferPresetIdentity('星海-Gemini-2.5').version).toBeUndefined();
  });
  it('keeps model-looking substrings in series names from becoming unsupported model claims', () => {
    expect(inferPresetIdentity('Klaude dramatron 1.23').models).toEqual([]);
    expect(inferPresetIdentity('Kemini Aether-fr-3.3').models).toEqual([]);
  });
  it('only suggests uses explicitly named in the file', () => {
    expect(inferPresetIdentity('A.U.T.O写卡预设 v1.3').purposes).toEqual(['写卡']);
    expect(inferPresetIdentity('[工具-总结]kemini_4o_0709_快速版').purposes).toEqual(['总结']);
    expect(inferPresetIdentity('【小猫之神】3.10').purposes).toEqual([]);
  });
});

describe('preset model evidence and manual precedence', () => {
  it('prefers explicit filename evidence over stale provider fields', () => {
    expect(inferPresetIdentity('【Claude】斯拉预设_4.03', { chat_completion_source:'openai',openai_model:'gemini-2.5-pro',claude_model:'claude-3.5-sonnet' }).models).toEqual(['Claude']);
  });
  it('only reads the active source model, including the makersuite alias', () => {
    const raw={chat_completion_source:'makersuite',openai_model:'gpt-4-turbo',google_model:'gemini-2.5-pro',claude_model:'claude-3-opus'};
    expect(inferPresetIdentity('My preset',raw)).toMatchObject({models:['Gemini'],evidence:expect.arrayContaining([expect.objectContaining({field:'models',source:'configuration'})])});
    expect(inferPresetIdentity('My preset',{...raw,chat_completion_source:'custom'}).models).toEqual([]);
    expect(inferPresetIdentity('My preset',{openai_model:'gpt-4-turbo',google_model:'gemini-pro'}).models).toEqual([]);
  });
  it('does not inspect prompt prose, script text or author-like metadata', () => {
    const result=inferPresetIdentity('plain', {author:'not confirmed',prompts:[{content:'Use Claude 4.5 by Author A'}],extensions:{script:'Gemini'},version:'1.2'});
    expect(result.models).toEqual([]);
    expect(result).not.toHaveProperty('author');
    expect(result.version).toBeUndefined();
  });
  it('preserves confirmed fields and does not mutate metadata', () => {
    const item={title:'【Claude】斯拉预设_4.03',catalog:{author:'作者甲',series:'私人收藏',version:'修订二',models:['DeepSeek'],purposes:['测试用途']}};
    const before=structuredClone(item);
    expect(getPresetPresentation(item)).toMatchObject({author:'作者甲',series:'私人收藏',version:'修订二',models:['DeepSeek'],purposes:['测试用途'],inferred:{models:false,series:false,version:false,purposes:false}});
    expect(item).toEqual(before);
  });
  it('marks fallback hints individually and accepts bounded catalog summaries', () => {
    const result=getPresetPresentation({title:'[哈基米2.5]World_Builder_1.4',catalog:{status:'unreviewed',models:[],version:'',notes:undefined}});
    expect(result).toMatchObject({models:['Gemini'],version:'1.4',series:'World Builder',inferred:{models:true,version:true,series:true,purposes:false}});
    expect(result.author).toBeUndefined();
  });
});

describe('preset identity across the lightweight list boundary', () => {
  const item: PresetItem = {
    id: 'preset-model-summary', title: 'My preset', createdAt: 1, updatedAt: 2,
    preset: {
      prompts: [{ identifier: 'main', name: 'Main', content: 'Private prompt body' }],
      promptOrder: [], regexRules: [], hasRegexExtension: false,
      originalData: {
        chat_completion_source: 'makersuite', google_model: 'gemini-2.5-pro',
        openai_model: 'gpt-4-turbo', extensions: { unrelated: 'Private configuration' },
      },
    },
  };

  it('retains active-source model evidence without requiring the full preset payload', () => {
    const summary = toAssetIndex(item);
    expect(getPresetPresentation(summary)).toMatchObject({
      models: ['Gemini'], inferred: { models: true },
      evidence: expect.arrayContaining([expect.objectContaining({ field: 'models', source: 'configuration' })]),
    });
    expect(summary).not.toHaveProperty('preset');
    expect(JSON.stringify(summary)).not.toContain('Private');
    expect(getPresetPresentation(toAssetIndex(summary))).toEqual(getPresetPresentation(summary));
  });

  it('keeps a manual model correction ahead of the carried configuration hint', () => {
    const summary = toAssetIndex({ ...item, catalog: { models: ['Claude'], modelBasis: 'manual' } });
    expect(getPresetPresentation(summary)).toMatchObject({ models: ['Claude'], inferred: { models: false } });
    expect(item).not.toHaveProperty('presetIdentity');
  });
});
