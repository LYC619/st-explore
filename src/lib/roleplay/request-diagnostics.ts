import { equalJson, variableChanges } from '@/lib/variable-inspector';

export interface RequestSnapshot {
  body: Record<string, unknown>; complete: boolean; redacted: boolean;
  originalMessages: number; capturedAt: number; notes: string[];
}
const credential = /authorization|api[_-]?key|cookie|password|secret|access[_-]?token|refresh[_-]?token/i;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Body only: no transport headers/URL. Limits refer to retained UTF-16 characters. */
export function captureRequest(body: unknown, secrets: string[] = [], limit = 512_000, clock = Date.now): RequestSnapshot {
  const source = object(body);
  if (!source || !Array.isArray(source.messages)) throw new Error('请求需要 messages 数组');
  let remaining = limit, nodes = 0, truncated = false, redacted = false;
  const seen = new WeakSet<object>();
  const scrub = (text: string) => {
    let safe = secrets.filter(Boolean).reduce((value, key) => value.split(key).join('[已隐藏]'), text);
    safe = safe.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]');
    if (safe !== text) redacted = true;
    return safe;
  };
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 12000 || depth > 32 || remaining <= 0) { truncated = true; return '…（快照截断）'; }
    remaining -= 8;
    if (typeof item === 'string') {
      const safe = scrub(item);
      if (safe.length > remaining) { const clipped = safe.slice(0, Math.max(0, remaining)); remaining = 0; truncated = true; return clipped + '…（快照截断）'; }
      remaining -= safe.length; return safe;
    }
    if (item && typeof item === 'object') {
      if (seen.has(item)) { truncated = true; return '…（循环引用）'; }
      seen.add(item);
      if (Array.isArray(item)) {
        const result: unknown[] = [];
        for (const child of item) { if (remaining <= 0 || nodes >= 12000) { truncated = true; break; } result.push(visit(child, depth + 1)); }
        seen.delete(item); return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const [key, child] of Object.entries(item)) {
        if (remaining <= 0 || nodes >= 12000) { truncated = true; break; }
        const safeKey = scrub(key);
        if (safeKey.length + 8 > remaining) { truncated = true; break; }
        remaining -= safeKey.length;
        if (credential.test(key)) { result[safeKey] = '[已隐藏]'; redacted = true; }
        else result[safeKey] = visit(child, depth + 1);
      }
      seen.delete(item); return result;
    }
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'function' || typeof item === 'symbol') { truncated = true; return '（不支持的值）'; }
    return item;
  }
  // Messages first so an oversized custom parameter cannot displace the prompt.
  const { messages, ...parameters } = source;
  const safe = visit({ messages, ...parameters }, 0) as Record<string, unknown>;
  return { body: safe, complete: !truncated, redacted, originalMessages: (messages as unknown[]).length, capturedAt: clock(),
    notes: [...(truncated ? [`超过 ${limit.toLocaleString()} 字符、12000 节点或 32 层限制，不能判断完整请求相同`] : []), ...(redacted ? ['已隐藏凭据；比较基于脱敏后的请求'] : [])] };
}

export function importRequest(text: string, secrets: string[] = []): RequestSnapshot {
  if (text.length > 4 * 1024 * 1024) throw new Error('请求 JSON 不能超过 4 MiB');
  let value: unknown; try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('不是有效的请求 JSON'); }
  let data = object(value);
  const entries = object(data?.log)?.entries;
  if (Array.isArray(entries)) {
    const bodies = entries.flatMap(entry => { const request = object(object(entry)?.request); const text = object(request?.postData)?.text;
      if (typeof text !== 'string') return []; try { const body = JSON.parse(text); return Array.isArray(body?.messages) ? [body] : []; } catch { return []; } });
    if (bodies.length !== 1) throw new Error(`HAR 中找到 ${bodies.length} 个聊天请求，请只保留一个请求或复制其请求体 JSON`);
    data = bodies[0];
  } else {
    // STE exported snapshots and common request/body wrappers; headers are discarded.
    const wrapped = data?.body ?? object(data?.request)?.body ?? object(object(data?.request)?.postData)?.text ?? object(data?.postData)?.text;
    if (wrapped !== undefined) { try { data = object(typeof wrapped === 'string' ? JSON.parse(wrapped) : wrapped); } catch { throw new Error('包装内的 body 不是有效 JSON'); } }
  }
  if (!Array.isArray(data?.messages) || data.messages.some(message => !object(message) || typeof object(message)?.role !== 'string')) {
    throw new Error('请选择实际 Chat Completion 请求体（messages 与 role），不是预设文件');
  }
  const snapshot = captureRequest(data, secrets);
  // A previously truncated exported snapshot stays incomplete when imported.
  if (object(value)?.complete === false) { snapshot.complete = false; snapshot.notes.push('导入文件原本就是不完整快照'); }
  return snapshot;
}
export function compareRequests(left: RequestSnapshot, right: RequestSnapshot) {
  const { messages: a, ...aParams } = left.body, { messages: b, ...bParams } = right.body;
  const leftMessages = Array.isArray(a) ? a : [], rightMessages = Array.isArray(b) ? b : [];
  const messages = Array.from({ length: Math.max(leftMessages.length, rightMessages.length) }, (_, index) => ({
    index, before: leftMessages[index], after: rightMessages[index],
    changed: index >= leftMessages.length || index >= rightMessages.length || !equalJson(leftMessages[index], rightMessages[index]),
  }));
  const parameters = variableChanges(aParams, bParams);
  return { messages, parameters, comparable: left.complete && right.complete,
    equal: left.complete && right.complete && !parameters.truncated && !parameters.changes.length && messages.every(m => !m.changed) };
}

export interface ResponseObservation {
  contentChars: number; toolCalls: number; finishReason?: string; usage?: unknown;
}
export function responseObservation(outcome: { content: string; toolCalls?: unknown[]; finishReason?: string; usage?: unknown }): ResponseObservation {
  const usage = object(outcome.usage);
  return { contentChars: outcome.content.length, toolCalls: outcome.toolCalls?.length ?? 0, finishReason: outcome.finishReason?.slice(0, 80),
    usage: usage ? Object.fromEntries(Object.entries(usage).filter(([key, val]) => /tokens|cache/i.test(key) && (typeof val === 'number' || object(val))).map(([key, val]) => [key, typeof val === 'number' ? val : Object.fromEntries(Object.entries(object(val)!).filter(([, count]) => typeof count === 'number'))])) : undefined };
}
