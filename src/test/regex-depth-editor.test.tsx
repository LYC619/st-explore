import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RegexRule } from '@/types/chat';
import { RegexSidebar } from '@/components/chat/RegexSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let host: HTMLDivElement; let root: Root;
const changed = vi.fn();
const rule: RegexRule = { id: 'r', name: '范围规则', findRegex: 'foo', replaceString: 'bar', disabled: false, placement: ['all'], _raw: { minDepth: 2, maxDepth: 4 } };
function Fixture() {
  const [rules, setRules] = useState([rule]);
  return <RegexSidebar rules={rules} onRulesChange={next => { changed(next); setRules(next); }} isOpen />;
}
beforeEach(async () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Fixture />)); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('sizes the sidebar inside its own scroll viewport and remeasures when it shrinks', async () => {
  host.style.overflowY = 'auto';
  let bottom = 600;
  const rectangle = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this === host ? 200 : 280;
    return { top, bottom: this === host ? bottom : 650, left: 0, right: 320, width: 320, height: this === host ? bottom - top : 370, x: 0, y: top, toJSON() {} };
  });
  try {
    await act(async () => root.render(<RegexSidebar rules={[rule]} onRulesChange={changed} isOpen stickyTop={60} />));
    const sidebar = host.querySelector('aside')!;
    expect(Number.parseFloat(sidebar.style.height)).toBe(312);
    bottom = 500;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(Number.parseFloat(sidebar.style.height)).toBe(212);
    const scroll = sidebar.querySelector('[data-regex-scroll]');
    expect(scroll?.textContent).toContain('导出正则');
  } finally { rectangle.mockRestore(); }
});
it('edits recent/excluded ranges and explicitly clears imported bounds', async () => {
  const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开编辑"]');
  expect(expand).toBeTruthy(); await act(async () => expand!.click());
  const select = host.querySelector<HTMLSelectElement>('[aria-label="楼层范围"]');
  expect(select).not.toBeNull();
  expect(select!.value).toBe('custom');
  await act(async () => { select!.value = 'recent'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
  const count = host.querySelector<HTMLInputElement>('[aria-label="最近楼层数"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(count, '3'); count.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(changed.mock.calls.at(-1)![0][0]).toMatchObject({ minDepth: null, maxDepth: 2 });
  await act(async () => { select!.value = 'older'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(changed.mock.calls.at(-1)![0][0]).toMatchObject({ minDepth: 3, maxDepth: null });
  await act(async () => { select!.value = 'all'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(changed.mock.calls.at(-1)![0][0]).toMatchObject({ minDepth: null, maxDepth: null });
});
