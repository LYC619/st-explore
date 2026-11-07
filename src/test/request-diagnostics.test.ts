import { expect, it } from 'vitest';
import { captureRequest, compareRequests, importRequest, responseObservation } from '@/lib/roleplay/request-diagnostics';
import { createProcessLog } from '@/lib/roleplay/process-log';
const body = { model: 'm', messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello' }], temperature: 0, tools: [{ type: 'function', function: { name: 'update', parameters: { type: 'object' } } }] };
it('captures actual bodies without mutating input and compares message order, multimodal fields and every parameter', () => {
  const a = captureRequest(body), b = captureRequest({ ...body, temperature: 1, messages: [...body.messages].reverse() });
  expect(compareRequests(a, captureRequest({ ...body, messages: structuredClone(body.messages) })).equal).toBe(true);
  const diff = compareRequests(a, b); expect(diff.equal).toBe(false); expect(diff.messages.filter(m => m.changed)).toHaveLength(2);
  expect(diff.parameters.changes).toEqual([{ path: '/temperature', kind: 'changed', before: 0, after: 1 }]);
  a.body.messages = []; expect(body.messages).toHaveLength(2);
});
it('redacts credentials before storing, retaining token limits and tools', () => {
  const snapshot = captureRequest({ ...body, max_tokens: 123, secret: 'unknown', messages: [{ role: 'user', content: 'credential Bearer abc123' }] }, ['credential']);
  expect(JSON.stringify(snapshot)).not.toContain('credential'); expect(JSON.stringify(snapshot)).not.toContain('abc123'); expect(JSON.stringify(snapshot)).not.toContain('unknown');
  expect(snapshot.body.max_tokens).toBe(123); expect(snapshot.body.tools).toEqual(body.tools); expect(snapshot.redacted).toBe(true);
});
it('never reports incomplete snapshots as exact matches and survives cyclic/plugin data', () => {
  const a = captureRequest({ messages: [{ role: 'user', content: 'x'.repeat(500) }] }, [], 100);
  expect(a.complete).toBe(false); expect(compareRequests(a, a).equal).toBe(false);
  const cyclic: Record<string, unknown> = { ...body }; cyclic.other = cyclic; expect(captureRequest(cyclic).complete).toBe(false);
  const log = createProcessLog(); const id = log.start({ key: 'k', storyId: 's', branchId: null, avatar: '', fileName: '' }, 'normal');
  expect(() => log.request(id, 'final', { get messages() { throw new Error('plugin'); } })).not.toThrow(); expect(log.get(id)?.requestUnavailable).toBeTruthy();
});
it('imports direct JSON, wrapped request, one HAR entry and incomplete exported snapshots; rejects ambiguous or preset input', () => {
  for (const value of [body, { body }, { request: { postData: { text: JSON.stringify(body) }, headers: { Authorization: 'secret' } } }, { log: { entries: [{ request: { postData: { text: JSON.stringify(body) } } }] } }]) expect(importRequest(JSON.stringify(value)).body).toEqual(body);
  expect(importRequest(JSON.stringify({ ...captureRequest(body), complete: false })).complete).toBe(false);
  expect(() => importRequest(JSON.stringify({ prompts: [] }))).toThrow('实际');
  expect(() => importRequest(JSON.stringify({ log: { entries: [body, body].map(value => ({ request: { postData: { text: JSON.stringify(value) } } })) } }))).toThrow('2');
});
it('observes actual usage separately from content and successful tool-only output', () => {
  expect(responseObservation({ content: '', toolCalls: [{}], finishReason: 'tool_calls', usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 10 }, api_key: 'secret' } })).toEqual({ contentChars: 0, toolCalls: 1, finishReason: 'tool_calls', usage: { prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 10 } } });
});
it('bounds unusually long parameter keys as well as values', () => {
  const snapshot = captureRequest({ messages: [], ['x'.repeat(10000)]: true }, [], 100);
  expect(snapshot.complete).toBe(false);
  expect(JSON.stringify(snapshot.body).length).toBeLessThan(200);
});
