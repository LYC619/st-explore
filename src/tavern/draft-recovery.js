/** Sparse recovery drafts use the parent's story queue; the original ST chat stays the editing surface. */
export function installDraftRecovery(st, host) {
    let chatKey, pending = false, loading = false, timer, tail = Promise.resolve();
    const banner = document.createElement('div'); banner.id = 'ste_draft_recovery'; banner.hidden = true;
    const style = document.createElement('style'); style.textContent = '#ste_draft_recovery[hidden]{display:none!important}'; document.head.append(style);
    banner.className = 'flex-container alignItemsCenter';
    const label = document.createElement('span');
    const restore = document.createElement('button'); restore.className = 'menu_button'; restore.textContent = '恢复草稿';
    const inspect = document.createElement('button'); inspect.className = 'menu_button'; inspect.textContent = '查看文字';
    const discard = document.createElement('button'); discard.className = 'menu_button'; discard.textContent = '丢弃草稿';
    banner.append(label, restore, inspect, discard); document.querySelector('#form_sheld')?.prepend(banner);
    let snapshot;
    async function request(path, data = {}) {
        const response = await host.request(path, { chatKey, ...data });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error?.message ?? '草稿保存失败');
        return value;
    }
    async function capture() {
        if (!chatKey || pending || loading) return;
        window.__STE_STAMP_CHAT__(st.chat);
        const editor = document.querySelector('#chat .edit_textarea');
        const data = { chatKey, chat: [{ chat_metadata: structuredClone(st.chat_metadata) }, ...structuredClone(st.chat)],
            input: document.querySelector('#send_textarea')?.value ?? '',
            editor: editor ? { index: Number(editor.closest('.mes').getAttribute('mesid')), text: editor.value } : undefined };
        const operation = host.request('/ste/draft/capture', data).then(async response => {
            if (!response.ok) throw new Error((await response.json()).error?.message ?? '草稿保存失败');
        });
        tail = Promise.all([tail, operation.catch(() => {})]).then(() => {});
        return operation;
    }
    async function select(key) {
        if (chatKey === key) return;
        await tail;
        chatKey = key; loading = true; banner.hidden = true; snapshot = undefined;
        try {
            snapshot = await request('/ste/draft');
            pending = !!snapshot && (snapshot.changed || snapshot.conflict);
            if (pending) {
                label.textContent = snapshot.conflict ? '发现草稿，但原故事已变化。可查看并复制需要的文字。' : '发现上次未保存的编辑或中断回复。';
                restore.disabled = snapshot.conflict; banner.hidden = false;
            } else {
                const input = document.querySelector('#send_textarea');
                const recovery = st.chat_metadata?.ste_recovery;
                const exportedInput = recovery?.version === 1 && typeof recovery.input === 'string' ? recovery.input : '';
                if (input) {
                    input.value = snapshot?.draft.input ?? exportedInput;
                    // The next ordinary chat save consumes the import marker. Later empty drafts
                    // must not resurrect input that the player has already sent or cleared.
                    if (recovery?.version === 1) delete st.chat_metadata.ste_recovery;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        } catch (error) {
            pending = true; label.textContent = error.message; restore.disabled = true; banner.hidden = false;
        } finally { loading = false; }
    }
    restore.addEventListener('click', async () => {
        try {
            const result = await request('/ste/draft/restore');
            if (!result) return;
            st.chat.splice(0, st.chat.length, ...result.chat.slice(1));
            await st.printMessages();
            await st.saveChatConditional();
            const input = document.querySelector('#send_textarea'); input.value = result.input;
            pending = false; banner.hidden = true; await capture();
        } catch (error) { label.textContent = error.message; }
    });
    inspect.addEventListener('click', async () => {
        const { Popup, POPUP_TYPE } = await import('/scripts/popup.js');
        const text = document.createElement('textarea'); text.className = 'text_pole'; text.rows = 16; text.readOnly = true;
        text.value = snapshot ? [...snapshot.draft.changes.map(message => `${message.role}: ${message.content}`), snapshot.draft.input].filter(Boolean).join('\n\n') : label.textContent;
        await new Popup(text, POPUP_TYPE.TEXT, '', { wide: true }).show();
    });
    discard.addEventListener('click', async () => {
        try { await request('/ste/draft/discard'); pending = false; banner.hidden = true; }
        catch (error) { label.textContent = error.message; }
    });
    document.addEventListener('input', event => {
        if (!event.target.matches('#send_textarea, #chat .edit_textarea')) return;
        clearTimeout(timer); timer = setTimeout(() => { void capture().catch(error => toastr.error(error.message, '草稿未保存')); }, 400);
    });
    const interval = setInterval(() => { if (host.isGenerating()) void capture().catch(() => {}); }, 1000);
    window.addEventListener('pagehide', () => { clearInterval(interval); clearTimeout(timer); }, { once: true });
    window.__STE_DRAFT_CAPTURE__ = capture;
    window.__STE_DRAFT_READY__ = () => !pending && !loading;
    return { select };
}
