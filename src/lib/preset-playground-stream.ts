import type { APIConfig } from '@/components/ai-tools/api-profiles';
import { sendCompletion } from './roleplay/provider';
import { monitorCompletion, type CompletionOutcome } from './roleplay/completion-monitor';
import { waitForAbort } from './roleplay/abort';
import { LLMError, statusCategory } from './llm/errors';

/** Uses the roleplay transport (including native HTTP) and validates terminal SSE across OpenAI, Anthropic, and Gemini. */
export async function streamPresetPlayground(
  config: APIConfig,
  request: Record<string, unknown>,
  parentSignal: AbortSignal,
  onText: (text: string) => void,
  options: { idleTimeoutMs?: number; onReasoning?: () => void } = {},
): Promise<string> {
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error('模型连接连续两分钟未返回数据，请检查连接或重试本轮。')),
      options.idleTimeoutMs ?? 120_000,
    );
  };
  touch();
  try {
    return await consumePresetStream(config, request, signal, onText, touch, options.onReasoning);
  } finally {
    clearTimeout(timer!);
    parentSignal.removeEventListener('abort', abort);
  }
}

function extractStreamDelta(parsed: Record<string, unknown>, eventName?: string): { delta?: string; reasoning?: boolean } {
  const type = typeof parsed.type === 'string' ? parsed.type : eventName;
  // Native Anthropic SSE
  if (type === 'content_block_delta' && parsed.delta && typeof parsed.delta === 'object') {
    const deltaObj = parsed.delta as Record<string, unknown>;
    if (deltaObj.type === 'thinking_delta') return { reasoning: true };
    if (deltaObj.type === 'text_delta' && typeof deltaObj.text === 'string') return { delta: deltaObj.text };
    return {};
  }
  // Native Gemini SSE
  if (Array.isArray(parsed.candidates)) {
    const candidate = parsed.candidates[0] as Record<string, unknown> | undefined;
    const parts = Array.isArray((candidate?.content as Record<string, unknown> | undefined)?.parts)
      ? ((candidate!.content as Record<string, unknown>).parts as Array<Record<string, unknown>>)
      : [];
    let delta = '';
    let reasoning = false;
    for (const part of parts) {
      if (part?.thought) reasoning = true;
      else if (typeof part?.text === 'string') delta += part.text;
    }
    return { delta: delta || undefined, reasoning };
  }
  // OpenAI / compatible SSE
  const choice = Array.isArray(parsed.choices) ? (parsed.choices[0] as Record<string, unknown> | undefined) : undefined;
  const choiceDelta = (choice?.delta as Record<string, unknown> | undefined) ?? undefined;
  const reasoning = Boolean(choiceDelta?.reasoning_content || choiceDelta?.reasoning);
  const delta = typeof choiceDelta?.content === 'string' ? choiceDelta.content : undefined;
  return { delta, reasoning };
}

async function consumePresetStream(
  config: APIConfig,
  request: Record<string, unknown>,
  signal: AbortSignal,
  onText: (text: string) => void,
  touch: () => void,
  onReasoning?: () => void,
): Promise<string> {
  const pending = sendCompletion(config, { ...request, stream: true }, signal).then(response => {
    if (signal.aborted) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
    }
    return response;
  });
  const response = await waitForAbort(pending, signal);
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new LLMError(statusCategory(response.status), { attempts: 1, status: response.status });
  }
  let outcome: CompletionOutcome | undefined;
  const streaming = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
  const monitored = monitorCompletion(response, { signal, stream: streaming, onFinish: value => { outcome = value; } });
  const reader = monitored.body!.getReader(), decoder = new TextDecoder();
  let content = '', buffer = '';
  try {
    const consumeFrames = () => {
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = event.split(/\r?\n/);
        const eventLine = lines.find(line => line.startsWith('event:'));
        const eventName = eventLine ? eventLine.slice(6).trim() : undefined;
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data.trim() === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const { delta, reasoning } = extractStreamDelta(parsed, eventName);
          if (reasoning) onReasoning?.();
          if (typeof delta === 'string' && delta) {
            content += delta;
            signal.throwIfAborted();
            onText(content);
          }
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
    };
    for (;;) {
      const chunk = await waitForAbort(reader.read(), signal);
      if (chunk.done) {
        buffer += decoder.decode();
        if (streaming && buffer.trim()) {
          buffer += '\n\n';
          consumeFrames();
        }
        break;
      }
      touch();
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!streaming) continue;
      consumeFrames();
      // The shared monitor validates [DONE] / message_stop / Gemini STOP before releasing its bytes.
      // A terminal response is complete even when the provider keeps SSE open.
      if (outcome) break;
    }
    signal.throwIfAborted();
    if (!outcome || outcome.status !== 'succeeded') throw new Error('回复未完整结束或模型返回空内容，可重试本轮。');
    if (!streaming) onText(outcome.content);
    return outcome.content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
