import { expect, it } from 'vitest';
import { buildScopedTreeRequest } from '@/lib/story-tree-context';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import type { SummaryItem } from '@/types/summary';
import { estimateTokens } from '@/lib/preset-parser';
const session = { id: 's', title: '故事', character: { name: 'c' }, user: { name: 'u' }, createdAt: 1, messages: [{ id: 'm', role: 'assistant' as const, content: '事实 foo' }] };
const records = ['main', 'branch', 'foreign'].map((id): SummaryItem => ({ id, title: id, bookId: id === 'foreign' ? 'other' : 'story', bookTitle: '故事', branchId: id === 'branch' ? 'b' : undefined,
  kind: id === 'branch' ? 'diary' : 'volume', diaryOwner: '乔伊', content: `${id}参考`, floorStart: 0, floorEnd: 0, createdAt: 1, updatedAt: 1 }));

it('assembles scoped references, worldbook and processed input without mutating the source', () => {
  const result = buildScopedTreeRequest({ storyId: 'story', branchId: null, session, nodes: [], floorStart: 0, floorEnd: 0,
    references: records, processed: true, regexRules: [{ id: 'r', name: '清理', findRegex: 'foo', replaceString: 'bar', placement: ['all'], disabled: false }],
    worldbook: { entries: { 0: { ...DEFAULT_ENTRY, uid: 0, enabled: true, constant: true, content: '世界设定' } } } });
  const text = result.messages.map(message => message.content).join('\n');
  expect(text).toContain('事实 bar'); expect(text).toContain('世界设定'); expect(text).toContain('main参考');
  expect(text).not.toContain('branch参考'); expect(text).not.toContain('foreign参考');
  expect(text).toContain('JSON'); expect(session.messages[0].content).toBe('事实 foo');
  expect(result.tokenEstimate).toBeGreaterThanOrEqual(estimateTokens(result.messages[0].content));
  const explicit = buildScopedTreeRequest({ storyId: 'story', branchId: null, session, nodes: [], floorStart: 0, floorEnd: 0, references: records, allowCrossBranch: true });
  expect(explicit.messages.map(message => message.content).join('\n')).toContain('乔伊');
});
