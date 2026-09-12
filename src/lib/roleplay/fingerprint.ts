import { sha256 } from 'js-sha256';
import type { ChatMessage, ChatSession } from '@/types/chat';

export const digest = (value: string) => sha256(value);
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export interface SourceRef {
  messageId: string;
  candidateId: string;
  contentDigest: string;
  historyDigest: string;
}
export function candidateIdentity(message: ChatMessage): string {
  const raw = message.rawData;
  return raw?.extra?.ste_runtime?.candidateId ?? raw?.swipe_info?.[raw.swipe_id ?? 0]?.extra?.ste_runtime?.candidateId
    ?? (raw?.swipes?.length ? `${message.id}:legacy:${raw.swipe_id ?? 0}` : `${message.id}:main`);
}
export function sourceRefs(session: ChatSession): SourceRef[] {
  let history = digest('STE roleplay history v1');
  return session.messages.map(message => {
    const candidateId = candidateIdentity(message);
    const contentDigest = digest(message.content);
    history = digest(stableJson({ previous: history, id: message.id, candidateId, contentDigest, role: message.role, hidden: !!message.hidden }));
    return { messageId: message.id, candidateId, contentDigest, historyDigest: history };
  });
}
export function refsAreCurrent(refs: SourceRef[], session: ChatSession): boolean {
  const current = new Map(sourceRefs(session).map(ref => [ref.messageId, stableJson(ref)]));
  return refs.every(ref => current.get(ref.messageId) === stableJson(ref));
}
