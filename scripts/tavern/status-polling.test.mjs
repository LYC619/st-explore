import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStatusPolling } from '../../src/tavern/status-polling.js';

function fixture(poll) {
    const timers = new Map(), listeners = new Set(), visibility = new Map(), events = new Map();
    let foreground = true, generating = false, id = 0;
    const page = { document: { visibilityState: 'visible', addEventListener: (k, f) => visibility.set(k, f), removeEventListener: k => visibility.delete(k) },
        setTimeout: f => { timers.set(++id, f); return id; }, clearTimeout: id => timers.delete(id),
        addEventListener: (k, f) => events.set(k, f), removeEventListener: k => events.delete(k) };
    const host = { isForeground: () => foreground, isGenerating: () => generating,
        subscribeActivity: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
    const close = installStatusPolling(host, poll, page);
    return { page, timers, close, events, listeners,
        change(f, g) { foreground = f; generating = g; for (const listener of listeners) listener(); },
        visibility(hidden) { page.document.visibilityState = hidden ? 'hidden' : 'visible'; visibility.get('visibilitychange')?.(); },
        tick() { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); },
    };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('parking pauses idle polls; foreground and background generation resume immediately', async () => {
    let calls = 0; const f = fixture(async () => { calls++; }); await flush();
    assert.equal(calls, 1); f.change(false, false); assert.equal(f.timers.size, 0);
    for (let n = 0; n < 20; n++) f.tick(); await flush(); assert.equal(calls, 1);
    f.change(false, true); await flush(); assert.equal(calls, 2); assert.equal(f.timers.size, 1);
    f.tick(); await flush(); assert.equal(calls, 3);
    f.change(false, false); assert.equal(f.timers.size, 0);
    f.change(true, false); await flush(); assert.equal(calls, 4);
    f.visibility(true); assert.equal(f.timers.size, 0); f.visibility(false); await flush(); assert.equal(calls, 5);
    f.events.get('pagehide')(); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('slow/failed status calls never overlap and cannot restart after disposal', async () => {
    let release, calls = 0;
    const f = fixture(() => { calls++; return new Promise(resolve => { release = resolve; }); });
    f.change(false, false); f.change(true, false); f.change(false, true); f.tick();
    assert.equal(calls, 1); release(); await flush(); assert.equal(calls, 2);
    f.close(); release(); await flush(); assert.equal(f.timers.size, 0); assert.equal(calls, 2);
    const failing = fixture(async () => { throw new Error('synthetic status failure'); });
    await flush(); assert.equal(failing.timers.size, 1); failing.close();
});
