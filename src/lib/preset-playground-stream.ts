import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { sendCompletion } from './roleplay/provider';
import { monitorCompletion, type CompletionOutcome } from './roleplay/completion-monitor';
import { waitForAbort } from './roleplay/abort';

/** Uses the roleplay transport (including native HTTP) and validates terminal SSE using its shared monitor. */
export async function streamPresetPlayground(config: APIConfig, request: Record<string, unknown>, signal: AbortSignal, onText: (text: string) => void): Promise<string> {
  const pending = sendCompletion(config, { ...request, stream: true }, signal).then(response => {
    if (signal.aborted) {
      // Some transports resolve after cancellation. Release their otherwise unconsumed response body.
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
    }
    return response;
  });
  const response = await waitForAbort(pending, signal);
  if (!response.ok) {
    const body = await waitForAbort(response.json().catch(() => null), signal);
    throw new Error(body?.error?.message || `模型请求失败（HTTP ${response.status}）`);
  }
  let outcome: CompletionOutcome | undefined;
  const streaming = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
  const monitored = monitorCompletion(response, { signal, stream: streaming, onFinish: value => { outcome = value; } });
  const reader = monitored.body!.getReader(), decoder = new TextDecoder();
  let content = '', buffer = '';
  try {
    for (;;) {
      const chunk = await waitForAbort(reader.read(), signal);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!streaming) continue;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data.trim() === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data), delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') { content += delta; signal.throwIfAborted(); onText(content); }
        } catch (error) { if (signal.aborted) throw error; }
      }
    }
    signal.throwIfAborted();
    if (!outcome || outcome.status !== 'succeeded') throw new Error('回复未完整结束或模型返回空内容，可重试本轮。');
    if (!streaming) onText(outcome.content);
    return outcome.content;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
