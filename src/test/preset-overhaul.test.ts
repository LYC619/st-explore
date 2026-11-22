import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { getCurrentRepo } from '@/lib/repo';
import { parsePreset, selectActivePromptOrderGroup } from '@/lib/preset-parser';
import { buildSummaryMessages } from '@/lib/summary-engine';
import { streamPresetPlayground } from '@/lib/preset-playground-stream';
import { comparePresetVersions, getPresetPresentation, inferPresetIdentity } from '@/lib/preset-presentation';
import { applyPresetBulkPatch } from '@/lib/preset-bulk-patch';
import { buildImportedPreset, readPresetPackage } from '@/lib/preset-package';
import { createTavernHost } from '@/lib/roleplay/tavern-host';
import { monitorCompletion, type CompletionOutcome } from '@/lib/roleplay/completion-monitor';
import { saveEditedPreset } from '@/lib/preset-db';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import type { ArchiveCharacter, ArchiveStory } from '@/types/archive';
import type { PresetItem } from '@/types/preset';

describe('Batch 3 preset subsystem overhaul', () => {
  beforeEach(() => {
    setActiveVault(createVault(createMemFs()));
  });

  afterEach(() => {
    setActiveVault(null);
    vi.unstubAllGlobals();
  });

  it('selectActivePromptOrderGroup skips empty 100000 placeholder group and picks ST 100001 active group', () => {
    const np = parsePreset({
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: '主系统指令' },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
      ],
      prompt_order: [
        { character_id: 100000, order: [] },
        { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
      ],
    });
    const group = selectActivePromptOrderGroup(np);
    expect(group?.character_id).toBe(100001);
    expect(group?.order).toHaveLength(2);
  });

  it('buildSummaryMessages ignores disabled @depth blocks, keeps depth order intact, and avoids duplicate worldbook injection', () => {
    const preset = parsePreset({
      prompts: [
        { identifier: 'main', name: 'Main', role: 'system', content: '系统设定' },
        { identifier: 'worldInfoBefore', name: 'WI Before', marker: true },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
        { identifier: 'worldInfoAfter', name: 'WI After', marker: true },
        { identifier: 'disabled_inj', name: 'Disabled Inj', role: 'system', content: '绝不该出现的禁用破甲', injection_position: 1, injection_depth: 0 },
        { identifier: 'enabled_d2', name: 'Enabled D2', role: 'system', content: '倒数第二层注入', injection_position: 1, injection_depth: 2 },
        { identifier: 'enabled_d0', name: 'Enabled D0', role: 'system', content: '末尾注入', injection_position: 1, injection_depth: 0 },
      ],
      prompt_order: [
        { character_id: 100000, order: [] },
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'worldInfoBefore', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'worldInfoAfter', enabled: true },
            { identifier: 'disabled_inj', enabled: false },
            { identifier: 'enabled_d2', enabled: true },
            { identifier: 'enabled_d0', enabled: true },
          ],
        },
      ],
      assistant_prefill: '<thinking>',
    });

    const result = buildSummaryMessages({
      session: {
        id: 's1',
        title: '测试会话',
        character: { name: '胡桃' },
        user: { name: '旅行者' },
        messages: [
          { id: 'm1', role: 'user', content: '第一句', timestamp: 1 },
          { id: 'm2', role: 'assistant', content: '第二句', timestamp: 2 },
          { id: 'm3', role: 'user', content: '第三句', timestamp: 3 },
        ],
        createdAt: 1,
      },
      floorStart: 0,
      floorEnd: 2,
      template: '总结剧情',
      preset,
      worldbook: {
        entries: {
          '0': { ...DEFAULT_ENTRY, uid: 0, comment: '前置', content: '前置世界观设定', constant: true, selective: false, order: 100, position: 0, enabled: true, depth: 4 },
          '1': { ...DEFAULT_ENTRY, uid: 1, comment: '后置', content: '后置人物关系设定', constant: true, selective: false, order: 100, position: 1, enabled: true, depth: 4 },
        },
      },
      worldbookMode: 'constant',
    });

    const texts = result.messages.map((m) => m.content);
    expect(texts.some((t) => t.includes('绝不该出现的禁用破甲'))).toBe(false);
    expect(texts.filter((t) => t.includes('前置世界观设定'))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('后置人物关系设定'))).toHaveLength(1);

    const idxM1 = texts.findIndex((t) => t.includes('第一句'));
    const idxD2 = texts.findIndex((t) => t === '倒数第二层注入');
    const idxM2 = texts.findIndex((t) => t.includes('第二句'));
    const idxM3 = texts.findIndex((t) => t.includes('第三句'));
    const idxD0 = texts.findIndex((t) => t === '末尾注入');
    expect(idxD2).toBeGreaterThan(idxM1);
    expect(idxD2).toBeLessThan(idxM2);
    expect(idxD0).toBeGreaterThan(idxM3);
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: '<thinking>' });
  });

  it('streamPresetPlayground supports native Anthropic SSE and native Gemini SSE without [DONE]', async () => {
    const encoder = new TextEncoder();

    // 1. Native Anthropic SSE
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n'
          + 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"思考中"}}\n\n'
          + 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"月色真美"}}\n\n'
          + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
          + 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } })));

    const claudeChunks: string[] = [];
    const onReasoning = vi.fn();
    const claudeReply = await streamPresetPlayground(
      { apiUrl: 'https://api.anthropic.com/v1/messages', apiKey: 'sk-ant', model: 'claude-sonnet-4-5', protocol: 'anthropic' },
      { messages: [{ role: 'user', content: '你好' }] },
      new AbortController().signal,
      (t) => claudeChunks.push(t),
      { onReasoning },
    );
    expect(claudeReply).toBe('月色真美');
    expect(claudeChunks).toEqual(['月色真美']);
    expect(onReasoning).toHaveBeenCalledOnce();

    // 2. Native Gemini SSE
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"candidates":[{"content":{"parts":[{"text":"晚风"}]},"index":0}]}\n\n'
          + 'data: {"candidates":[{"content":{"parts":[{"text":"温柔"}]},"finishReason":"STOP","index":0}]}\n\n',
        ));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } })));

    const geminiChunks: string[] = [];
    const geminiReply = await streamPresetPlayground(
      { apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: 'goog-key', model: 'gemini-2.5-pro', protocol: 'gemini' },
      { messages: [{ role: 'user', content: '你好' }] },
      new AbortController().signal,
      (t) => geminiChunks.push(t),
    );
    expect(geminiReply).toBe('晚风温柔');
    expect(geminiChunks).toEqual(['晚风', '晚风温柔']);
  });

  it('does not merge unrelated presets into one series when author is set, and compares versions semantically', () => {
    const patched = applyPresetBulkPatch({}, { author: '鹿鹿', models: {}, tags: {} });
    expect(patched.author).toBe('鹿鹿');
    expect(patched.series).toBeUndefined();

    const p1 = getPresetPresentation({ title: '纯爱日常预设', catalog: patched });
    const p2 = getPresetPresentation({ title: '克苏鲁跑团预设', catalog: patched });
    expect(p1.series).toBeUndefined();
    expect(p2.series).toBeUndefined();

    expect(inferPresetIdentity('Claude Sonnet 3.7 通用预设').version).toBeUndefined();
    expect(comparePresetVersions('v3.10', 'v3.2')).toBeGreaterThan(0);
    expect(comparePresetVersions('5月2日', '4月29日')).toBeGreaterThan(0);
  });

  it('readPresetPackage unpacks .zip archives and detects companion WorldBook JSONs', async () => {
    const u8 = (text: string) => new Uint8Array(strToU8(text));
    const zipBytes = zipSync({
      '星海包/星海预设 v2.1.json': u8(JSON.stringify({
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: '正文' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      })),
      '星海包/星海配套世界书.json': u8(JSON.stringify({
        entries: {
          '0': { uid: 0, key: ['星海'], comment: '核心设定', content: '星海纪元世界观', constant: true, enabled: true, position: 0, order: 100 },
        },
      })),
      '星海包/食用说明.md': u8('# 推荐搭配 Claude 使用'),
    });
    const copied = new Uint8Array(zipBytes);
    const zipFile = new File([copied], '星海发布包.zip', { type: 'application/zip' });
    Object.defineProperty(zipFile, 'arrayBuffer', { value: async () => copied.buffer });

    const preview = await readPresetPackage([zipFile]);
    expect(preview.errors).toEqual([]);
    expect(preview.presets).toHaveLength(1);
    expect(preview.presets[0].name).toBe('星海预设 v2.1');
    expect(preview.worldbooks).toHaveLength(1);
    expect(preview.worldbooks[0].name).toBe('星海配套世界书');
    expect(preview.worldbooks[0].entryCount).toBe(1);
    expect(preview.files.map((f) => f.kind)).toEqual(['notes']);
  });

  it('createTavernHost applies each story/character linked preset and reflects STE DIY edits instead of stale global oai_settings', async () => {
    const charRepo = getCurrentRepo<ArchiveCharacter>('characters');
    const storyRepo = getCurrentRepo<ArchiveStory>('archiveStories');
    const presetRepo = getCurrentRepo<PresetItem>('presets');

    await presetRepo.put({
      id: 'preset-a',
      title: '预设甲',
      preset: parsePreset({
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'PROMPT_ALPHA_V1' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      }),
      createdAt: 1,
      updatedAt: 1,
    });
    await presetRepo.put({
      id: 'preset-b',
      title: '预设乙',
      preset: parsePreset({
        prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'PROMPT_BETA_V1' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      }),
      createdAt: 2,
      updatedAt: 2,
    });

    await charRepo.put({
      id: 'char-1',
      name: '角色一',
      card: { name: '角色一', first_mes: '你好' },
      tags: [],
      status: '进行中',
      createdAt: 1,
      updatedAt: 1,
    });
    await storyRepo.put({
      id: 'story-a',
      characterId: 'char-1',
      title: '故事甲',
      assets: [{ kind: 'preset', assetId: 'preset-a' }],
      session: { id: 'sa', title: '故事甲', messages: [{ id: 'm1', role: 'assistant', content: '你好', timestamp: 1 }], character: { name: '角色一' }, user: { name: '你' }, createdAt: 1 },
      markers: [],
      favorites: [],
      meta: { modelsUsed: [], playTimeMs: null },
      createdAt: 1,
      updatedAt: 1,
    });
    await storyRepo.put({
      id: 'story-b',
      characterId: 'char-1',
      title: '故事乙',
      assets: [{ kind: 'preset', assetId: 'preset-b' }],
      session: { id: 'sb', title: '故事乙', messages: [{ id: 'm1', role: 'assistant', content: '你好', timestamp: 1 }], character: { name: '角色一' }, user: { name: '你' }, createdAt: 1 },
      markers: [],
      favorites: [],
      meta: { modelsUsed: [], playTimeMs: null },
      createdAt: 2,
      updatedAt: 2,
    });

    // Story A saves settings in Tavern (populating global preferences.tavern.oai_settings)
    const hostA = await createTavernHost({ storyId: 'story-a', defaults: { settings: { oai_settings: {} } } });
    try {
      const sA = JSON.parse((await (await hostA.request('/api/settings/get')).json()).settings).oai_settings;
      expect(sA.preset_settings_openai).toBe('预设甲');
      expect(sA.prompts[0].content).toBe('PROMPT_ALPHA_V1');
      await hostA.request('/api/settings/save', { oai_settings: sA });
    } finally {
      hostA.close();
    }

    // Story B has linked preset-b -> MUST receive preset-b, NOT Story A's saved preset-a!
    const hostB = await createTavernHost({ storyId: 'story-b', defaults: { settings: { oai_settings: {} } } });
    try {
      const sB = JSON.parse((await (await hostB.request('/api/settings/get')).json()).settings).oai_settings;
      expect(sB.preset_settings_openai).toBe('预设乙');
      expect(sB.prompts[0].content).toBe('PROMPT_BETA_V1');
    } finally {
      hostB.close();
    }

    // User edits preset-a in STE DIY editor -> reopening Story A reflects the DIY edit!
    const pA = (await presetRepo.get('preset-a'))!;
    const edited = structuredClone(pA.preset);
    edited.prompts[0].content = 'PROMPT_ALPHA_DIY_V2';
    await saveEditedPreset('preset-a', '预设甲', edited, pA.preset);

    const hostAReopened = await createTavernHost({ storyId: 'story-a', defaults: { settings: { oai_settings: {} } } });
    try {
      const sA2 = JSON.parse((await (await hostAReopened.request('/api/settings/get')).json()).settings).oai_settings;
      expect(sA2.preset_settings_openai).toBe('预设甲');
      expect(sA2.prompts[0].content).toBe('PROMPT_ALPHA_DIY_V2');
    } finally {
      hostAReopened.close();
    }

    // Re-binding Story A in STE from preset-a to preset-b overrides prior saved _ste_story_presets!
    const storyA = (await storyRepo.get('story-a'))!;
    await storyRepo.put({ ...storyA, assets: [{ kind: 'preset', assetId: 'preset-b' }], updatedAt: 10 });
    const hostARebound = await createTavernHost({ storyId: 'story-a', defaults: { settings: { oai_settings: {} } } });
    try {
      const sA3 = JSON.parse((await (await hostARebound.request('/api/settings/get')).json()).settings).oai_settings;
      expect(sA3.preset_settings_openai).toBe('预设乙');
      expect(sA3.prompts[0].content).toBe('PROMPT_BETA_V1');
    } finally {
      hostARebound.close();
    }
  });

  it('preserves versioned disk title during unrenamed DIY saves and initial package imports, and flushes trailing SSE without \\n\\n', async () => {
    const presetRepo = getCurrentRepo<PresetItem>('presets');
    const candidatePreset = parsePreset({
      prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'V1' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    });
    const imported = buildImportedPreset(
      { key: 'k1', name: '星海预设 v2.1 Claude', preset: candidatePreset, suggestedModels: ['Claude'], duplicateTitles: [] },
      { name: '星海预设', version: 'v2.1', models: ['Claude'] },
      [],
    );
    expect(imported.title).toBe('星海预设 v2.1 Claude');
    expect(imported.catalog?.name).toBe('星海预设');
    await presetRepo.put(imported);

    // DIY edit without renaming keeps disk stem title intact
    const modified = structuredClone(imported.preset);
    modified.prompts[0].content = 'V2';
    const saved = await saveEditedPreset(imported.id, '星海预设', modified, imported.preset, '星海预设');
    expect(saved.title).toBe('星海预设 v2.1 Claude');
    expect(saved.catalog?.name).toBe('星海预设');

    // Monitor flushes trailing Anthropic tool_use SSE frame lacking trailing blank line
    const encoder = new TextEncoder();
    let outcome: CompletionOutcome | undefined;
    const monitored = monitorCompletion(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"read_source","input":{}}}\n\n'
          + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"id\\":\\"w1\\"}"}}\n\n'
          + 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n'
          + 'event: message_stop\ndata: {"type":"message_stop"}',
        ));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } }), { stream: true, onFinish: (o) => { outcome = o; } });
    await monitored.text();
    expect(outcome).toMatchObject({
      status: 'succeeded',
      finishReason: 'tool_use',
      toolCalls: [{ name: 'read_source', arguments: '{"id":"w1"}' }],
    });
  });
});
