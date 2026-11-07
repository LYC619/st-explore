export interface VariableRow {
  path: string; key: string; depth: number; value: unknown; container: boolean;
}
const pointer = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function variableRows(value: unknown, limit = 2500): { rows: VariableRow[]; truncated: boolean } {
  const rows: VariableRow[] = []; let truncated = false;
  function visit(item: unknown, path: string, key: string, depth: number) {
    if (rows.length >= limit || depth > 40) { truncated = true; return; }
    const container = !!item && typeof item === 'object';
    rows.push({ path, key, depth, value: item, container });
    if (container) for (const [name, child] of Object.entries(item)) {
      if (rows.length >= limit) { truncated = true; break; }
      visit(child, path + '/' + pointer(name), name, depth + 1);
    }
  }
  visit(value, '', '$', 0); return { rows, truncated };
}
export function variableText(value: unknown, max = 300): string {
  const text = value === undefined ? '（不存在）' : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + '…' : text;
}
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
};
export interface VariableChange { path: string; kind: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }
/** JSON object order is immaterial; array position and missing/null are distinct. */
export function variableChanges(before: unknown, after: unknown, limit = 2500) {
  const changes: VariableChange[] = []; let truncated = false, visited = 0;
  function visit(left: unknown, right: unknown, path: string, hasLeft = true, hasRight = true, depth = 0) {
    if (++visited > limit || depth > 40) { truncated = true; return; }
    if (!hasLeft || !hasRight) { changes.push({ path, kind: hasLeft ? 'removed' : 'added', before: left, after: right }); return; }
    if (Object.is(left, right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (visited >= limit) { truncated = true; break; }
        visit((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path + '/' + pointer(key), Object.hasOwn(left, key), Object.hasOwn(right, key), depth + 1);
      }
    } else changes.push({ path, kind: 'changed', before: left, after: right });
  }
  visit(before, after, ''); return { changes, truncated };
}
export type PreviewSample = 'original' | 'empty' | 'long' | 'extreme';
/** Derived test data only, preserving the draft and all message snapshots. */
export function previewSample(value: Record<string, unknown>, kind: PreviewSample): Record<string, unknown> {
  if (kind === 'empty') return {};
  if (kind === 'original') return structuredClone(value);
  let nodes = 0;
  function visit(item: unknown, depth = 0): unknown {
    if (++nodes > 2500 || depth > 30) return null;
    if (typeof item === 'string') return kind === 'long' ? (item || '长文本示例').repeat(Math.max(1, Math.ceil(240 / Math.max(1, item.length)))).slice(0, 480) : item;
    if (typeof item === 'number') return kind === 'extreme' ? (item < 0 ? -999999999 : 999999999) : item;
    if (typeof item === 'boolean') return kind === 'extreme' ? !item : item;
    if (Array.isArray(item)) return item.slice(0, 100).map(child => visit(child, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).slice(0, 100).map(([key, child]) => [key, visit(child, depth + 1)]));
    return item;
  }
  return visit(value) as Record<string, unknown>;
}
export { equal as equalJson };
