import type { ArchiveStory } from '@/types/archive';
import { serializeChatJsonl } from '@/lib/adapters/st/chat-jsonl';
import { buildChatExportSession } from '@/lib/chat-export-policy';

export type StoryFileFormat = 'json' | 'jsonl' | 'jsonl-slim';
export function buildStoryFileExport(story: ArchiveStory, branchId: string | null, format: StoryFileFormat) {
  const branch = branchId === null ? null : story.branches?.find(item => item.id === branchId);
  if (branchId !== null && !branch) throw new Error('分支不存在，请刷新故事列表');
  const session = buildChatExportSession(branch?.session ?? story.session, story.settings, format !== 'jsonl-slim');
  const metadata = session.rawMetadata;
  const messages = session.messages;
  const extension = format === 'jsonl-slim' ? 'jsonl' : format;
  const title = `${story.title}${branch ? ' - ' + branch.name : ''}`;
  // eslint-disable-next-line no-control-regex -- Remove filesystem-invalid control bytes from download names.
  const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 150) || '故事';
  return {
    fileName: `${safeTitle}${format === 'jsonl-slim' ? '_cleaned' : ''}.${extension}`, label: format === 'jsonl-slim' ? 'SillyTavern JSONL（精简）' : '故事 ' + format.toUpperCase(), extension,
    text: format === 'json'
      ? JSON.stringify({ metadata, messages: messages.map(message => message.rawData) }, null, 2)
      : serializeChatJsonl({ ...session, rawMetadata: metadata, messages }),
  };
}
