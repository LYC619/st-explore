import { expect, it } from 'vitest';
import { sourceRefs, refsAreCurrent } from '@/lib/roleplay/fingerprint';
import { encodeLiveChat, decodeLiveChat } from '@/lib/roleplay/live-chat';
import type { ChatSession } from '@/types/chat';

it('does not invalidate history when the original UI initializes the first swipe candidate', () => {
  const session: ChatSession = { id: 's', title: 's', createdAt: 1, user: { name: '我' }, character: { name: '林' },
    messages: [{ id: 'a', role: 'assistant', content: '原文' }] };
  const refs = sourceRefs(session);
  const payload = encodeLiveChat(session);
  payload[1].swipes = ['原文']; payload[1].swipe_id = 0;
  const adopted = decodeLiveChat(payload, session);
  expect(refsAreCurrent(refs, adopted)).toBe(true);
  payload[1].swipes.push('另一个候选'); payload[1].swipe_id = 1; payload[1].mes = '另一个候选';
  expect(refsAreCurrent(refs, decodeLiveChat(payload, session))).toBe(false);
});
