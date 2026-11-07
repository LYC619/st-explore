import type { WorldIntelligence, WorldRequestReceipt } from './types';

export class WorldBudgetError extends Error { constructor(message = '本次推演额度已用完，请检查用量后开启新额度或切换规则模式') { super(message); this.name = 'WorldBudgetError'; } }
export function beginBudget(data: WorldIntelligence, now = Date.now()): WorldIntelligence {
  return { ...data, budget: { id: crypto.randomUUID(), startedAt: now, calls: 0, charged: 0, maxCalls: data.settings.maxCalls, maxTokens: data.settings.maxTokens } };
}
export function reserveBudget(data: WorldIntelligence, receipt: Omit<WorldRequestReceipt, 'runId' | 'charged' | 'status' | 'estimated'>, now = Date.now()): WorldIntelligence {
  const budget = data.budget;
  if (!budget) throw new WorldBudgetError('尚未开启推演额度，请在角色智能中确认预算');
  if (now - budget.startedAt > 5 * 60_000) throw new WorldBudgetError('本次额度会话已超过 5 分钟，请检查用量后开启新额度');
  if (!Number.isSafeInteger(receipt.reserved) || receipt.reserved <= 0 || budget.calls + 1 > budget.maxCalls || budget.charged + receipt.reserved > budget.maxTokens) throw new WorldBudgetError();
  return { ...data, budget: { ...budget, calls: budget.calls + 1, charged: budget.charged + receipt.reserved },
    receipts: [...data.receipts.slice(-99), { ...receipt, runId: budget.id, charged: receipt.reserved, estimated: true, status: 'reserved' }] };
}
export function settleBudget(data: WorldIntelligence, id: string, status: WorldRequestReceipt['status'], usage?: { input: number; output: number }, elapsedMs?: number): WorldIntelligence {
  const receipt = data.receipts.find(r => r.id === id); if (!receipt || receipt.status !== 'reserved') return data;
  const reliable = usage && Number.isSafeInteger(usage.input) && usage.input >= 0 && Number.isSafeInteger(usage.output) && usage.output >= 0;
  const charged = reliable ? usage.input + usage.output : receipt.reserved;
  return { ...data, budget: data.budget?.id === receipt.runId ? { ...data.budget, charged: data.budget.charged - receipt.charged + charged } : data.budget,
    receipts: data.receipts.map(r => r.id === id ? { ...r, status, charged, estimated: !reliable, elapsedMs,
      ...(reliable ? { inputTokens: usage.input, outputTokens: usage.output } : {}) } : r) };
}
