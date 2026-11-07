import { expect, it } from 'vitest';
import { createProcessLog, processDetail } from '@/lib/roleplay/process-log';
const locator = { key: 'a', storyId: 's', branchId: null, avatar: 'a.png', fileName: 'chat' };

it('separates turns and candidates, keeps observer errors out of generation, bounds records and details', () => {
  const log = createProcessLog(() => ['credential'], () => 123);
  log.subscribe(() => { throw new Error('broken UI'); });
  const a = log.start(locator, 'normal');
  const b = log.start({ ...locator, key: 'b', branchId: 'branch' }, 'swipe');
  log.bind(a, 'm', 'c', 2); log.event(a, 'request', '请求', { apiKey: 'credential', messages: ['hello credential'] });
  log.finish(a, 'succeeded');
  expect(log.get(a)).toMatchObject({ messageId: 'm', candidateId: 'c', status: 'succeeded', startedAt: 123 });
  expect(log.get(b)).toMatchObject({ key: 'b', status: 'pending', events: [] });
  expect(JSON.stringify(log.snapshot())).not.toContain('credential');
  for (let i = 0; i < 60; i++) log.event(a, 'response', '返回', 'x'.repeat(25_000));
  expect(log.get(a)!.events.length).toBeLessThanOrEqual(40);
  expect(log.get(a)!.events.reduce((n, e) => n + (e.detail?.length ?? 0), 0)).toBeLessThanOrEqual(64_000);
  for (let i = 0; i < 30; i++) log.start(locator, 'normal');
  expect(log.snapshot()).toHaveLength(20);
  log.clear(); expect(log.snapshot()).toEqual([]);
});

it('redacts nested credentials before truncating while preserving useful token settings', () => {
  const text = processDetail({ max_tokens: 500, headers: { Authorization: 'anything' }, body: { access_token: 'other' }, prompt: 'key-secret' }, ['key-secret']);
  expect(text).toContain('500'); expect(text).not.toContain('anything'); expect(text).not.toContain('other'); expect(text).not.toContain('key-secret');
});

it('keeps unsupported plugin details out of the generation and save failure path', () => {
  const log = createProcessLog(); const id = log.start(locator, 'normal');
  const hostile = { get detail() { throw new Error('plugin getter'); } };
  expect(() => log.event(id, 'variables', '变量', hostile)).not.toThrow();
  log.event(id, 'variables', '变量', { count: 12n });
  expect(log.get(id)!.events.at(-1)!.detail).toContain('12');
  expect(processDetail({ text: 'x'.repeat(13_000) })).toContain('已截断');
});
