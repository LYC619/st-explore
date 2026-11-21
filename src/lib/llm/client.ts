import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { providerFetch } from '@/lib/roleplay/provider';
import { reportDiagnostic } from '@/lib/diagnostics';
import { embeddedCategory, LLMError, statusCategory } from './errors';
import { resolveProviderAdapter, type ProviderAdapter } from './providers';
import type { CallOptions, ChatCompletionMessage, CompletionResult, FetchTransport, ProviderProtocol } from './types';
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
export function createLLMClient({ transport = providerFetch, random = Math.random, defaults = DEFAULTS }: {
    transport?: FetchTransport;
    random?: () => number;
    defaults?: Partial<typeof DEFAULTS>;
} = {}) {
    async function attempt(adapter: ProviderAdapter, url: string, init: RequestInit, options: CallOptions, number: number, model?: string): Promise<CompletionResult> {
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
                let data: unknown;
                try {
                    data = await abortable(response.json(), controller.signal);
                }
                catch (error) {
                    if (controller.signal.aborted)
                        throw error;
                    throw failure('parse');
                }
                const parsed = adapter.parseJsonResponse(data);
                if (parsed.error)
                    throw failure(parsed.error);
                if (parsed.blocked)
                    throw failure('blocked');
                text = parsed.text;
                if (!text.trim())
                    throw failure('empty');
                if (controller.signal.aborted)
                    throw ABORTED;
                options.onChunk?.(text);
                return { text, truncated: parsed.truncated, attempts: number, status, malformedLines: 0 };
            }
            if (!response.body)
                throw failure('empty');
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '', currentEvent: string | undefined, doneMarker = false, finished = false, truncated = false, parsedLines = 0, receivedBytes = false;
            const consume = (raw: string) => {
                if (controller.signal.aborted)
                    throw ABORTED;
                const line = raw.trimEnd();
                if (!line) {
                    currentEvent = undefined;
                    return;
                }
                if (line.startsWith('event:')) {
                    currentEvent = line.slice(6).trim() || undefined;
                    return;
                }
                if (!line.startsWith('data:'))
                    return;
                const payload = line.slice(5).trim();
                if (!payload)
                    return;
                const chunk = adapter.parseStreamEvent({ event: currentEvent, data: payload });
                if (chunk.done) {
                    doneMarker = true;
                    if (chunk.finished) finished = true;
                    if (chunk.truncated) truncated = true;
                    return;
                }
                if (chunk.malformed) {
                    malformedLines++;
                    return;
                }
                parsedLines++;
                if (chunk.error)
                    throw failure(chunk.error);
                if (chunk.blocked)
                    throw failure('blocked');
                if (chunk.finished)
                    finished = true;
                if (chunk.truncated)
                    truncated = true;
                if (chunk.delta) {
                    text += chunk.delta;
                    options.onChunk?.(chunk.delta);
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
            if (!doneMarker && !finished)
                throw failure('interrupted');
            return { text, truncated, attempts: number, status, malformedLines };
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
        const adapter = resolveProviderAdapter(config);
        const prepared = adapter.buildRequest({
            config,
            messages,
            params: options.params,
            stream: !!options.onChunk,
            responseSchema: options.responseSchema,
        });
        const init: RequestInit = { method: prepared.method, headers: prepared.headers, body: JSON.stringify(prepared.body) };
        const maxRetries = options.purpose === 'probe' ? 0 : Math.min(3, Math.floor(duration(options.maxRetries, 3)));
        let gatewayRetries = 0;
        for (let number = 1;; number++) {
            const started = Date.now();
            try {
                return await attempt(adapter, prepared.url, init, options, number, config.model);
            }
            catch (error) {
                const failure = error instanceof LLMError ? error : new LLMError('network', { attempts: number });
                if (failure.category === 'cancelled')
                    throw failure;
                reportDiagnostic({ event: 'model', operation: 'request', category: failure.category, host: new URL(prepared.url).hostname, model: config.model, status: failure.status, attempt: number, elapsedMs: Date.now() - started });
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
    async function models(baseUrl: string, apiKey: string, signal?: AbortSignal, protocol?: ProviderProtocol): Promise<string[]> {
        const started = Date.now();
        const controller = new AbortController();
        const stop = () => controller.abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, 30000);
        signal?.addEventListener('abort', stop, { once: true });
        let status: number | undefined;
        let url = baseUrl;
        try {
            if (signal?.aborted)
                throw ABORTED;
            try {
                if (!['http:', 'https:'].includes(new URL(baseUrl).protocol))
                    throw Error();
            }
            catch {
                throw new LLMError('invalid_request', { attempts: 0 });
            }
            const adapter = resolveProviderAdapter({ apiUrl: baseUrl, protocol });
            const request = adapter.buildModelsRequest(baseUrl, apiKey);
            url = request.url;
            const response = await abortable(transport(url, { headers: request.headers, signal: controller.signal }), controller.signal);
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
            const parsedModels = adapter.parseModelsResponse(data);
            if (!parsedModels)
                throw new LLMError('parse', { attempts: 1, status });
            return parsedModels;
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
