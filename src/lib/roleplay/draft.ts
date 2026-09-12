import type { ChatMessage, ChatSession } from '@/types/chat';
import { candidateIdentity, digest, stableJson } from './fingerprint';

export interface DraftCheckpoint {
  version: 1;
  savedAt: number;
  baseDigest: string;
  resultDigest: string;
  input: string;
  order?: string[];
  changes: ChatMessage[];
}

function messageKey(message: ChatMessage) {
  return stableJson({ id: message.id, role: message.role, content: message.content, hidden: !!message.hidden,
    candidate: candidateIdentity(message), swipes: (message.rawData?.swipes?.length ?? 0) > 1 ? message.rawData?.swipes : undefined });
}
const historyKey = (session: ChatSession) => digest(stableJson(session.messages.map(messageKey)));

/** A recovery draft is a sparse delta, never a second persisted story or an adopted completion. */
export function checkpointDraft(base: ChatSession, live: ChatSession, input: string, editor?: { index: number; text: string }): DraftCheckpoint {
  const next = structuredClone(live);
  const editing = editor && next.messages[editor.index];
  if (editing) {
    editing.content = editor.text;
    if (editing.rawData) {
      editing.rawData.mes = editor.text;
      if (editing.rawData.swipes?.length) editing.rawData.swipes[editing.rawData.swipe_id ?? 0] = editor.text;
    }
  }
  const previous = new Map(base.messages.map(message => [message.id, messageKey(message)]));
  const order = next.messages.map(message => message.id);
  return { version: 1, savedAt: Date.now(), baseDigest: historyKey(base), resultDigest: historyKey(next), input,
    ...(stableJson(order) !== stableJson(base.messages.map(message => message.id)) ? { order } : {}),
    changes: next.messages.filter(message => previous.get(message.id) !== messageKey(message)) };
}

export function recoverDraft(current: ChatSession, draft: DraftCheckpoint): { session: ChatSession; input: string; conflict: boolean; changed: boolean } {
  if (draft?.version !== 1 || typeof draft.input !== 'string' || !Array.isArray(draft.changes)
    || draft.changes.some(message => typeof message?.id !== 'string' || typeof message?.content !== 'string')
    || draft.order && (!Array.isArray(draft.order) || draft.order.some(id => typeof id !== 'string'))) {
    throw new Error('草稿格式无效，已保留原文件');
  }
  const key = historyKey(current);
  const session = structuredClone(current);
  if (key === draft.resultDigest) return { session, input: draft.input, conflict: false, changed: false };
  if (key !== draft.baseDigest) return { session, input: draft.input, conflict: true, changed: false };
  const messages = new Map(session.messages.map(message => [message.id, message]));
  for (const change of draft.changes) {
    const recovered = structuredClone(change);
    delete recovered.rawData?.extra?.ste_runtime?.turnId;
    for (const swipe of recovered.rawData?.swipe_info ?? []) delete swipe.extra?.ste_runtime?.turnId;
    messages.set(recovered.id, recovered);
  }
  const order = draft.order ?? session.messages.map(message => message.id);
  if (new Set(order).size !== order.length || order.some(id => !messages.has(id))) throw new Error('草稿消息顺序无效，已保留原文件');
  session.messages = order.map(id => messages.get(id)!);
  return { session, input: draft.input, conflict: false, changed: true };
}
