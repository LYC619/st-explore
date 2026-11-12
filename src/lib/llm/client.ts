import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { providerFetch } from '@/lib/roleplay/provider';
import { reportDiagnostic } from '@/lib/diagnostics';
import { embeddedCategory, LLMError, statusCategory } from './errors';
import type { CallOptions, ChatCompletionMessage, CompletionResult, FetchTransport } from './types';
const ABORTED = Symbol('llm-aborted');
const DEFAULTS = { firstByteMs: 300000, idleMs: 180000, totalMs: 600000 };
const MAX_RETRY_WAIT = 300000;
export function isLLMConfigured(config: Pick<APIConfig, 'apiUrl' | 'model'>): boolean {
    try {
        return ['http:', 'https:'].includes(new URL(config.apiUrl).protocol) && !!config.model.trim();
    }
    catch {
        return false;
    }
}
function duration(value: number | undefined, fallback: number) { return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback; }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        void promise.catch(() => { });
        return Promise.reject(ABORTED);
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(ABORTED); };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
    });
}
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(ABORTED);
            return;
        }
        const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(ABORTED); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
function retryAfter(value: string | null): number | undefined {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
function bodyFor(config: APIConfig, messages: ChatCompletionMessage[], options: CallOptions): Record<string, unknown> {
    const body: Record<string, unknown> = { model: config.model, messages, temperature: options.params?.temperature ?? 0.7 };
    for (const key of ['top_p', 'frequency_penalty', 'presence_penalty', 'max_tokens'] as const) {
        if (options.params?.[key] !== undefined)
            body[key] = options.params[key];
    }
    if (options.onChunk)
        body.stream = true;
    return body;
}
export function createLLMClient({ transport = providerFetch, random = Math.random, defaults = DEFAULTS }: {
    transport?: FetchTransport;
    random?: () => number;
    defaults?: Partial<typeof DEFAULTS>;
} = {}) {
    async function attempt(url: string, init: RequestInit, options: CallOptions, number: number, model?: string): Promise<CompletionResult> {
        const controller = new AbortController();
        const stop = () => controller.abort();
        options.signal?.addEventListener('abort', stop, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false, text = '', status: number | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, malformedLines = 0;
        const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
        const failure = (category: ConstructorParameters<typeof LLMError>[0], extra: {
            retryAfterMs?: number;
        } = {}) => new LLMError(category, { attempts: number, status, partialText: text, ...extra });
        const stream = !!options.onChunk;
        const probe = options.purpose === 'probe';
        arm(probe ? 30000 : duration(stream ? options.firstByteMs : options.totalMs, stream ? (defaults.firstByteMs ?? DEFAULTS.firstByteMs) : (defaults.totalMs ?? DEFAULTS.totalMs)));
        try {
            if (options.signal?.aborted)
                throw ABORTED;
            const response = await abortable(transport(url, { ...init, signal: controller.signal }), controller.signal);
            status = response.status;
            if (!response.ok)
                throw failure(statusCategory(status), { retryAfterMs: retryAfter(response.headers.get('Retry-After')) });
            if (!stream || response.headers.get('content-type')?.includes('application/json')) {
                let data: Record<string, unknown>;
                try {
                    data = await abortable(response.json(), controller.signal);
                }
                catch (error) {
                    if (controller.signal.aborted)
                        throw error;
                    throw failure('parse');
                }
                if (!data || typeof data !== 'object')
                    throw failure('parse');
                if (data.error)
                    throw failure(embeddedCategory(data.error));
                const choice = (data.choices as Array<{
                    message?: {
                        content?: unknown;
                        refusal?: unknown;
                    };
                    finish_reason?: unknown;
                    error?: unknown;
                }> | undefined)?.[0];
                if (choice?.error)
                    throw failure(embeddedCategory(choice.error));
                if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal)
                    throw failure('blocked');
                const content = choice?.message?.content;
                if (content != null && typeof content !== 'string')
                    throw failure('parse');
                text = typeof content === 'string' ? content : '';
                if (!text.trim())
                    throw failure('empty');
                if (controller.signal.aborted)
                    throw ABORTED;
                options.onChunk?.(text);
                return { text, truncated: choice?.finish_reason === 'length', attempts: number, status, malformedLines: 0 };
            }
            if (!response.body)
                throw failure('empty');
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '', doneMarker = false, finish: string | undefined, parsedLines = 0, receivedBytes = false;
            const consume = (raw: string) => {
                if (controller.signal.aborted)
                    throw ABORTED;
                const line = raw.trimEnd();
                if (!line.startsWith('data:'))
                    return;
                const payload = line.slice(5).trim();
                if (!payload)
                    return;
                if (payload === '[DONE]') {
                    doneMarker = true;
                    return;
                }
                let data: Record<string, unknown>;
                try {
                    data = JSON.parse(payload);
                }
                catch {
                    malformedLines++;
                    return;
                }
                if (!data || typeof data !== 'object') {
                    malformedLines++;
                    return;
                }
                parsedLines++;
                if (data.error)
                    throw failure(embeddedCategory(data.error));
                const choice = (data.choices as Array<{
                    delta?: {
                        content?: unknown;
                        refusal?: unknown;
                    };
                    finish_reason?: unknown;
                    error?: unknown;
                }> | undefined)?.[0];
                if (choice?.error)
                    throw failure(embeddedCategory(choice.error));
                if (choice?.finish_reason === 'content_filter' || choice?.delta?.refusal)
                    throw failure('blocked');
                if (typeof choice?.finish_reason === 'string')
                    finish = choice.finish_reason;
                const content = choice?.delta?.content;
                if (content != null && typeof content !== 'string')
                    throw failure('parse');
                if (typeof content === 'string' && content) {
                    text += content;
                    options.onChunk?.(content);
                }
            };
            while (!doneMarker) {
                const result = await abortable(reader.read(), controller.signal);
                if (result.done) {
                    buffer += decoder.decode();
                    if (buffer.trim())
                        consume(buffer);
                    break;
                }
                if (result.value.length) {
                    receivedBytes = true;
                    arm(probe ? 30000 : duration(options.idleMs, defaults.idleMs ?? DEFAULTS.idleMs));
                }
                buffer += decoder.decode(result.value, { stream: true });
                let newline: number;
                while (!doneMarker && (newline = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    consume(line);
                }
            }
            if (!parsedLines)
                throw failure(receivedBytes ? 'parse' : 'empty');
            if (!text.trim())
                throw failure('empty');
            if (!doneMarker && !finish)
                throw failure('interrupted');
            return { text, truncated: finish === 'length', attempts: number, status, malformedLines };
        }
        catch (error) {
            if (options.signal?.aborted)
                throw failure('cancelled');
            if (error instanceof LLMError)
                throw error;
            throw failure(text ? 'interrupted' : timedOut ? 'timeout' : 'network');
        }
        finally {
            if (malformedLines)
                reportDiagnostic({ event: 'model', operation: 'parse', category: 'parse', count: malformedLines, attempt: number, status, host: new URL(url).hostname, model });
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', stop);
            controller.abort();
            if (reader) {
                void reader.cancel().catch(() => { });
                reader.releaseLock();
            }
        }
    }
    async function complete(config: APIConfig, messages: ChatCompletionMessage[], options: CallOptions = {}): Promise<CompletionResult> {
        if (options.signal?.aborted)
            throw new LLMError('cancelled', { attempts: 0 });
        if (!isLLMConfigured(config))
            throw new LLMError('invalid_request', { attempts: 0 });
        const headers = { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
        const init = { method: 'POST', headers, body: JSON.stringify(bodyFor(config, messages, options)) };
        const maxRetries = options.purpose === 'probe' ? 0 : Math.min(3, Math.floor(duration(options.maxRetries, 3)));
        let gatewayRetries = 0;
        for (let number = 1;; number++) {
            const started = Date.now();
            try {
                return await attempt(config.apiUrl, init, options, number, config.model);
            }
            catch (error) {
                const failure = error instanceof LLMError ? error : new LLMError('network', { attempts: number });
                if (failure.category === 'cancelled')
                    throw failure;
                reportDiagnostic({ event: 'model', operation: 'request', category: failure.category, host: new URL(config.apiUrl).hostname, model: config.model, status: failure.status, attempt: number, elapsedMs: Date.now() - started });
                const status = failure.status;
                const retryable = failure.category === 'network' || (status !== undefined && [408, 425, 429].includes(status)) || (status !== undefined && status >= 500);
                const gateway = status === 504 || status === 524;
                if (!retryable || failure.partialText || failure.category === 'timeout' || number > maxRetries || (gateway && gatewayRetries >= 1))
                    throw failure;
                if (gateway)
                    gatewayRetries++;
                const delay = Math.max(1000 * 2 ** (number - 1) + Math.max(0, Math.min(1, random())) * 250, failure.retryAfterMs ?? 0);
                // A long server cooldown is returned to the user; never retry earlier than requested.
                if (delay > MAX_RETRY_WAIT)
                    throw failure;
                try {
                    await wait(delay, options.signal);
                }
                catch {
                    throw new LLMError('cancelled', { attempts: number });
                }
            }
        }
    }
    async function models(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
        const started = Date.now();
        const url = baseUrl.replace(/\/v1\/chat\/completions\/?$/, '/v1/models');
        const controller = new AbortController();
        const stop = () => controller.abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, 30000);
        signal?.addEventListener('abort', stop, { once: true });
        let status: number | undefined;
        try {
            if (signal?.aborted)
                throw ABORTED;
            try {
                if (!['http:', 'https:'].includes(new URL(url).protocol))
                    throw Error();
            }
            catch {
                throw new LLMError('invalid_request', { attempts: 0 });
            }
            const response = await abortable(transport(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: controller.signal }), controller.signal);
            status = response.status;
            if (!response.ok)
                throw new LLMError(statusCategory(status), { attempts: 1, status });
            let data: Record<string, unknown>;
            try {
                data = await abortable(response.json(), controller.signal);
            }
            catch (error) {
                if (controller.signal.aborted)
                    throw error;
                throw new LLMError('parse', { attempts: 1, status });
            }
            if (data?.error)
                throw new LLMError(embeddedCategory(data.error), { attempts: 1, status });
            if (!Array.isArray(data?.data))
                throw new LLMError('parse', { attempts: 1, status });
            return [...new Set<string>(data.data.flatMap((item: {
                    id?: unknown;
                }) => typeof item?.id === 'string' && item.id.trim() ? [item.id] : []))].sort();
        }
        catch (error) {
            if (signal?.aborted)
                throw new LLMError('cancelled', { attempts: 1 });
            const failure = error instanceof LLMError ? error : new LLMError(timedOut ? 'timeout' : 'network', { attempts: 1, status });
            let host: string | undefined;
            try {
                host = new URL(url).hostname;
            }
            catch { /* Invalid URL has no host. */ }
            reportDiagnostic({ event: 'model', operation: 'request', category: failure.category, host, status, attempt: failure.attempts, elapsedMs: Date.now() - started });
            throw failure;
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', stop);
            controller.abort();
        }
    }
    return { complete, models };
}
