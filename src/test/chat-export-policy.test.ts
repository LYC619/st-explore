import { expect, it } from 'vitest';
import { buildChatExportSession } from '@/lib/chat-export-policy';
import { buildStoryFileExport } from '@/lib/story-file-export';
import { serializeChatJsonl, parseJsonl } from '@/lib/adapters/st/chat-jsonl';
import type { ArchiveStory } from '@/types/archive';
import type { ChatSession, ExportSettings } from '@/types/chat';
const session: ChatSession = { id: 's', title: '故事', createdAt: 1, user: { name: '用户' }, character: { name: '卡' },
  rawMetadata: { user_name: '用户', character_name: '卡', chat_metadata: { variables: { x: 1 }, cacheToRemove: 'large' } }, messages: [
    { id: 'm', role: 'assistant', content: '编辑后的正文', hidden: true, rawData: { name: '卡', mes: '旧正文', swipes: ['候选', '旧正文'], swipe_id: 1, custom: { x: 2 } } },
  ] };
const settings = { regexRules: [{ id: 'r', name: '前缀', findRegex: '^', replaceString: '前缀', placement: ['all'], disabled: false }], cleanPluginCache: true,
  slimExport: true, exportRange: 'all' } as ExportSettings;
it.each(['narrator', 'comment'])('keeps a visible %s visible and explicit hidden state in both export modes', type => {
  const source: ChatSession = { ...session, messages: [{ id: 'n', role: 'system', content: '旁白', hidden: false, rawData: { extra: { type }, is_system: true } }] };
  for (const full of [false, true]) {
    expect(buildChatExportSession(source, undefined, full).messages[0].rawData?.is_system).toBe(false);
    expect(buildChatExportSession({ ...source, messages: [{ ...source.messages[0], hidden: true }] }, undefined, full).messages[0].rawData?.is_system).toBe(true);
  }
});
it('uses the same selected swipe, hidden state, regex rules and metadata for both export entries without mutation', () => {
  const before = JSON.stringify(session);
  const story = { id: 's', title: '故事', session, settings } as ArchiveStory;
  const direct = buildStoryFileExport(story, null, 'jsonl-slim');
  expect(direct.text).toBe(serializeChatJsonl(buildChatExportSession(session, settings)));
  expect(parseJsonl(direct.text).messages[0]).toMatchObject({ content: '前缀编辑后的正文', hidden: true, rawData: { swipes: [], swipe_id: 0, custom: { x: 2 } } });
  expect(JSON.stringify(session)).toBe(before);
});
it('keeps full backup candidates and unknown metadata; synchronizes the edited selected candidate', () => {
  const output = buildChatExportSession(session, settings, true);
  expect(output.messages[0].rawData?.swipes).toEqual(['候选', '编辑后的正文']);
  expect(output.rawMetadata?.chat_metadata?.cacheToRemove).toBe('large');
  expect(output.messages[0].content).toBe('编辑后的正文');
});
it('reads only the current story rules, including disabled rules already applied to the original', () => {
  const story = { id: 's', title: '故事', session, settings: { ...settings, regexRules: settings.regexRules.map(rule => ({ ...rule, disabled: true })) } } as ArchiveStory;
  expect(parseJsonl(buildStoryFileExport(story, null, 'jsonl-slim').text).messages[0].content).toBe('编辑后的正文');
  expect(parseJsonl(buildStoryFileExport({ ...story, settings: undefined }, null, 'jsonl-slim').text).messages[0].content).toBe('编辑后的正文');
});
