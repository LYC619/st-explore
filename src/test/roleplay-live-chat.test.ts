import { describe, expect, it } from 'vitest';
import type { ChatSession, STRawMessage } from '@/types/chat';
import { decodeLiveChat, encodeLiveChat } from '@/lib/roleplay/live-chat';

const session = (): ChatSession => ({
  id: 'session-1', title: '雨夜', createdAt: 12,
  character: { name: '林', avatar: 'portrait.png' }, user: { name: '旅人' },
  rawMetadata: { create_date: 'old date', foreign_header: { keep: true }, chat_metadata: { plugin: { count: 2 } } },
  messages: [
    { id: 'user-1', role: 'user', content: '开门', name: '旅人', timestamp: 100,
      rawData: { is_user: true, mes: '过期正文', foreign_message: ['keep'] } },
    { id: 'reply-1', role: 'assistant', content: '门开了', name: '林', timestamp: 200,
      rawData: { mes: '过期候选', swipes: ['另一条', '过期候选'], swipe_id: 1,
        swipe_info: [{ extra: { model: 'A' } }, { extra: { model: 'B', plugin: 3 } }],
        extra: { plugin: { ledger: [1, 2] } } } },
    { id: 'hidden-1', role: 'assistant', content: '隐藏楼', hidden: true, rawData: { is_system: true, mes: '隐藏楼' } },
    { id: 'system-1', role: 'system', content: '', rawData: { is_system: true, extra: { type: 'system' } } },
  ],
});

describe('live ST chat boundary', () => {
  it('round trips stable identities, plugin data, empty/system/hidden records without mutating its input', () => {
    const original = session();
    const before = JSON.stringify(original);
    const encoded = encodeLiveChat(original);
    const decoded = decodeLiveChat(encoded, original);
    expect(JSON.stringify(original)).toBe(before);
    expect(decoded.id).toBe(original.id);
    expect(decoded.createdAt).toBe(12);
    expect(decoded.character.avatar).toBe('portrait.png');
    expect(decoded.messages.map(m => [m.id, m.role, m.content])).toEqual(original.messages.map(m => [m.id, m.role, m.content]));
    expect(decoded.messages[2].hidden).toBe(true);
    expect(decoded.messages[3].role).toBe('system');
    expect(decoded.messages[0].rawData?.foreign_message).toEqual(['keep']);
    expect(decoded.messages[1].rawData?.extra?.plugin).toEqual({ ledger: [1, 2] });
    expect(decoded.messages[1].rawData?.swipe_info?.[1].extra.plugin).toBe(3);
    expect(decoded.rawMetadata?.foreign_header).toEqual({ keep: true });
  });

  it('exports current prose into both mes and the adopted swipe, including an intentionally empty edit', () => {
    const source = session();
    source.messages[1].content = '';
    const encoded = encodeLiveChat(source);
    expect(encoded[1].mes).toBe('开门');
    expect(encoded[2].mes).toBe('');
    expect(encoded[2].swipes).toEqual(['另一条', '']);
  });

  it('accepts a new stamped message and a swipe change while retaining original message IDs', () => {
    const source = session();
    const payload = encodeLiveChat(source);
    payload[2].mes = '另一条';
    payload[2].swipe_id = 0;
    // ST replaces the entire extra object when adopting an existing candidate.
    payload[2].extra = structuredClone(payload[2].swipe_info![0].extra);
    payload.push({ mes: '继续', is_user: true, send_date: 300,
      extra: { ste_runtime: { messageId: 'new-user' } } });
    const decoded = decodeLiveChat(payload, source);
    expect(decoded.messages[1]).toMatchObject({ id: 'reply-1', content: '另一条' });
    expect(decoded.messages.at(-1)).toMatchObject({ id: 'new-user', role: 'user', content: '继续', timestamp: 300 });
  });

  it('preserves STE names and foreign header fields when ST saves its literal unused header', () => {
    const source = session();
    const payload = encodeLiveChat(source);
    payload[0] = { user_name: 'unused', character_name: 'unused', chat_metadata: { plugin: { count: 4 } } };
    const decoded = decodeLiveChat(payload, source);
    expect(decoded.user.name).toBe('旅人');
    expect(decoded.character.name).toBe('林');
    expect(decoded.rawMetadata).toMatchObject({ foreign_header: { keep: true }, create_date: 'old date', chat_metadata: { plugin: { count: 4 } } });
  });

  it('rejects an unstamped or duplicate identity instead of silently moving bookmarks to different messages', () => {
    const source = session();
    const payload = encodeLiveChat(source);
    payload.push({ mes: '没有 ID', is_user: false });
    expect(() => decodeLiveChat(payload, source)).toThrow(/消息.*ID/);
    payload.pop();
    payload.push({ ...payload[1] } as STRawMessage);
    expect(() => decodeLiveChat(payload, source)).toThrow(/重复/);
  });

  it('validates malformed save payloads without filtering records or substituting empty content', () => {
    const source = session();
    expect(() => decodeLiveChat({}, source)).toThrow(/聊天/);
    const payload = encodeLiveChat(source);
    payload[2].mes = 42 as unknown as string;
    expect(() => decodeLiveChat(payload, source)).toThrow(/正文/);
  });
});
