import type { RecoveryState } from './bridge-types';
/** Take an independent copy even when the story or draft backend cannot write. */
export function captureRecoveryFile(st: RecoveryState): { fileName: string; text: string } {
    const chat = structuredClone(st.chat);
    const editor = document.querySelector<HTMLTextAreaElement>('#chat .edit_textarea');
    if (editor) {
        const message = chat[Number(editor.closest('.mes')?.getAttribute('mesid'))];
        if (message) {
            message.mes = editor.value;
            if (message.swipes?.length) message.swipes[message.swipe_id ?? 0] = editor.value;
        }
    }
    const exportedAt = new Date().toISOString();
    const header = { user_name: st.name1, character_name: st.name2,
        chat_metadata: { ...structuredClone(st.chat_metadata), ste_recovery: {
            version: 1, exportedAt, input: document.querySelector<HTMLTextAreaElement>('#send_textarea')?.value ?? '',
        } } };
    // eslint-disable-next-line no-control-regex -- Export filenames must exclude control characters.
    const name = String(st.getCurrentChatId() ?? '聊天').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || '聊天';
    return { fileName: name + '-恢复-' + exportedAt.replace(/[:.]/g, '-') + '.jsonl',
        text: [header, ...chat].map(row => JSON.stringify(row)).join('\n') + '\n' };
}
