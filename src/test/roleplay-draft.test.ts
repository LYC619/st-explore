import { expect, it } from 'vitest';
import type { ChatSession } from '@/types/chat';
import { checkpointDraft, recoverDraft } from '@/lib/roleplay/draft';
import { captureRecoveryFile } from '@/tavern/recovery-export.ts';

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

it('exports a pending candidate edit and unsent input without changing live messages or dropping plugin data', () => {
  document.body.innerHTML = '<div id="chat"><div class="mes" mesid="0"><textarea class="edit_textarea"></textarea></div></div><textarea id="send_textarea"></textarea>';
  const st = { name1: '旅人', name2: '林', getCurrentChatId: () => '雨夜/分支',
    chat_metadata: { plugin: { keep: true } },
    chat: [{ mes: '候选二', swipe_id: 1, swipes: ['候选一', '候选二'],
      swipe_info: [{ extra: { candidate: 1 } }, { extra: { candidate: 2 } }], extra: { bbs: '保留' } }] };
  const original = structuredClone({ chat: st.chat, metadata: st.chat_metadata });
  try {
    document.querySelector<HTMLTextAreaElement>('.edit_textarea')!.value = '还没有点完成的编辑';
    document.querySelector<HTMLTextAreaElement>('#send_textarea')!.value = '还没有发送';
    const output = captureRecoveryFile(st);
    const rows = output.text.trim().split('\n').map((line: string) => JSON.parse(line));
    expect(rows[0]).toMatchObject({ chat_metadata: { plugin: { keep: true }, ste_recovery: { input: '还没有发送' } } });
    expect(rows[1]).toMatchObject({ mes: '还没有点完成的编辑', swipe_id: 1, swipes: ['候选一', '还没有点完成的编辑'],
      swipe_info: [{ extra: { candidate: 1 } }, { extra: { candidate: 2 } }], extra: { bbs: '保留' } });
    expect({ chat: st.chat, metadata: st.chat_metadata }).toEqual(original);
    expect(output.fileName).not.toMatch(/[<>:"/\\|?*]/);
  } finally { document.body.replaceChildren(); }
});
