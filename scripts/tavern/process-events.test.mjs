import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installProcessEvents } from '../../src/tavern/process-events.js';

function fixture() {
    const listeners = new Map(), calls = [];
    const st = { chat: [], event_types: new Proxy({}, { get: (_, name) => name }),
        eventSource: { on(name, listener) { listeners.set(name, listener); } } };
    const host = { processEvent(kind, data) { calls.push({ kind, ...data }); return kind === 'start' ? `turn-${calls.length}` : undefined; } };
    globalThis.window = { __STE_STAMP_CHAT__: () => {} };
    const events = installProcessEvents(host, st);
    const emit = (name, ...args) => listeners.get(name)?.(...args);
    const message = id => ({ mes: id, extra: { ste_runtime: { messageId: id, candidateId: id + '-candidate' } } });
    return { st, calls, events, emit, message };
}

test('streaming end before receipt still binds the original turn after another generation starts', () => {
    const f = fixture();
    f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const first = f.events.current();
    f.st.chat.push(f.message('first'));
    f.emit('GENERATION_ENDED');
    f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const second = f.events.current();
    f.emit('MESSAGE_RECEIVED', 0, 'normal');
    assert.deepEqual(f.calls.find(c => c.kind === 'bind'), { kind: 'bind', id: first, messageId: 'first', candidateId: 'first-candidate', floor: 0 });
    assert.equal(f.events.current(), second);
});

test('nonstream receipt before end, quiet calls and chat switches keep their own associations', () => {
    const f = fixture();
    f.emit('GENERATION_AFTER_COMMANDS', 'continue', {}, false);
    const id = f.events.current(); f.st.chat.push(f.message('first'));
    f.emit('GENERATION_AFTER_COMMANDS', 'quiet', {}, false);
    f.events.response('quiet-id', 'quiet');
    f.emit('MESSAGE_RECEIVED', 0, 'continue'); f.emit('GENERATION_ENDED');
    assert.equal(f.calls.find(c => c.kind === 'bind').id, id);
    f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, true);
    f.emit('CHAT_CHANGED'); f.emit('MESSAGE_RECEIVED', 0, 'normal');
    assert.equal(f.calls.filter(c => c.kind === 'bind').length, 1);
});
