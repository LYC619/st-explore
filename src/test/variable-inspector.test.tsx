import { expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';
import { VariableInspector } from '@/components/VariableInspector';
import { previewSample, variableChanges, variableRows } from '@/lib/variable-inspector';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; });
it('compares missing/null, arrays, escaped keys and ignores object order', () => {
  expect(variableChanges({ a: 1, b: 2 }, { b: 2, a: 1 }).changes).toEqual([]);
  expect(variableChanges({ 'a/b': { '~': 1 }, array: [1, 2], remove: null }, { 'a/b': { '~': 2 }, array: [1], add: null }).changes).toEqual([
    { path: '/a~1b/~0', kind: 'changed', before: 1, after: 2 }, { path: '/array/1', kind: 'removed', before: 2, after: undefined },
    { path: '/remove', kind: 'removed', before: null, after: undefined }, { path: '/add', kind: 'added', before: undefined, after: null },
  ]);
});
it('bounds wide and deep trees and differences with an explicit truncation flag', () => {
  expect(variableRows(Array.from({ length: 5000 }, (_, i) => i)).truncated).toBe(true);
  const value = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [i, i]));
  const diff = variableChanges(value, { ...value, 4999: 0 }); expect(diff.truncated).toBe(true);
});
it('derives edge samples without changing the actual snapshot', () => {
  const value = { stat_data: { name: '角色', score: 5, on: true } };
  expect(previewSample(value, 'empty')).toEqual({});
  expect((previewSample(value, 'long').stat_data as { name: string }).name.length).toBeGreaterThan(100);
  expect(previewSample(value, 'extreme')).toEqual({ stat_data: { name: '角色', score: 999999999, on: false } });
  expect(value.stat_data.score).toBe(5);
});
it('expands a real tree, searches nested values and shows changed values in the component', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<VariableInspector value={{ stat_data: { place: '庭院', score: 2 } }} before={{ stat_data: { place: '书房', score: 1 } }} />));
    expect(container.textContent).toContain('庭院');
    const input = container.querySelector('input')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'score'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(container.textContent).toContain('/stat_data/score'); expect(container.textContent).not.toContain('庭院');
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('差异'))!.click());
    expect(container.textContent).toContain('前：1'); expect(container.textContent).toContain('后：2');
  } finally { await act(async () => root.unmount()); }
});
