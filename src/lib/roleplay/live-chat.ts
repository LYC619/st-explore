import type { ChatMessage, ChatSession, STMetadata, STRawMessage } from '@/types/chat';
import { parseSTDate } from '@/lib/adapters/st/chat-jsonl';

export type LiveChatPayload = [STMetadata, ...STRawMessage[]];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNarrativeMessage(raw: STRawMessage): boolean {
  return raw.extra?.type === 'narrator' || raw.extra?.type === 'comment';
}

function stampCandidates(raw: STRawMessage, messageId: string, role: ChatMessage['role']) {
  if (!Array.isArray(raw.swipes) || !raw.swipes.length) return;
  raw.swipe_info = raw.swipes.map((_, index) => {
    const info = raw.swipe_info?.[index] ?? {};
    return { ...info, extra: { ...info.extra, ste_runtime: {
      ...info.extra?.ste_runtime, messageId, role,
      candidateId: info.extra?.ste_runtime?.candidateId
        ?? (index === 0 && raw.extra?.ste_runtime?.candidateId === `${messageId}:main` ? `${messageId}:main` : `${messageId}:legacy:${index}`),
    } } };
  });
  raw.extra!.ste_runtime.candidateId = raw.swipe_info[raw.swipe_id ?? 0].extra.ste_runtime.candidateId;
}

/** This codec is for a running chat. The import parser intentionally has different loss/ID rules. */
export function encodeLiveChat(session: ChatSession): LiveChatPayload {
  const header: STMetadata = {
    ...structuredClone(session.rawMetadata ?? {}),
    user_name: session.user.name,
    character_name: session.character.name,
    chat_metadata: structuredClone(session.rawMetadata?.chat_metadata ?? {}),
  };
  return [header, ...session.messages.map(message => {
    const raw: STRawMessage = structuredClone(message.rawData ?? {});
    raw.mes = message.content;
    raw.name = message.name ?? raw.name ?? (message.role === 'user' ? session.user.name : session.character.name);
    raw.is_user = message.role === 'user';
    // ST narrator/comment roles have independent visibility; current edits override rawData.
    raw.is_system = message.hidden === true || (message.role === 'system' && !isNarrativeMessage(raw));
    if (raw.send_date === undefined && message.timestamp !== undefined) raw.send_date = message.timestamp;
    raw.extra = {
      ...raw.extra,
      ste_runtime: { ...raw.extra?.ste_runtime, messageId: message.id, role: message.role },
    };
    if (!raw.swipes?.length) raw.extra.ste_runtime.candidateId ??= `${message.id}:main`;
    if (Array.isArray(raw.swipes) && raw.swipes.length) {
      const index = raw.swipe_id ?? 0;
      if (!Number.isInteger(index) || index < 0 || index >= raw.swipes.length) throw new Error('消息候选下标无效');
      raw.swipes[index] = message.content;
    }
    stampCandidates(raw, message.id, message.role);
    return raw;
  })];
}

export function decodeLiveChat(payload: unknown, previous: ChatSession, activeUserName?: string): ChatSession {
  if (!Array.isArray(payload) || !isRecord(payload[0]) || 'mes' in payload[0]) {
    throw new Error('聊天保存数据缺少元信息');
  }
  if (payload[0].chat_metadata !== undefined && !isRecord(payload[0].chat_metadata)) {
    throw new Error('聊天元信息格式无效');
  }
  const previousById = new Map(previous.messages.map(message => [message.id, message]));
  const userName = activeUserName?.trim() || previous.user.name;
  const ids = new Set<string>();
  const messages: ChatMessage[] = payload.slice(1).map(value => {
    if (!isRecord(value) || typeof value.mes !== 'string') throw new Error('消息正文必须是文本');
    const raw = structuredClone(value) as STRawMessage & { mes: string };
    const id = raw.extra?.ste_runtime?.messageId;
    if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error('消息缺少有效的 STE ID');
    if (ids.has(id)) throw new Error(`消息 ID 重复：${id}`);
    ids.add(id);
    const old = previousById.get(id);
    const explicitSystem = raw.extra?.ste_runtime?.role === 'system'
      || ['system', 'narrator', 'comment'].includes(raw.extra?.type);
    const role: ChatMessage['role'] = raw.is_user ? 'user' : explicitSystem ? 'system' : 'assistant';
    // Only a new message and explicit live persona provenance can repair an upstream placeholder.
    // Existing names (including a real user named "unused") remain historical data.
    if (!old && role === 'user' && activeUserName?.trim() && (!raw.name || raw.name === 'unused')) raw.name = userName;
    if (raw.swipes !== undefined) {
      if (!Array.isArray(raw.swipes) || raw.swipes.some(text => typeof text !== 'string')) {
        throw new Error('消息候选正文必须是文本');
      }
      if (raw.swipes.length || raw.swipe_id !== undefined) {
        const index = raw.swipe_id ?? 0;
        if (!Number.isInteger(index) || index < 0 || index > raw.swipes.length) throw new Error('消息候选下标无效');
        // Native overswipe reserves the next index before filling its array. A metadata
        // save or recovery checkpoint can observe that state. Materialize only this
        // independent snapshot; the live ST array remains owned by its generation.
        raw.swipes[index] = raw.mes;
      }
    }
    raw.extra = { ...raw.extra, ste_runtime: { ...raw.extra?.ste_runtime, messageId: id, role } };
    stampCandidates(raw, id, role);
    const swipeDate = raw.swipe_info?.[raw.swipe_id ?? 0]?.send_date;
    return {
      ...old,
      id, role, content: raw.mes, name: raw.name ?? old?.name,
      is_user: role === 'user',
      hidden: raw.is_system === true && (role !== 'system' || isNarrativeMessage(raw)),
      timestamp: parseSTDate(swipeDate) ?? parseSTDate(raw.send_date) ?? old?.timestamp,
      rawData: raw,
    };
  });
  return {
    ...previous,
    user: { ...previous.user, name: userName },
    messages,
    rawMetadata: {
      ...structuredClone(previous.rawMetadata ?? {}),
      ...structuredClone(payload[0]),
      // Upstream saves literal "unused" names. They must not rename the STE session.
      user_name: userName,
      character_name: previous.character.name,
    },
  };
}
