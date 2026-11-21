import { describe, expect, it } from 'vitest';
import { helperMessages, helperMessageSource, prepareHelperMessageChanges } from '../tavern/helper-messages.ts';

function sample() {
  return [{ name: '林', mes: '原文', is_user: false, is_system: false, swipes: ['原文', '另一页'], swipe_id: 0,
    variables: [{ trust: 1 }, { trust: 2 }], extra: { ste_runtime: { messageId: 'm1', candidateId: 'c1', turnId: 'successful' } },
    swipe_info: [{ extra: { ste_runtime: { messageId: 'm1', candidateId: 'c1', turnId: 'successful' } } }, {}] }];
}
describe('helper operations on the genuine ST chat', () => {
  it('returns independent selected/swipe data without leaking mutable identity objects', () => {
    const chat = sample(), snapshot = helperMessages(chat);
    expect(snapshot[0]).toMatchObject({ message_id: 0, role: 'assistant', message: '原文', data: { trust: 1 }, swipes_data: [{ trust: 1 }, { trust: 2 }] });
    snapshot[0].data.trust = 100;
    expect(chat[0].variables[0].trust).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('successful');
  });
  it('rejects stale candidates and unknown write operations before changing any message', () => {
    const chat = sample(), sources = chat.map(helperMessageSource);
    chat[0].swipe_id = 1;
    expect(() => prepareHelperMessageChanges(chat, [{ message_id: 0, message: '变更' }], sources)).toThrow(/变化/);
    expect(() => prepareHelperMessageChanges(chat, [{ message_id: 0, swipes: [] }], chat.map(helperMessageSource))).toThrow(/字段/);
    expect(chat[0].mes).toBe('原文');
  });
  it('updates only the adopted candidate and removes successful-turn identity from edited prose', () => {
    const chat = sample();
    const [{ message }] = prepareHelperMessageChanges(chat, [{ message_id: 0, message: '手工修订', data: { trust: 3 }, extra: { ste_runtime: { turnId: 'forged' }, custom: 1 } }], chat.map(helperMessageSource), helperMessages(chat));
    expect(message.swipes).toEqual(['手工修订', '另一页']);
    expect(message.variables).toEqual([{ trust: 3 }, { trust: 2 }]);
    expect(message.extra?.ste_runtime).toEqual({ messageId: 'm1', candidateId: 'c1' });
    expect(message.swipe_info?.[0]?.extra?.ste_runtime?.turnId).toBeUndefined();
    expect(chat[0].mes).toBe('原文');
  });
  it('refuses stale data and extra fields even when the prose and candidate are unchanged', () => {
    const chat = sample(), sources = chat.map(helperMessageSource), baselines = helperMessages(chat);
    chat[0].variables[0].trust = 9;
    expect(() => prepareHelperMessageChanges(chat, [{ message_id: 0, data: { trust: 2 } }], sources, baselines)).toThrow(/变量已变化/);
    Object.assign(chat[0].extra, { custom: 'latest' });
    expect(() => prepareHelperMessageChanges(chat, [{ message_id: 0, extra: { custom: 'stale' } }], sources, baselines)).toThrow(/扩展数据已变化/);
    expect(chat[0].variables[0].trust).toBe(9);
  });
});
