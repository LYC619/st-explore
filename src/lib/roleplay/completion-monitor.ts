export interface CompletionOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  content: string;
  usage?: unknown;
  finishReason?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};

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
    if (!['tool_calls', 'function_call'].includes(finishReason ?? '') || !calls.size) return false;
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
  function observe(value: unknown, isDelta: boolean) {
    const payload = object(value);
    if (payload.error) invalid = true;
    if (payload.usage) usage = payload.usage;
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
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        if (data.trim() === '[DONE]') { terminal = true; await finish(successful() ? 'succeeded' : 'failed'); }
        else {
          try { observe(JSON.parse(data), true); } catch { invalid = true; }
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
