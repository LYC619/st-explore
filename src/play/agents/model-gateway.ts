import { getAPIConfigForSelection, type APIConfig } from '@/components/ai-tools/api-profiles';
import { prepareCompletion, sendPreparedCompletion, type PreparedCompletion } from '@/lib/roleplay/provider';
import { tokenizeTavern } from '@/lib/roleplay/tokenizer';
import { captureRequest } from '@/lib/roleplay/request-diagnostics';
import { reserveBudget, settleBudget } from './budget';
import type { WorldIntelligence, WorldRequestReceipt } from './types';

export interface WorldModelDependencies {
  config?: (selection: { profileId: string; model: string }) => APIConfig | undefined;
  send?: (request: PreparedCompletion, signal: AbortSignal) => Promise<Response>;
  now?: () => number;
}
export interface WorldTrace { id: string; actorId?: string; purpose: string; request: ReturnType<typeof captureRequest> }
export class WorldModelGateway {
  readonly traces: WorldTrace[] = [];
  constructor(private read: () => WorldIntelligence, private persist: (data: WorldIntelligence) => Promise<void>, private dependencies: WorldModelDependencies = {}) {}
  async request(input: { purpose: WorldRequestReceipt['purpose']; actorId?: string; tick: number; system: string; context: Record<string, unknown>; factIds?: string[]; maxOutput?: number }, signal: AbortSignal): Promise<{ id: string; value: unknown }> {
    signal.throwIfAborted();
    const before = this.read(), profile = (this.dependencies.config ?? getAPIConfigForSelection)(before.settings);
    if (!profile) throw new Error('所选模型连接已不存在，请重新选择');
    const maxOutput = before.settings.outputTokens ?? Math.max(input.maxOutput ?? 0, 2048);
    const messages = [{ role: 'system', content: input.system }, { role: 'user', content: JSON.stringify(input.context) }];
    const request = prepareCompletion(profile, { messages, max_tokens: maxOutput, temperature: input.purpose === 'plan' ? .6 : .7, stream: false });
    const inputTokens = Number(tokenizeTavern(`/api/tokenizers/openai/count?model=${encodeURIComponent(profile.model)}`, request.body.messages).token_count);
    if (!Number.isFinite(inputTokens) || inputTokens > (input.purpose === 'plan' ? 2000 : 3000)) throw new Error('本次角色上下文超出输入上限，请缩短人设或停用部分记忆');
    const now = this.dependencies.now ?? Date.now, started = now(), id = crypto.randomUUID();
    await this.persist(reserveBudget(before, { id, purpose: input.purpose, actorId: input.actorId, tick: input.tick, contextRevision: typeof input.context.contextRevision === 'number' ? input.context.contextRevision : before.contextRevision,
      factIds: input.factIds ?? [], model: profile.model, reserved: inputTokens + maxOutput }, started));
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const timeout = setTimeout(() => controller.abort(new DOMException('模型请求超时', 'TimeoutError')), before.settings.requestTimeoutMs);
    this.traces.push({ id, actorId: input.actorId, purpose: input.purpose, request: captureRequest(request.body, [profile.apiKey], 32000) });
    if (this.traces.length > 20) this.traces.shift();
    let usage: { input: number; output: number } | undefined;
    try {
      controller.signal.throwIfAborted();
      const response = await (this.dependencies.send ?? sendPreparedCompletion)(request, controller.signal);
      if (!response.ok) { await response.body?.cancel(); throw new Error(`模型服务返回 HTTP ${response.status}，本轮已暂停`); }
      const text = await limitedText(response, controller.signal);
      let result: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: unknown }; finish_reason?: string }[] };
      try { result = JSON.parse(text); } catch { throw new Error('模型响应不是有效 JSON，本轮已暂停'); }
      if (typeof result.usage?.prompt_tokens === 'number' && typeof result.usage?.completion_tokens === 'number') usage = { input: result.usage.prompt_tokens, output: result.usage.completion_tokens };
      if (result.choices?.[0]?.finish_reason === 'length') throw new Error('本次输出额度不足，模型已截断。可在“本次额度与记忆整理”调高单次输出上限后继续；本次未自动重试');
      const content = result.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回正文，本轮已暂停');
      let value: unknown;
      try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new Error('模型没有遵循结构化输出，本轮已暂停；未自动重试'); }
      controller.signal.throwIfAborted();
      await this.persist(settleBudget(this.read(), id, 'completed', usage, now() - started));
      return { id, value };
    } catch (error) {
      // The reservation was already durable before transport. Even if settlement
      // fails or the vault switches, a paid request cannot silently become free.
      await this.persist(settleBudget(this.read(), id, controller.signal.aborted ? 'cancelled' : 'failed', usage, now() - started));
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('推演已停止', 'AbortError');
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  }
}
async function limitedText(response: Response, signal: AbortSignal) {
  if (!response.body) throw new Error('模型响应为空');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let size = 0, output = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 256 * 1024) throw new Error('模型响应超过 256 KB，已停止读取');
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
