import type { ChatLocator } from './catalog';
import { captureRequest, responseObservation, type RequestSnapshot, type ResponseObservation } from './request-diagnostics';

export type ProcessStage = 'prepare' | 'world' | 'request' | 'response' | 'processed' | 'variables' | 'saved' | 'memory' | 'error';
export interface ProcessEvent { stage: ProcessStage; label: string; at: number; detail?: string }
export interface ChatProcess {
  id: string; key: string; storyId: string; branchId: string | null; fileName: string; type: string;
  startedAt: number; status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  messageId?: string; candidateId?: string; floor?: number; events: ProcessEvent[];
  agentTurnId?: string;
  incomingRequest?: RequestSnapshot; finalRequest?: RequestSnapshot;
  response?: ResponseObservation;
  requestUnavailable?: string;
}

/** Diagnostics never retain transport headers. Details are bounded and scrub known connection secrets. */
export function processDetail(value: unknown, secrets: string[] = []): string {
  let nodes = 0;
  const scrub = (text: string) => secrets.filter(Boolean).reduce((s, secret) => s.split(secret).join('[已隐藏]'), text);
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 1500 || depth > 10) return '…';
    if (typeof item === 'bigint') return String(item);
    if (typeof item === 'string') { const text = scrub(item); return text.length > 12_000 ? text.slice(0, 12_000) + '…（已截断）' : text; }
    if (Array.isArray(item)) return [...item.slice(0, 300).map(x => visit(x, depth + 1)), ...(item.length > 300 ? ['…（已截断）'] : [])];
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 300)
      .map(([key, val]) => [scrub(key), /authorization|api[_-]?key|cookie|password|secret|access[_-]?token/i.test(key) ? '[已隐藏]' : visit(val, depth + 1)]));
    return item;
  }
  const text = typeof value === 'string' ? scrub(value) : JSON.stringify(visit(value, 0), null, 2) ?? '';
  return text.length > 16_000 ? text.slice(0, 16_000) + '\n…（详情已截断）' : text;
}

/** Session-only diagnostics. No archive writes; bounded across all open stories. */
export function createProcessLog(secrets: () => string[] = () => [], clock = Date.now) {
  let records: ChatProcess[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) try { listener(); } catch { /* Observers cannot affect generation. */ } };
  const update = (id: string, change: (record: ChatProcess) => ChatProcess) => {
    records = records.map(record => record.id === id ? change(record) : record); notify();
  };
  return {
    snapshot: () => records,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear() { records = []; notify(); },
    get: (id: string) => records.find(record => record.id === id),
    start(locator: ChatLocator, type: string) {
      const id = crypto.randomUUID();
      records = [...records.slice(-19), { id, key: locator.key, storyId: locator.storyId, branchId: locator.branchId,
        fileName: locator.fileName, type: type.slice(0, 40), startedAt: clock(), status: 'pending', events: [] }];
      notify(); return id;
    },
    event(id: string, stage: ProcessStage, label: string, value?: unknown) {
      update(id, record => {
        const remaining = Math.max(0, 64_000 - record.events.reduce((n, e) => n + (e.detail?.length ?? 0), 0));
        let detail: string | undefined, safeLabel = '过程事件';
        try {
          const keys = secrets();
          safeLabel = processDetail(label, keys).slice(0, 160);
          if (value !== undefined && remaining > 0) {
            const text = processDetail(value, keys);
            detail = text.length <= remaining ? text : text.slice(0, Math.max(0, remaining - 12)) + '…（详情已截断）'.slice(0, remaining);
          }
        } catch { /* Unsupported plugin values must not interrupt generation or saving. */ }
        const event = { stage, label: safeLabel, at: clock(), detail };
        return { ...record, events: [...record.events.slice(-39), event] };
      });
    },
    request(id: string, boundary: 'incoming' | 'final', body: unknown) {
      try {
        const snapshot = captureRequest(body, secrets(), boundary === 'final' ? 512_000 : 256_000, clock);
        update(id, record => ({ ...record, [boundary === 'final' ? 'finalRequest' : 'incomingRequest']: snapshot }));
      } catch { update(id, record => ({ ...record, requestUnavailable: '请求快照未能捕获；生成仍按原请求继续' })); }
    },
    response(id: string, outcome: Parameters<typeof responseObservation>[0]) {
      try { const response = responseObservation(outcome); update(id, record => ({ ...record, response })); }
      catch { /* A diagnostic receipt must never change the provider result. */ }
    },
    bind(id: string, messageId: string, candidateId: string, floor: number) {
      update(id, record => ({ ...record, messageId, candidateId, floor }));
    },
    agent(id: string, agentTurnId: string) { update(id, record => ({ ...record, agentTurnId })); },
    finish(id: string, status: ChatProcess['status']) { update(id, record => ({ ...record, status })); },
  };
}
