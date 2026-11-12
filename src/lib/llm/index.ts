import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { createLLMClient } from './client';
import type { CallOptions, ChatCompletionMessage, CompletionWarning } from './types';
export { createLLMClient, isLLMConfigured } from './client';
export { LLMError, LLM_MESSAGES, isLLMCancelled } from './errors';
export { COMPLETION_WARNING } from './types';
export type { CallOptions, ChatCompletionMessage, SamplingParams, CompletionWarning, CompletionResult, FetchTransport } from './types';
const client = createLLMClient();
export async function callOpenAIMessages(config: APIConfig, messages: ChatCompletionMessage[], options: CallOptions = {}): Promise<string> {
    const result = await client.complete(config, messages, options);
    if (result.truncated)
        options.onWarning?.('truncated');
    return result.text;
}
export function callOpenAI(config: APIConfig, prompt: string, systemPrompt: string, onChunk?: (text: string) => void, signal?: AbortSignal, onWarning?: (warning: CompletionWarning) => void): Promise<string> {
    return callOpenAIMessages(config, [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], { onChunk, signal, onWarning });
}
export function fetchModels(url: string, key: string, signal?: AbortSignal): Promise<string[]> { return client.models(url, key, signal); }
