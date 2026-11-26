import { loadUpstream, errorMessage } from './upstream.js';
import type { DraftState, Host } from './bridge-types.js';
import type { DraftResponseSnapshot, DraftRestoreResponse } from './protocol.js';

type DraftHost = Pick<Host, 'request' | 'isGenerating'>;

/** Sparse recovery drafts use the parent's story queue; the original ST chat stays the editing surface. */
export function installDraftRecovery(st: DraftState, host: DraftHost): { select(key: string): Promise<void> } {
    let chatKey: string | undefined, pending = false, loading = false, typedDuringLoad = false, timer: ReturnType<typeof setTimeout> | undefined, tail: Promise<void> = Promise.resolve();
    const banner = document.createElement('div'); banner.id = 'ste_draft_recovery'; banner.hidden = true;
    const style = document.createElement('style'); style.textContent = '#ste_draft_recovery[hidden]{display:none!important}'; document.head.append(style);
    banner.className = 'flex-container alignItemsCenter';
    const label = document.createElement('span');
    const restore = document.createElement('button'); restore.className = 'menu_button'; restore.textContent = '恢复草稿';
    const inspect = document.createElement('button'); inspect.className = 'menu_button'; inspect.textContent = '查看文字';
    const discard = document.createElement('button'); discard.className = 'menu_button'; discard.textContent = '丢弃草稿';
    banner.append(label, restore, inspect, discard); document.querySelector<HTMLElement>('#form_sheld')?.prepend(banner);
    let snapshot: DraftResponseSnapshot | null | undefined;
    async function request<T>(path: string, data: Record<string, unknown> = {}): Promise<T> {
        const response = await host.request(path, { chatKey, ...data });
        const value = await response.json() as T & { error?: { message?: string } };
        if (!response.ok) throw new Error(value?.error?.message ?? '草稿保存失败');
        return value;
    }
    async function capture(): Promise<void> {
        if (!chatKey || pending || loading) return;
        window.__STE_STAMP_CHAT__(st.chat);
        const editor = document.querySelector<HTMLTextAreaElement>('#chat .edit_textarea');
        const mesId = editor?.closest('.mes')?.getAttribute('mesid');
        const data = { chatKey, chat: [{ chat_metadata: structuredClone(st.chat_metadata) }, ...structuredClone(st.chat)],
            input: document.querySelector<HTMLTextAreaElement>('#send_textarea')?.value ?? '',
            editor: editor ? { index: Number(mesId), text: editor.value } : undefined };
        const operation = host.request('/ste/draft/capture', data).then(async (response: Response) => {
            if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? '草稿保存失败');
        });
        tail = Promise.all([tail, operation.catch(() => {})]).then(() => {});
        return operation;
    }
    async function select(key: string): Promise<void> {
        if (chatKey === key) return;
        await tail;
        chatKey = key; loading = true; typedDuringLoad = false; banner.hidden = true; snapshot = undefined;
        const initialInput = document.querySelector<HTMLTextAreaElement>('#send_textarea');
        if (initialInput) initialInput.value = '';
        try {
            snapshot = await request<DraftResponseSnapshot | null>('/ste/draft');
            pending = !!snapshot && (snapshot.changed || snapshot.conflict);
            if (pending && snapshot) {
                label.textContent = snapshot.conflict ? '发现草稿，但原故事已变化。可查看并复制需要的文字。' : '发现上次未保存的编辑或中断回复。';
                restore.disabled = snapshot.conflict; banner.hidden = false;
            } else {
                const input = document.querySelector<HTMLTextAreaElement>('#send_textarea');
                const recovery = st.chat_metadata?.ste_recovery as { version?: number; input?: unknown } | undefined;
                const exportedInput = recovery?.version === 1 && typeof recovery.input === 'string' ? recovery.input : '';
                const recoveredInput = snapshot?.draft.input ?? exportedInput;
                if (input && (recoveredInput || !typedDuringLoad)) {
                    input.value = recoveredInput;
                    // The next ordinary chat save consumes the import marker. Later empty drafts
                    // must not resurrect input that the player has already sent or cleared.
                    if (recovery?.version === 1) delete st.chat_metadata.ste_recovery;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                } else if (recovery?.version === 1) {
                    delete st.chat_metadata.ste_recovery;
                }
            }
        } catch (error) {
            pending = true; label.textContent = errorMessage(error); restore.disabled = true; banner.hidden = false;
        } finally { loading = false; }
    }
    restore.addEventListener('click', async () => {
        try {
            const result = await request<DraftRestoreResponse | null>('/ste/draft/restore');
            if (!result) return;
            st.chat.splice(0, st.chat.length, ...result.chat.slice(1));
            await st.printMessages();
            await st.saveChatConditional();
            const input = document.querySelector<HTMLTextAreaElement>('#send_textarea');
            if (input) input.value = result.input;
            pending = false; banner.hidden = true; await capture();
        } catch (error) { label.textContent = errorMessage(error); }
    });
    inspect.addEventListener('click', async () => {
        const { Popup, POPUP_TYPE } = await loadUpstream('/scripts/popup.js');
        const text = document.createElement('textarea'); text.className = 'text_pole'; text.rows = 16; text.readOnly = true;
        text.value = snapshot ? [...snapshot.draft.changes.map(message => `${message.role}: ${message.content}`), snapshot.draft.input].filter(Boolean).join('\n\n') : (label.textContent ?? '');
        await new Popup(text, POPUP_TYPE.TEXT, '', { wide: true }).show();
    });
    discard.addEventListener('click', async () => {
        try { await request('/ste/draft/discard'); pending = false; banner.hidden = true; }
        catch (error) { label.textContent = errorMessage(error); }
    });
    document.addEventListener('input', event => {
        if (!(event.target instanceof Element) || !event.target.matches('#send_textarea, #chat .edit_textarea')) return;
        if (loading && event.target.matches('#send_textarea')) typedDuringLoad = true;
        clearTimeout(timer); timer = setTimeout(() => { void capture().catch(error => toastr.error(errorMessage(error), '草稿未保存')); }, 400);
    });
    const interval = setInterval(() => { if (host.isGenerating()) void capture().catch(() => {}); }, 1000);
    window.addEventListener('pagehide', () => { clearInterval(interval); clearTimeout(timer); }, { once: true });
    window.__STE_DRAFT_CAPTURE__ = capture;
    window.__STE_DRAFT_READY__ = () => !pending && !loading;
    return { select };
}
