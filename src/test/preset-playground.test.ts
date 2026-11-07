import { describe, expect, it } from 'vitest';
import { buildPresetPlaygroundRequest, selectPlaygroundWorldEntries } from '@/lib/preset-playground';
import { parsePreset } from '@/lib/preset-parser';
import { DEFAULT_ENTRY, type WorldBook } from '@/types/worldbook';
import { prepareCompletion } from '@/lib/roleplay/provider';

const preset = parsePreset({
  temperature: 0.42, top_p: 0.9, openai_max_tokens: 350, custom_prompt_post_processing: 'merge',
  prompts: [
    { identifier: 'main', role: 'system', content: '主预设 {{char}} 对 {{user}}。{{setvar::style::简洁}}' },
    ...['worldInfoBefore','charDescription','charPersonality','scenario','dialogueExamples','worldInfoAfter','chatHistory'].map(identifier => ({ identifier, marker: true })),
    { identifier: 'depth', role: 'system', content: '深度提示 {{getvar::style}}', injection_position: 1, injection_depth: 0 },
    { identifier: 'off-depth', role: 'system', content: '禁用绝对注入', injection_position: 1, injection_depth: 0 },
    { identifier: 'post', role: 'system', content: '末尾风格 {{getvar::style}}' },
  ],
  prompt_order: [{ character_id: 100000, order: ['main','worldInfoBefore','charDescription','charPersonality','scenario','dialogueExamples','worldInfoAfter','chatHistory','depth','off-depth','post'].map(identifier => ({ identifier, enabled: identifier !== 'off-depth' })) }],
});

it('uses the native ST completion group 100001 even when legacy group 100000 is empty', () => {
  const preset = parsePreset({ prompts: [
    { identifier: 'main', role: 'system', content: 'NATIVE_COMPLETION_PROMPT' },
    { identifier: 'chatHistory', marker: true },
  ], prompt_order: [
    { character_id: 100000, order: [] },
    { character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] },
  ] });
  const built = buildPresetPlaygroundRequest({ preset, messages: [{ role: 'user', content: '继续' }] });
  expect(JSON.stringify(built.messages)).toContain('NATIVE_COMPLETION_PROMPT');
  expect(built.messages.at(-1)?.content).toBe('继续');
});
const character = { name: '林', description: '住在港城', personality: '直率', scenario: '正在码头', mes_example: '{{char}}: 范例应答' };
const worldbook: WorldBook = { entries: {
  '1': { ...DEFAULT_ENTRY, uid: 1, constant: true, position: 0, content: '世界常驻信息' },
  '2': { ...DEFAULT_ENTRY, uid: 2, key: ['港城'], keysecondary: ['码头'], position: 1, content: '港城关键词信息' },
  '3': { ...DEFAULT_ENTRY, uid: 3, key: ['荒漠'], content: '未命中内容' },
  '4': { ...DEFAULT_ENTRY, uid: 4, constant: true, enabled: false, content: '禁用世界书' },
  '5': { ...DEFAULT_ENTRY, uid: 5, constant: true, position: 6, depth: 0, role: 1, content: '深度世界信息' },
} };

describe('temporary preset prompt pipeline', () => {
  it.each(['openai_responses', 'claude_messages', 'gemini_interactions'])('uses the matching custom %s source entry and preserves inactive source YAML', format => {
    const raw = { prompts: [], prompt_order: [], chat_completion_source: 'custom', custom_api_format: format, additional_parameters_migration_version: 1,
      custom_exclude_body: 'invalid legacy scalar', additional_parameters_by_source: { custom: { include_body: 'stream: false' }, [`custom_${format}`]: { include_body: 'top_k: 17', exclude_body: '', include_headers: 'X-Request: fixture' } } };
    const preset = parsePreset(raw), before = structuredClone(preset);
    const built = buildPresetPlaygroundRequest({ preset, messages: [{ role: 'user', content: 'hello' }] });
    const prepared = prepareCompletion({ apiUrl: 'https://example.invalid/v1/chat/completions', model: 'test', apiKey: '' }, built.request);
    expect(prepared.body).toMatchObject({ top_k: 17, stream: true });
    expect(prepared.headers).toMatchObject({ 'X-Request': 'fixture' });
    expect(preset).toEqual(before);
  });
  it('uses ST source parameters instead of dormant legacy YAML after migration', () => {
    const input = parsePreset({ ...JSON.parse(JSON.stringify(preset.originalData)), prompts: [], prompt_order: [],
      chat_completion_source: 'custom', additional_parameters_migration_version: 1,
      custom_exclude_body: '{}', custom_include_body: 'stream: false',
      additional_parameters_by_source: { custom: { include_body: 'top_k: 24', exclude_body: '- temperature', include_headers: '' } },
    });
    const built = buildPresetPlaygroundRequest({ preset: input, messages: [{ role: 'user', content: 'hello' }] });
    const result = prepareCompletion({ apiUrl: 'https://example.invalid/v1/chat/completions', model: 'test', apiKey: '' }, built.request);
    expect(result.body.top_k).toBe(24);
    expect(result.body.temperature).toBeUndefined();
    expect(result.body.stream).toBe(true);
  });
  it('uses enabled order, card markers, local variables, keyword world info and depth without changing assets', () => {
    const before = structuredClone({ preset, character, worldbook });
    const built = buildPresetPlaygroundRequest({ preset, character, worldbook, userName: '旅人', messages: [{ role: 'user', content: '去港城码头' }] });
    const content = built.messages.map(message => message.content).join('\n');
    for (const text of ['主预设 林 对 旅人', '住在港城', '直率', '正在码头', '林: 范例应答', '世界常驻信息', '港城关键词信息', '深度世界信息', '深度提示 简洁', '末尾风格 简洁']) expect(content).toContain(text);
    for (const text of ['禁用绝对注入', '禁用世界书', '未命中内容', '{{getvar']) expect(content).not.toContain(text);
    expect(built.messages.at(-1)?.content).toBe('末尾风格 简洁');
    expect(built.messages.find(message => message.content === '深度世界信息')?.role).toBe('user');
    expect(built.worldEntryCount).toBe(3);
    expect({ preset, character, worldbook }).toEqual(before);
    const prepared = prepareCompletion({ apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture', model: 'chosen-model' }, built.request);
    expect(prepared.body).toMatchObject({ model: 'chosen-model', temperature: 0.42, top_p: 0.9, max_tokens: 350, stream: true });
    expect(JSON.stringify(prepared.body.messages)).toContain('港城关键词信息');
    expect(prepared.body).not.toHaveProperty('prompts');
  });
  it('honors secondary keyword logic, scan depth and manual world modes', () => {
    const history = [{ role: 'user' as const, content: '港城码头' }, { role: 'assistant' as const, content: '回复' }];
    const book: WorldBook = { entries: { x: { ...DEFAULT_ENTRY, uid: 1, key: ['港城'], keysecondary: ['码头'], selectiveLogic: 2, content: '内容' } } };
    expect(selectPlaygroundWorldEntries(book, history, 'keywords')).toHaveLength(0);
    book.entries.x.selectiveLogic = 3;
    expect(selectPlaygroundWorldEntries(book, history, 'keywords')).toHaveLength(1);
    book.entries.x.scanDepth = 1;
    expect(selectPlaygroundWorldEntries(book, history, 'keywords')).toHaveLength(0);
    book.entries.x.scanDepth = 0;
    expect(selectPlaygroundWorldEntries(book, history, 'keywords')).toHaveLength(0);
    expect(selectPlaygroundWorldEntries(book, history, 'constant')).toHaveLength(0);
    expect(selectPlaygroundWorldEntries(book, history, 'all')).toHaveLength(1);
  });
  it('preserves selected disabled markers and makes missing injections explicit', () => {
    const limited = parsePreset({ prompts: [{ identifier: 'main', content: 'Main' }], prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }] });
    const built = buildPresetPlaygroundRequest({ preset: limited, character, worldbook, messages: [{ role: 'user', content: 'Hello' }] });
    expect(built.messages.at(-2)?.content).toBe('Hello');
    expect(built.warnings.join(' ')).toContain('未启用角色设定插槽');
    expect(built.warnings.join(' ')).toContain('世界书位置对应的预设插槽未启用');
  });
  it('anchors several depth injections to the original history rather than to earlier injected messages', () => {
    const injected = parsePreset({ prompts: [
      { identifier: 'chatHistory', marker: true },
      { identifier: 'last', content: 'after history', injection_position: 1, injection_depth: 0 },
      { identifier: 'before', content: 'before latest user', injection_position: 1, injection_depth: 1 },
    ], prompt_order: [{ character_id: 100000, order: ['chatHistory','last','before'].map(identifier => ({ identifier, enabled: true })) }] });
    const built = buildPresetPlaygroundRequest({ preset: injected, messages: [{ role: 'user', content: 'current user' }] });
    expect(built.messages.map(message => message.content)).toEqual(['before latest user', 'current user', 'after history']);
  });
  it('does not execute bundled scripts and exposes unsupported macros', () => {
    const scripted = parsePreset({ prompts: [{ identifier: 'main', content: 'Hello {{script::run}}' }], prompt_order: [], extensions: { scripts: [{ type: 'script', name: 'script', content: 'throw new Error("must not execute")' }] } });
    const built = buildPresetPlaygroundRequest({ preset: scripted, messages: [{ role: 'user', content: 'Hi' }] });
    expect(built.warnings.join(' ')).toContain('不执行');
    expect(built.warnings.join(' ')).toContain('script');
    expect(JSON.stringify(built.messages)).not.toContain('must not execute');
  });
});
