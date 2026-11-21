/** Configuration is not proof that the sandbox started successfully. */
export function helperScriptStatus(script: { id: string; enabled: boolean }, records: { scriptId?: string | null; ready?: boolean; error?: string }[]): {
    state: 'disabled' | 'starting' | 'running' | 'error'; label: string; error?: string;
} {
    if (!script.enabled) return { state: 'disabled', label: '未启用' };
    const record = records.find(record => record.scriptId === script.id);
    if (record?.error) return { state: 'error', label: '运行错误', error: record.error };
    return record?.ready ? { state: 'running', label: '运行中' } : { state: 'starting', label: '启动中' };
}
