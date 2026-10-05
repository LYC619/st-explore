import type { ArchiveStory } from '@/types/archive';
import type { STRawMessage } from '@/types/chat';
import { serializeChatJsonl } from '@/lib/adapters/st/chat-jsonl';

export type StoryFileFormat = 'json' | 'jsonl';
export function buildStoryFileExport(story: ArchiveStory, branchId: string | null, format: StoryFileFormat) {
  const branch = branchId === null ? null : story.branches?.find(item => item.id === branchId);
  if (branchId !== null && !branch) throw new Error('分支不存在，请刷新故事列表');
  const session = branch?.session ?? story.session;
  const metadata = structuredClone(session.rawMetadata ?? {
    user_name: session.user.name, character_name: session.character.name,
  });
  const messages = session.messages.map(message => {
    const raw: STRawMessage = {
      ...structuredClone(message.rawData ?? {}),
      name: message.name ?? message.rawData?.name ?? (message.role === 'user' ? session.user.name : session.character.name),
      is_user: message.role === 'user',
      is_system: message.hidden === true || message.role === 'system',
      mes: message.content,
    };
    if (raw.send_date == null && message.timestamp !== undefined) raw.send_date = message.timestamp;
    if (Array.isArray(raw.swipes)) {
      const index = raw.swipe_id ?? 0;
      if (Number.isInteger(index) && index >= 0 && index < raw.swipes.length) raw.swipes[index] = message.content;
    }
    return { ...message, rawData: raw };
  });
  const title = `${story.title}${branch ? ' - ' + branch.name : ''}`;
  // eslint-disable-next-line no-control-regex -- Remove filesystem-invalid control bytes from download names.
  const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 150) || '故事';
  return {
    fileName: `${safeTitle}.${format}`, label: '故事 ' + format.toUpperCase(), extension: format,
    text: format === 'json'
      ? JSON.stringify({ metadata, messages: messages.map(message => message.rawData) }, null, 2)
      : serializeChatJsonl({ ...session, rawMetadata: metadata, messages }),
  };
}
