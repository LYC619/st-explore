import { expect, it } from 'vitest';
import type { ChatSession } from '@/types/chat';
import { checkpointDraft, recoverDraft } from '@/lib/roleplay/draft';

const base: ChatSession = { id: 's', title: '雨夜', createdAt: 1, user: { name: '我' }, character: { name: '林' },
  messages: [{ id: 'g', role: 'assistant', content: '请进。' }] };

it('stores only changed messages, restores the composer and removes factual completion identity from recovered prose', () => {
  const live = structuredClone(base);
  live.messages.push({ id: 'u', role: 'user', content: '开门' }, { id: 'a', role: 'assistant', content: '一段未完成',
    rawData: { extra: { ste_runtime: { turnId: 't', candidateId: 'a:main' } }, swipe_id: 0,
      swipes: ['一段未完成'], swipe_info: [{ extra: { ste_runtime: { turnId: 't', candidateId: 'a:main' } } }] } });
  const draft = checkpointDraft(base, live, '下一句');
  expect(draft.changes.map(change => change.id)).toEqual(['u', 'a']);
  expect(JSON.stringify(draft)).not.toContain('请进。');
  const result = recoverDraft(base, draft);
  expect(result.conflict).toBe(false);
  expect(result.input).toBe('下一句');
  expect(result.session.messages.map(message => message.content)).toEqual(['请进。', '开门', '一段未完成']);
  expect(result.session.messages[2].rawData?.extra?.ste_runtime.turnId).toBeUndefined();
  expect(result.session.messages[2].rawData?.swipe_info?.[0].extra?.ste_runtime.turnId).toBeUndefined();
});

it('does not overwrite a changed branch, and recognizes a draft already durably saved', () => {
  const live = structuredClone(base); live.messages[0].content = '正在编辑的新文字';
  const draft = checkpointDraft(base, live, '未发送');
  const changed = structuredClone(base); changed.messages[0].content = '其他窗口的新版本';
  const conflict = recoverDraft(changed, draft);
  expect(conflict.conflict).toBe(true);
  expect(conflict.session.messages[0].content).toBe('其他窗口的新版本');
  expect(recoverDraft(live, draft)).toMatchObject({ conflict: false, changed: false, input: '未发送' });
});

it('keeps an editor draft without mutating canonical chat or replacing stored metadata', () => {
  const saved = { ...base, rawMetadata: { chat_metadata: { newer: 'keep' } } };
  const draft = checkpointDraft(saved, saved, '', { index: 0, text: '尚未点完成' });
  expect(saved.messages[0].content).toBe('请进。');
  const restored = recoverDraft(saved, draft);
  expect(restored.session.messages[0].content).toBe('尚未点完成');
  expect(restored.session.rawMetadata?.chat_metadata).toEqual({ newer: 'keep' });
});
