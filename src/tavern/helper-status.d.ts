export function helperScriptStatus(script: { id: string; enabled: boolean }, records: { scriptId?: string | null; ready?: boolean; error?: string }[]): {
  state: 'disabled' | 'starting' | 'running' | 'error'; label: string; error?: string;
};
