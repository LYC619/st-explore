export interface ChatCompletionMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface SamplingParams {
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    max_tokens?: number;
}
export type CompletionWarning = 'truncated';
export const COMPLETION_WARNING = '回复因长度限制被截断，已保留收到的内容；保存前请检查。';
export interface CallOptions {
    onChunk?: (text: string) => void;
    onWarning?: (warning: CompletionWarning) => void;
    signal?: AbortSignal;
    params?: SamplingParams;
    purpose?: 'probe';
    maxRetries?: number;
    firstByteMs?: number;
    idleMs?: number;
    totalMs?: number;
}
export interface CompletionResult {
    text: string;
    truncated: boolean;
    attempts: number;
    status: number;
    malformedLines: number;
}
export type FetchTransport = (url: string, init: RequestInit) => Promise<Response>;
