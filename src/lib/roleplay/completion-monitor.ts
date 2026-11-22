export interface CompletionOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  content: string;
  usage?: unknown;
  finishReason?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const GEMINI_TERMINAL_REASONS = new Set(['STOP', 'MAX_TOKENS']);

/** Observes the real provider body, preserving its status, bytes, pull backpressure and cancellation. */
export function monitorCompletion(response: Response, options: {
  signal?: AbortSignal;
  stream?: boolean;
  onFinish: (outcome: CompletionOutcome) => void | Promise<void>;
  onRelease?: () => void;
  onFirstChunk?: () => void;
}): Response {
  const { signal } = options;
  const reader = response.body?.getReader();
  let content = '', buffer = '', finishReason: string | undefined, usage: unknown;
  const calls = new Map<number, { name: string; arguments: string }>();
  const completeToolCalls = () => {
    if (!['tool_calls', 'function_call', 'tool_use'].includes(finishReason ?? '') || !calls.size) return false;
    return [...calls.values()].every(call => {
      if (!call.name) return false;
      try { const args = JSON.parse(call.arguments); return args !== null && typeof args === 'object' && !Array.isArray(args); }
      catch { return false; }
    });
  };
  const successful = () => !invalid && (content.trim() || completeToolCalls());
  let terminal = false, invalid = !response.ok, ended = false, terminalReleased = false;
  let finished: Promise<void> | undefined;
  let reportedStatus: CompletionOutcome['status'] | undefined;
  let received = false;
  const decoder = new TextDecoder();
  const streaming = options.stream ?? response.headers.get('content-type')?.includes('text/event-stream') ?? false;
  const finish = (status: CompletionOutcome['status']) => {
    // Saving a receipt is asynchronous. A stop before releasing its terminal bytes must revoke provisional success.
    if (!reportedStatus || !terminalReleased && reportedStatus === 'succeeded' && status !== 'succeeded') {
      reportedStatus = status;
      const prior = finished;
      const notification = Promise.resolve(options.onFinish({ status, content, usage, finishReason,
        ...(calls.size ? { toolCalls: [...calls.values()].map(call => ({ ...call })) } : {}) }));
      finished = prior ? Promise.all([prior, notification]).then(() => {}) : notification;
    }
    return finished!;
  };
  function observe(value: unknown, isDelta: boolean, eventName?: string): 'done' | void {
    const payload = object(value);
    if (payload.type === 'error' || payload.error) { invalid = true; return; }
    if (payload.usage) usage = payload.usage;

    // Native Anthropic non-streaming JSON
    if (!isDelta && Array.isArray(payload.content)) {
      if (payload.stop_reason === 'refusal') { invalid = true; return; }
      payload.content.forEach((rawBlock, idx) => {
        const block = object(rawBlock);
        if (block.type === 'text' && typeof block.text === 'string') content += block.text;
        else if (block.type === 'tool_use' && typeof block.name === 'string') {
          calls.set(idx, { name: block.name, arguments: JSON.stringify(object(block.input)) });
        }
      });
      if (typeof payload.stop_reason === 'string') finishReason = payload.stop_reason;
      else if (calls.size) finishReason = 'tool_use';
      terminal = true;
      return;
    }

    // Native Anthropic SSE events
    const anthropicType = isDelta ? (typeof payload.type === 'string' ? payload.type : eventName) : undefined;
    if (anthropicType && !Array.isArray(payload.choices) && !Array.isArray(payload.candidates)) {
      if (anthropicType === 'content_block_start') {
        const index = typeof payload.index === 'number' ? payload.index : calls.size;
        const block = object(payload.content_block);
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          const initialInput = block.input && typeof block.input === 'object' && Object.keys(object(block.input)).length > 0
            ? JSON.stringify(block.input)
            : '';
          calls.set(index, { name: block.name, arguments: initialInput });
        }
        return;
      }
      if (anthropicType === 'content_block_delta') {
        const delta = object(payload.delta);
        if (delta.type === 'text_delta' && typeof delta.text === 'string') content += delta.text;
        else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const index = typeof payload.index === 'number' ? payload.index : 0;
          const prev = calls.get(index) ?? { name: '', arguments: '' };
          calls.set(index, { name: prev.name, arguments: prev.arguments + delta.partial_json });
        }
        return;
      }
      if (anthropicType === 'content_block_stop') {
        const index = typeof payload.index === 'number' ? payload.index : -1;
        const call = calls.get(index);
        if (call && !call.arguments.trim()) calls.set(index, { ...call, arguments: '{}' });
        return;
      }
      if (anthropicType === 'message_delta') {
        const delta = object(payload.delta);
        if (typeof delta.stop_reason === 'string') {
          finishReason = delta.stop_reason;
          if (finishReason === 'refusal') invalid = true;
          else terminal = true;
        }
        return;
      }
      if (anthropicType === 'message_stop') {
        terminal = true;
        return 'done';
      }
      if (anthropicType === 'message_start') {
        const msgUsage = object(payload.message).usage;
        if (msgUsage) usage = msgUsage;
        return;
      }
      if (anthropicType === 'ping') return;
    }

    // Native Gemini SSE / JSON
    if (Array.isArray(payload.candidates) || payload.promptFeedback) {
      if (object(payload.promptFeedback).blockReason) { invalid = true; return; }
      if (payload.usageMetadata) usage = payload.usageMetadata;
      const candidate = object(Array.isArray(payload.candidates) ? payload.candidates[0] : null);
      const parts = Array.isArray(object(candidate.content).parts) ? object(candidate.content).parts as unknown[] : [];
      for (const rawPart of parts) {
        const part = object(rawPart);
        if (typeof part.text === 'string' && !part.thought) content += part.text;
        if (part.functionCall && typeof part.functionCall === 'object') {
          const fc = object(part.functionCall);
          if (typeof fc.name === 'string' && fc.name) {
            calls.set(calls.size, { name: fc.name, arguments: JSON.stringify(object(fc.args)) });
          }
        }
      }
      if (typeof candidate.finishReason === 'string' && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
        if (GEMINI_TERMINAL_REASONS.has(candidate.finishReason)) {
          finishReason = calls.size && !content.trim() ? 'tool_use' : candidate.finishReason;
          terminal = true;
          if (isDelta) return 'done';
        } else {
          finishReason = candidate.finishReason;
          invalid = true;
        }
      } else if (!isDelta && calls.size) {
        finishReason = 'tool_use';
        terminal = true;
      }
      return;
    }

    // OpenAI / OpenAI-compatible SSE & JSON
    const choice = object(Array.isArray(payload.choices) ? payload.choices[0] : null);
    const message = object(isDelta ? choice.delta : choice.message);
    if (typeof message.content === 'string') content += message.content;
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : message.function_call ? [{ index: 0, function: message.function_call }] : [];
    toolCalls.forEach((value, position) => {
      const call = object(value), fn = object(call.function), index = typeof call.index === 'number' ? call.index : position;
      const previous = calls.get(index) ?? { name: '', arguments: '' };
      calls.set(index, { name: previous.name + (typeof fn.name === 'string' ? fn.name : ''),
        arguments: previous.arguments + (typeof fn.arguments === 'string' ? fn.arguments : '') });
    });
    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason;
      if (['stop', 'length', 'tool_calls', 'function_call'].includes(finishReason)) terminal = true;
      else invalid = true;
    }
  }
  async function inspect(chunk: Uint8Array, eof = false) {
    buffer += decoder.decode(chunk, { stream: !eof });
    if (streaming) {
      if (eof && buffer.trim()) buffer += '\n\n';
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = event.split(/\r?\n/);
        const eventLine = lines.find(line => line.startsWith('event:'));
        const eventName = eventLine ? eventLine.slice(6).trim() : undefined;
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data.trim() === '[DONE]') { terminal = true; await finish(successful() ? 'succeeded' : 'failed'); }
        else {
          let signalDone = false;
          try { signalDone = observe(JSON.parse(data), true, eventName) === 'done'; } catch { invalid = true; }
          if (signalDone) await finish(successful() ? 'succeeded' : 'failed');
        }
      }
    } else if (eof) {
      try { observe(JSON.parse(buffer), false); terminal = true; } catch { invalid = true; }
    }
  }
  let abort: () => void;
  const release = () => { signal?.removeEventListener('abort', abort); options.onRelease?.(); };
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      abort = () => {
        if (ended) return;
        ended = true;
        void reader?.cancel().catch(() => {});
        void finish(terminalReleased ? reportedStatus! : 'cancelled').catch(() => {});
        output.error(new DOMException('生成已停止', 'AbortError'));
        release();
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    },
    async pull(output) {
      if (ended) return;
      try {
        const next = reader ? await reader.read() : { done: true, value: undefined };
        if (ended) return;
        if (next.done) {
          await inspect(new Uint8Array(), true);
          await finish(terminal && successful() ? 'succeeded' : 'failed');
          if (ended) return;
          ended = true; release(); output.close();
        } else {
          if (!received) { received = true; try { options.onFirstChunk?.(); } catch { /* Diagnostics only. */ } }
          await inspect(next.value!);
          if (!ended) { output.enqueue(next.value!); if (terminal && reportedStatus === 'succeeded') terminalReleased = true; }
        }
      } catch (error) {
        if (ended) return;
        ended = true;
        await finish(signal?.aborted ? 'cancelled' : 'failed').catch(() => {});
        release(); output.error(error);
      }
    },
    async cancel(reason) {
      if (ended) return;
      ended = true;
      await finish(terminalReleased ? reportedStatus! : 'cancelled');
      release(); await reader?.cancel(reason);
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
