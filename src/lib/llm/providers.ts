import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { embeddedCategory, type LLMErrorCategory } from './errors';
import type { ChatCompletionMessage, ProviderProtocol, SamplingParams, StructuredOutputSchema } from './types';

export interface ProviderRequestInput {
    config: APIConfig;
    messages: ChatCompletionMessage[];
    params?: SamplingParams;
    stream: boolean;
    responseSchema?: StructuredOutputSchema;
}

export interface ProviderHttpRequest {
    url: string;
    method: 'POST';
    headers: Record<string, string>;
    body: Record<string, unknown>;
}

export interface ParsedCompletionJson {
    text: string;
    truncated: boolean;
    blocked?: boolean;
    error?: LLMErrorCategory;
}

export interface ParsedStreamChunk {
    delta?: string;
    done?: boolean;
    truncated?: boolean;
    blocked?: boolean;
    finished?: boolean;
    error?: LLMErrorCategory;
    malformed?: boolean;
    ignored?: boolean;
}

export interface ProviderModelsRequest {
    url: string;
    headers: Record<string, string>;
}

export interface ProviderAdapter {
    readonly protocol: ProviderProtocol;
    buildRequest(input: ProviderRequestInput): ProviderHttpRequest;
    parseJsonResponse(data: unknown): ParsedCompletionJson;
    parseStreamEvent(event: { event?: string; data: string }): ParsedStreamChunk;
    buildModelsRequest(baseUrl: string, apiKey: string): ProviderModelsRequest;
    parseModelsResponse(data: unknown): string[] | null;
}

const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_BLOCKED_FINISH_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function detectProviderProtocol(config: Pick<APIConfig, 'apiUrl' | 'protocol'>): ProviderProtocol {
    if (config.protocol === 'openai' || config.protocol === 'anthropic' || config.protocol === 'gemini') {
        return config.protocol;
    }
    try {
        const parsed = new URL(config.apiUrl);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.toLowerCase();
        if (host === 'api.anthropic.com' || /\/v\d+\/messages\/?$/.test(path)) {
            return 'anthropic';
        }
        if (
            host === 'generativelanguage.googleapis.com'
            || /:(?:stream)?generatecontent\/?$/.test(path)
            || /\/v1(?:beta|alpha)?\/models(?:\/|$)/.test(path) && host.includes('googleapis.com')
        ) {
            return 'gemini';
        }
    } catch {
        // Invalid URLs fall back to default OpenAI adapter; caller validates URL separately.
    }
    return 'openai';
}

function buildGeminiEndpoint(apiUrl: string, model: string, stream: boolean): string {
    const parsed = new URL(apiUrl);
    const trimmedModel = model.trim().replace(/^models\//, '');
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    if (/:(?:stream)?generateContent\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/:(?:stream)?generateContent\/?$/i, `:${action}`);
    } else if (/\/models\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + `/${encodeURIComponent(trimmedModel)}:${action}`;
    } else if (/\/v1(?:beta|alpha)?\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + `/models/${encodeURIComponent(trimmedModel)}:${action}`;
    } else if (/\/models\/[^/:]+\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + `:${action}`;
    }
    // Never propagate API keys via URL query strings.
    parsed.searchParams.delete('key');
    if (stream) {
        parsed.searchParams.set('alt', 'sse');
    } else {
        parsed.searchParams.delete('alt');
    }
    return parsed.toString();
}

function buildGeminiModelsUrl(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    parsed.searchParams.delete('key');
    parsed.searchParams.delete('alt');
    if (/\/models\/.+$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/models\/.+$/i, '/models');
    } else if (/\/v1(?:beta|alpha)?\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/models';
    } else if (!/\/models\/?$/i.test(parsed.pathname)) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/v1beta/models';
    }
    return parsed.toString();
}

function splitSystemMessages(messages: ChatCompletionMessage[]): {
    systemText: string;
    conversation: { role: 'user' | 'assistant'; content: string }[];
} {
    const systemParts: string[] = [];
    const conversation: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const message of messages) {
        if (message.role === 'system') {
            if (message.content) systemParts.push(message.content);
        } else {
            conversation.push({ role: message.role, content: message.content });
        }
    }
    return { systemText: systemParts.join('\n\n'), conversation };
}

export const openaiAdapter: ProviderAdapter = {
    protocol: 'openai',
    buildRequest({ config, messages, params, stream, responseSchema }) {
        const body: Record<string, unknown> = {
            model: config.model,
            messages,
            temperature: params?.temperature ?? 0.7,
        };
        for (const key of ['top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens'] as const) {
            if (params?.[key] !== undefined) body[key] = params[key];
        }
        if (stream) body.stream = true;
        if (responseSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: responseSchema.name,
                    strict: responseSchema.strict ?? true,
                    schema: responseSchema.schema,
                },
            };
        }
        return {
            url: config.apiUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body,
        };
    },
    parseJsonResponse(raw) {
        const data = asObject(raw);
        if (!data) return { text: '', truncated: false, error: 'parse' };
        if (data.error) return { text: '', truncated: false, error: embeddedCategory(data.error) };
        const choice = (data.choices as Array<{
            message?: { content?: unknown; refusal?: unknown };
            finish_reason?: unknown;
            error?: unknown;
        }> | undefined)?.[0];
        if (choice?.error) return { text: '', truncated: false, error: embeddedCategory(choice.error) };
        if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
            return { text: '', truncated: false, blocked: true };
        }
        const content = choice?.message?.content;
        if (content != null && typeof content !== 'string') {
            return { text: '', truncated: false, error: 'parse' };
        }
        return {
            text: typeof content === 'string' ? content : '',
            truncated: choice?.finish_reason === 'length',
        };
    },
    parseStreamEvent({ data: payload }) {
        if (payload === '[DONE]') return { done: true };
        let parsed: unknown;
        try { parsed = JSON.parse(payload); } catch { return { malformed: true }; }
        const data = asObject(parsed);
        if (!data) return { malformed: true };
        if (data.error) return { error: embeddedCategory(data.error) };
        const choice = (data.choices as Array<{
            delta?: { content?: unknown; refusal?: unknown };
            finish_reason?: unknown;
            error?: unknown;
        }> | undefined)?.[0];
        if (choice?.error) return { error: embeddedCategory(choice.error) };
        if (choice?.finish_reason === 'content_filter' || choice?.delta?.refusal) {
            return { blocked: true };
        }
        const content = choice?.delta?.content;
        if (content != null && typeof content !== 'string') return { error: 'parse' };
        const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
        return {
            delta: typeof content === 'string' && content ? content : undefined,
            finished: finishReason !== undefined,
            truncated: finishReason === 'length',
        };
    },
    buildModelsRequest(baseUrl, apiKey) {
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        return {
            url: baseUrl.replace(/\/v1\/chat\/completions\/?$/, '/v1/models'),
            headers,
        };
    },
    parseModelsResponse(raw) {
        const data = asObject(raw);
        if (!data || !Array.isArray(data.data)) return null;
        return [...new Set<string>(data.data.flatMap((item: { id?: unknown }) =>
            typeof item?.id === 'string' && item.id.trim() ? [item.id] : []))].sort();
    },
};

export const anthropicAdapter: ProviderAdapter = {
    protocol: 'anthropic',
    buildRequest({ config, messages, params, stream, responseSchema }) {
        const { systemText, conversation } = splitSystemMessages(messages);
        const body: Record<string, unknown> = {
            model: config.model,
            max_tokens: params?.max_tokens ?? 4096,
            messages: conversation.length ? conversation : [{ role: 'user', content: systemText || '' }],
        };
        if (systemText && conversation.length) body.system = systemText;
        if (params?.temperature !== undefined) body.temperature = params.temperature;
        if (params?.top_p !== undefined) body.top_p = params.top_p;
        if (stream) body.stream = true;
        if (responseSchema) {
            body.output_config = {
                format: {
                    type: 'json_schema',
                    schema: responseSchema.schema,
                },
            };
        }
        return {
            url: config.apiUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': ANTHROPIC_VERSION,
                ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
            },
            body,
        };
    },
    parseJsonResponse(raw) {
        const data = asObject(raw);
        if (!data) return { text: '', truncated: false, error: 'parse' };
        if (data.type === 'error' || data.error) {
            return { text: '', truncated: false, error: embeddedCategory(data.error ?? data) };
        }
        if (data.stop_reason === 'refusal') return { text: '', truncated: false, blocked: true };
        if (!Array.isArray(data.content)) return { text: '', truncated: false, error: 'parse' };
        let text = '';
        for (const item of data.content) {
            const block = asObject(item);
            if (!block) return { text: '', truncated: false, error: 'parse' };
            if (block.type === 'text') {
                if (typeof block.text !== 'string') return { text: '', truncated: false, error: 'parse' };
                text += block.text;
            } else if (block.type === 'tool_use' && block.input !== undefined) {
                text += JSON.stringify(block.input);
            }
        }
        return { text, truncated: data.stop_reason === 'max_tokens' };
    },
    parseStreamEvent({ event, data: payload }) {
        let parsed: unknown;
        try { parsed = JSON.parse(payload); } catch { return { malformed: true }; }
        const data = asObject(parsed);
        if (!data) return { malformed: true };
        const type = typeof data.type === 'string' ? data.type : event;
        if (type === 'error' || data.error) {
            return { error: embeddedCategory(data.error ?? data) };
        }
        if (type === 'message_stop') return { done: true, finished: true };
        if (type === 'content_block_delta') {
            const delta = asObject(data.delta);
            if (!delta) return { error: 'parse' };
            if (delta.type === 'text_delta') {
                if (typeof delta.text !== 'string') return { error: 'parse' };
                return { delta: delta.text || undefined };
            }
            if (delta.type === 'input_json_delta') {
                if (typeof delta.partial_json !== 'string') return { error: 'parse' };
                return { delta: delta.partial_json || undefined };
            }
            return { ignored: true };
        }
        if (type === 'message_delta') {
            const delta = asObject(data.delta);
            const stopReason = typeof delta?.stop_reason === 'string' ? delta.stop_reason : undefined;
            if (stopReason === 'refusal') return { blocked: true };
            if (stopReason) return { finished: true, truncated: stopReason === 'max_tokens' };
            return { ignored: true };
        }
        if (type === 'message_start' || type === 'content_block_start' || type === 'content_block_stop' || type === 'ping') {
            return { ignored: true };
        }
        return { ignored: true };
    },
    buildModelsRequest(baseUrl, apiKey) {
        return {
            url: baseUrl.replace(/\/v1\/messages\/?$/, '/v1/models'),
            headers: {
                'anthropic-version': ANTHROPIC_VERSION,
                ...(apiKey ? { 'x-api-key': apiKey } : {}),
            },
        };
    },
    parseModelsResponse(raw) {
        const data = asObject(raw);
        if (!data || !Array.isArray(data.data)) return null;
        return [...new Set<string>(data.data.flatMap((item: { id?: unknown }) =>
            typeof item?.id === 'string' && item.id.trim() ? [item.id] : []))].sort();
    },
};

export const geminiAdapter: ProviderAdapter = {
    protocol: 'gemini',
    buildRequest({ config, messages, params, stream, responseSchema }) {
        const { systemText, conversation } = splitSystemMessages(messages);
        const contents = (conversation.length ? conversation : [{ role: 'user' as const, content: systemText || '' }]).map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }],
        }));
        const generationConfig: Record<string, unknown> = {};
        if (params?.temperature !== undefined) generationConfig.temperature = params.temperature;
        if (params?.top_p !== undefined) generationConfig.topP = params.top_p;
        if (params?.max_tokens !== undefined) generationConfig.maxOutputTokens = params.max_tokens;
        if (responseSchema) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = responseSchema.schema;
        }
        const body: Record<string, unknown> = { contents };
        if (systemText && conversation.length) {
            body.systemInstruction = { parts: [{ text: systemText }] };
        }
        if (Object.keys(generationConfig).length) {
            body.generationConfig = generationConfig;
        }
        return {
            url: buildGeminiEndpoint(config.apiUrl, config.model, stream),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { 'x-goog-api-key': config.apiKey } : {}),
            },
            body,
        };
    },
    parseJsonResponse(raw) {
        const data = asObject(raw);
        if (!data) return { text: '', truncated: false, error: 'parse' };
        if (data.error) return { text: '', truncated: false, error: embeddedCategory(data.error) };
        const feedback = asObject(data.promptFeedback);
        if (typeof feedback?.blockReason === 'string' && feedback.blockReason) {
            return { text: '', truncated: false, blocked: true };
        }
        const candidate = Array.isArray(data.candidates) ? asObject(data.candidates[0]) : null;
        const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined;
        if (finishReason && GEMINI_BLOCKED_FINISH_REASONS.has(finishReason)) {
            return { text: '', truncated: false, blocked: true };
        }
        const content = asObject(candidate?.content);
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        let text = '';
        for (const item of parts) {
            const part = asObject(item);
            if (!part) return { text: '', truncated: false, error: 'parse' };
            if (part.text !== undefined) {
                if (typeof part.text !== 'string') return { text: '', truncated: false, error: 'parse' };
                text += part.text;
            }
        }
        return { text, truncated: finishReason === 'MAX_TOKENS' };
    },
    parseStreamEvent({ data: payload }) {
        if (payload === '[DONE]') return { done: true };
        let parsed: unknown;
        try { parsed = JSON.parse(payload); } catch { return { malformed: true }; }
        const data = asObject(parsed);
        if (!data) return { malformed: true };
        if (data.error) return { error: embeddedCategory(data.error) };
        const feedback = asObject(data.promptFeedback);
        if (typeof feedback?.blockReason === 'string' && feedback.blockReason) {
            return { blocked: true };
        }
        const candidate = Array.isArray(data.candidates) ? asObject(data.candidates[0]) : null;
        const finishReason = typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined;
        if (finishReason && GEMINI_BLOCKED_FINISH_REASONS.has(finishReason)) {
            return { blocked: true };
        }
        const content = asObject(candidate?.content);
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        let delta = '';
        for (const item of parts) {
            const part = asObject(item);
            if (!part) return { error: 'parse' };
            if (part.text !== undefined) {
                if (typeof part.text !== 'string') return { error: 'parse' };
                delta += part.text;
            }
        }
        return {
            delta: delta || undefined,
            finished: finishReason !== undefined && finishReason !== 'FINISH_REASON_UNSPECIFIED',
            truncated: finishReason === 'MAX_TOKENS',
        };
    },
    buildModelsRequest(baseUrl, apiKey) {
        const headers: Record<string, string> = {};
        if (apiKey) headers['x-goog-api-key'] = apiKey;
        return {
            url: buildGeminiModelsUrl(baseUrl),
            headers,
        };
    },
    parseModelsResponse(raw) {
        const data = asObject(raw);
        if (!data || !Array.isArray(data.models)) return null;
        return [...new Set<string>(data.models.flatMap((item: { name?: unknown }) =>
            typeof item?.name === 'string' && item.name.trim() ? [item.name.trim().replace(/^models\//, '')] : []))].sort();
    },
};

export function resolveProviderAdapter(config: Pick<APIConfig, 'apiUrl' | 'protocol'>): ProviderAdapter {
    const protocol = detectProviderProtocol(config);
    if (protocol === 'anthropic') return anthropicAdapter;
    if (protocol === 'gemini') return geminiAdapter;
    return openaiAdapter;
}
