import { afterEach, expect, it, vi } from 'vitest';
import { callOpenAIMessages } from '@/lib/llm';
const config = { apiUrl: 'https://synthetic.invalid/v1/chat/completions', apiKey: 'synthetic-key', model: 'synthetic-model' };
const messages = [{ role: 'user' as const, content: 'Synthetic prompt' }];
afterEach(() => vi.unstubAllGlobals());
it('classifies authentication failure without copying server text or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Bearer synthetic-key private server text' } }), { status: 401 })));
    await expect(callOpenAIMessages(config, messages)).rejects.toMatchObject({ category: 'permission', attempts: 1, status: 401 });
});
it('allows a local service without sending an empty authorization header', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Synthetic answer' }, finish_reason: 'stop' }] })));
    vi.stubGlobal('fetch', fetcher);
    await expect(callOpenAIMessages({ ...config, apiKey: '' }, messages)).resolves.toBe('Synthetic answer');
    expect(new Headers(fetcher.mock.calls[0][1].headers).has('Authorization')).toBe(false);
});
it('preserves the established request body field for field', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Synthetic answer' }, finish_reason: 'stop' }] })));
    vi.stubGlobal('fetch', fetcher);
    await callOpenAIMessages(config, messages, { params: { temperature: 0, top_p: 0.5, frequency_penalty: 0.2, presence_penalty: 0.1, max_tokens: 40 } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: config.model, messages, temperature: 0, top_p: 0.5, frequency_penalty: 0.2, presence_penalty: 0.1, max_tokens: 40 });
});
