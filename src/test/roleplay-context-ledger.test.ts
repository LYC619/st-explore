import { expect, it } from 'vitest';
import { createContextLedger } from '@/lib/roleplay/context-ledger';
import type { RuntimeStore } from '@/lib/roleplay/runtime-store';
import type { ChatSession } from '@/types/chat';
import { prepareCompletion } from '@/lib/roleplay/provider';

function fixture() {
  const files = new Map<string, string>();
  const store: RuntimeStore = { storyId: 's', read: async path => files.get(path) ?? null,
    write: async (path, text) => { files.set(path, text); }, remove: async path => { files.delete(path); },
    list: async prefix => [...files.keys()].filter(path => !prefix || path.startsWith(prefix + '/')) };
  const session: ChatSession = { id: 's', title: 's', createdAt: 1, user: { name: '我' }, character: { name: '林' }, messages: [{ id: 'u', role: 'user', content: '开门' }] };
  const prepare = (messages: unknown[]) => prepareCompletion({ apiUrl: 'https://provider.invalid/completion', model: 'main', apiKey: 'never-record-this' }, { messages });
  return { files, store, session, prepare, ledger: createContextLedger({ store, branchId: null }) };
}

it('applies preset strict/single processing after inserting Agent supplements', async () => {
  for (const mode of ['strict', 'single']) {
    const f = fixture();
    const prepared = prepareCompletion({ apiUrl: 'https://provider.invalid/completion', model: 'main', apiKey: '' }, {
      messages: [{ role: 'system', content: '设定' }, { role: 'user', content: '开门' }], custom_prompt_post_processing: mode,
    });
    const result = await f.ledger.prepare(prepared, '最新背景', f.session, 't1');
    const messages = result.prepared.body.messages as { role: string; content: string }[];
    expect(messages.slice(1).every(m => m.role !== 'system')).toBe(true);
    expect(messages.at(-1)?.content).toContain('最新背景');
    if (mode === 'single') expect(messages).toHaveLength(1);
  }
});

it('freezes prior supplements in their exact position in the final provider messages across reloads', async () => {
  const f = fixture();
  const base = [{ role: 'system', content: '设定' }, { role: 'user', content: '开门' }];
  const first = await f.ledger.prepare(f.prepare(base), '第一轮资料', f.session, 't1');
  await f.ledger.finish('t1', 'succeeded');
  f.session.messages.push({ id: 'a', role: 'assistant', content: '门开了。' });
  await f.ledger.adopt('t1', f.session, 'a');
  f.session.messages.push({ id: 'u2', role: 'user', content: '走进去' });
  const reopened = createContextLedger({ store: f.store, branchId: null });
  const second = await reopened.prepare(f.prepare([...base, { role: 'assistant', content: '门开了。' }, { role: 'user', content: '走进去' }]), '第二轮资料', f.session, 't2');
  expect((second.prepared.body.messages as unknown[]).slice(0, 3)).toEqual(first.prepared.body.messages);
  expect(second.metrics.sharedPrefixMessages).toBe(3);
  expect(second.record.cycleId).toBe(first.record.cycleId);
  expect([...f.files.values()].join('')).not.toContain('never-record-this');
});

it('keeps a preset post-history tail after the current supplement while preserving prior history', async () => {
  const f = fixture();
  const tail = { role: 'system', content: '正文结束后不要解释' };
  const base = [{ role: 'system', content: '设定' }, { role: 'user', content: '开门' }];
  const first = await f.ledger.prepare(f.prepare([...base, tail]), '旧资料', f.session, 't1');
  await f.ledger.finish('t1', 'succeeded');
  f.session.messages.push({ id: 'a', role: 'assistant', content: '门开了。' });
  await f.ledger.adopt('t1', f.session, 'a');
  f.session.messages.push({ id: 'u2', role: 'user', content: '进屋' });
  const second = await f.ledger.prepare(f.prepare([...base, { role: 'assistant', content: '门开了。' }, { role: 'user', content: '进屋' }, tail]), '新资料', f.session, 't2');
  expect((second.prepared.body.messages as unknown[]).slice(0, 3)).toEqual((first.prepared.body.messages as unknown[]).slice(0, 3));
  expect((second.prepared.body.messages as unknown[]).at(-1)).toEqual(tail);
  expect(second.record.cycleId).toBe(first.record.cycleId);
});

it('rebuilds a cycle after an actual custom request change and excludes cancelled or discarded candidates', async () => {
  const f = fixture();
  const first = await f.ledger.prepare(f.prepare([{ role: 'user', content: '开门' }]), '不可遗留', f.session, 't1');
  await f.ledger.finish('t1', 'cancelled');
  f.session.messages.push({ id: 'a', role: 'assistant', content: '半截' });
  await expect(f.ledger.adopt('t1', f.session, 'a')).rejects.toThrow(/成功/);
  const second = await f.ledger.prepare(prepareCompletion({ apiUrl: 'https://provider.invalid/completion', model: 'main', apiKey: '' }, {
    messages: [{ role: 'user', content: '开门' }], custom_include_body: 'messages:\n  - role: user\n    content: 真正发送的是这一段',
  }), '新资料', f.session, 't2');
  expect(JSON.stringify(second.prepared.body.messages)).not.toContain('不可遗留');
  expect(second.record.cycleId).not.toBe(first.record.cycleId);
  expect((second.prepared.body.messages as { content: string }[])[0].content).toBe('真正发送的是这一段');
});
