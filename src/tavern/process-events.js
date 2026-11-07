/** Observe public ST lifecycle events without changing their order or message contents. */
export function installProcessEvents(host, st) {
    let active;
    let awaitingReceipt = new WeakMap();
    const emit = (kind, data = {}) => host.processEvent(kind, { id: active?.id, ...data });
    const on = (name, listener) => {
        if (st.event_types[name]) st.eventSource.on(st.event_types[name], (...args) => {
            try { listener(...args); } catch { /* Diagnostics cannot block ST's lifecycle. */ }
        });
    };
    on('GENERATION_AFTER_COMMANDS', (type, _options, dryRun) => {
        if (!dryRun && !['quiet', 'impersonate'].includes(type)) active = { id: host.processEvent('start', { type }), type };
    });
    on('WORLD_INFO_ACTIVATED', entries => {
        if (active) emit('world', { detail: entries.map(entry => ({ world: entry.world, uid: entry.uid, name: entry.comment, constant: entry.constant })) });
    });
    on('MESSAGE_RECEIVED', (index, type) => {
        const message = st.chat[index];
        const turn = awaitingReceipt.get(message) ?? active;
        if (!turn || type === 'first_message' || turn.type !== type || !message || message.is_user) return;
        awaitingReceipt.delete(message);
        turn.received = true;
        window.__STE_STAMP_CHAT__(st.chat);
        const identity = message.extra?.ste_runtime;
        if (!identity) return;
        emit('bind', { id: turn.id, messageId: identity.messageId, candidateId: identity.candidateId, floor: index });
        emit('processed', { id: turn.id, detail: { content: message.mes, variables: message.variables?.[message.swipe_id ?? 0] } });
    });
    on('GENERATION_STOPPED', () => { if (active) emit('stop'); });
    on('GENERATION_ENDED', () => {
        if (!active) return;
        // Streaming unlocks its UI before MESSAGE_RECEIVED. Keep the association
        // on that message, so a subsequent generation cannot steal its receipt.
        const message = st.chat.at(-1);
        if (!active.received && message && !message.is_user) awaitingReceipt.set(message, active);
        emit('end'); active = undefined;
    });
    on('CHAT_CHANGED', () => { active = undefined; awaitingReceipt = new WeakMap(); });
    return {
        current: () => active?.id,
        response(id, type) { if (id && !['quiet', 'impersonate'].includes(type)) active = { ...active, id, type }; },
    };
}
