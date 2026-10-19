import type { ChatSession, ExportSettings, STRawMessage } from '@/types/chat';
import { applyRegexRules, getMessageDepths } from '@/lib/regex-processor';

export const CHAT_METADATA_KEEP_KEYS = ['chat_id_hash', 'note_prompt', 'note_interval', 'note_position', 'note_depth', 'note_role', 'tainted', 'variables', 'main_chat', 'timedWorldInfo'];

/** Shared by quick story exports and the processing dialog. All work is on detached copies. */
export function buildChatExportSession(session: ChatSession, settings?: Partial<ExportSettings>, fullBackup = false): ChatSession {
  const output = structuredClone(session);
  output.rawMetadata ??= { user_name: session.user.name, character_name: session.character.name };
  if (!fullBackup && settings?.cleanPluginCache !== false && output.rawMetadata.chat_metadata) {
    output.rawMetadata.chat_metadata = Object.fromEntries(Object.entries(output.rawMetadata.chat_metadata).filter(([key]) => CHAT_METADATA_KEEP_KEYS.includes(key)));
  }
  const depths = getMessageDepths(session.messages);
  let messages = output.messages;
  if (!fullBackup && settings?.exportRange === 'recent') messages = messages.slice(-Math.max(1, settings.recentCount ?? 100));
  if (!fullBackup && settings?.exportRange === 'custom') messages = messages.slice(Math.max(0, settings.customStart ?? 0), (settings.customEnd ?? messages.length - 1) + 1);
  output.messages = messages.flatMap(message => {
    const isUser = message.role === 'user';
    const content = fullBackup ? message.content : applyRegexRules(message.content, settings?.regexRules ?? [], isUser, depths.get(message.id));
    if (!fullBackup && !content.trim()) return [];
    const raw: STRawMessage = { ...(message.rawData ?? {}), name: message.name ?? message.rawData?.name ?? (isUser ? session.user.name : session.character.name),
      is_user: isUser, is_system: message.hidden === true || (message.role === 'system' && !['narrator', 'comment'].includes(message.rawData?.extra?.type)), mes: content };
    if (raw.send_date == null && message.timestamp !== undefined) raw.send_date = message.timestamp;
    if (!fullBackup && settings?.slimExport !== false) { raw.swipes = []; raw.swipe_id = 0; raw.swipe_info = []; }
    else if (Array.isArray(raw.swipes)) {
      const index = raw.swipe_id ?? 0;
      if (Number.isInteger(index) && index >= 0 && index < raw.swipes.length) raw.swipes[index] = content;
    }
    return [{ ...message, content, rawData: raw }];
  });
  return output;
}
