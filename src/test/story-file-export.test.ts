import { describe, expect, it } from 'vitest';
import { buildStoryFileExport } from '@/lib/story-file-export';
import { parseJson, parseJsonl } from '@/lib/adapters/st/chat-jsonl';
import type { ArchiveStory } from '@/types/archive';

const story = { id: 's', title: '故事/标题', session: { id: 'session', title: '故事', createdAt: 1,
  user: { name: '我' }, character: { name: '角色' },
  rawMetadata: { user_name: '我', character_name: '角色', chat_metadata: { variables: { score: 8 } } },
  messages: [{ id: 'm', role: 'assistant', content: '修改后的正文', hidden: true, timestamp: 1000,
    rawData: { name: '角色', mes: '旧正文', swipes: ['候选1', '旧正文'], swipe_id: 1, extra: { model: 'm' } } }],
}, branches: [{ id: 'b', name: '另一条线', session: { id: 'branch', title: '分支', createdAt: 1,
  user: { name: '我' }, character: { name: '角色' }, messages: [{ id: 'b1', role: 'user', content: '分支正文' }] },
  markers: [], createdAt: 1, updatedAt: 1 }], markers: [], createdAt: 1, updatedAt: 1,
  meta: { modelsUsed: [], playTimeMs: null },
} as ArchiveStory;

describe('direct story exports', () => {
  it.each(['json', 'jsonl'] as const)('%s preserves edits, hidden state, candidates, metadata and original object', format => {
    const before = structuredClone(story);
    const file = buildStoryFileExport(story, null, format);
    const result = format === 'json' ? parseJson(file.text) : parseJsonl(file.text);
    expect(result.messages[0]).toMatchObject({ content: '修改后的正文', hidden: true,
      rawData: { swipes: ['候选1', '修改后的正文'], swipe_id: 1, extra: { model: 'm' } } });
    expect(result.metadata?.chat_metadata).toEqual({ variables: { score: 8 } });
    expect(file.fileName).toBe(`故事_标题.${format}`);
    expect(story).toEqual(before);
  });
  it('exports the requested branch and rejects a missing branch instead of silently using main', () => {
    const file = buildStoryFileExport(story, 'b', 'json');
    expect(parseJson(file.text).messages.map(m => m.content)).toEqual(['分支正文']);
    expect(file.fileName).toContain('另一条线');
    expect(() => buildStoryFileExport(story, 'deleted', 'json')).toThrow('分支不存在');
  });
});
