import { describe, expect, it } from 'vitest';
import { prepareCompletion } from '@/lib/roleplay/provider';
const profile = { apiUrl: 'https://fixture.invalid/completion', apiKey: '', model: 'test' };
const prepare = (mode: string, messages: unknown[], extra = {}) => prepareCompletion(profile, {
  messages, custom_prompt_post_processing: mode, user_name: '旅人', char_name: '角色', ...extra,
}).body.messages;

describe('native prompt post processing', () => {
  it.each(['merge', 'claude', 'merge_tools'])('%s merges adjacent roles without changing source data', mode => {
    const messages = [{ role: 'system', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }];
    expect(prepare(mode, messages)).toEqual([{ role: 'system', content: 'a' }, { role: 'user', content: 'b\n\nc' }]);
    expect(messages).toHaveLength(3);
  });
  it.each(['semi', 'semi_tools'])('%s moves later system messages to user', mode => {
    expect(prepare(mode, [{ role: 'system', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'system', content: 'c' }]))
      .toEqual([{ role: 'system', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]);
  });
  it.each(['strict', 'strict_tools'])('%s inserts the initial user placeholder', mode => {
    expect(prepare(mode, [{ role: 'system', content: 'a' }, { role: 'assistant', content: 'b' }]))
      .toEqual([{ role: 'system', content: 'a' }, { role: 'user', content: "Let's get started." }, { role: 'assistant', content: 'b' }]);
  });
  it('single preserves speaker names in one user message', () => {
    expect(prepare('single', [{ role: 'system', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }]))
      .toEqual([{ role: 'user', content: 'a\n\n旅人: b\n\n角色: c' }]);
  });
  it('preserves tool boundaries in tools modes and flattens them otherwise', () => {
    const messages = [{ role: 'assistant', content: null, tool_calls: [{ id: 'x' }] }, { role: 'tool', tool_call_id: 'x', content: 'result' }];
    expect(prepare('merge_tools', messages)).toEqual([{ ...messages[0], content: '' }, messages[1]]);
    expect(prepare('merge', messages)).toEqual([{ role: 'assistant', content: '' }, { role: 'user', content: 'result' }]);
  });
  it('keeps media and names in the merged multimodal message', () => {
    const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } };
    expect(prepare('merge', [{ role: 'user', content: [{ type: 'text', text: 'look' }, image] }, { role: 'user', content: 'reply', name: '旅人' }]))
      .toEqual([{ role: 'user', content: [{ type: 'text', text: 'look' }, image, { type: 'text', text: '旅人: reply' }] }]);
  });
  it('converts named examples without duplicating speaker prefixes', () => {
    expect(prepare('merge', [{ role: 'system', name: 'example_user', content: '旅人: b' }, { role: 'system', name: 'example_assistant', content: 'c' }]))
      .toEqual([{ role: 'system', content: '旅人: b\n\n角色: c' }]);
  });
});
