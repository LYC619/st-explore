import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatPreview } from '@/components/chat/ChatPreview';
import { ExportButton } from '@/components/chat/ExportButton';
import { getDefaultExportSettings } from '@/lib/session-storage';
import type { ChatSession, RegexRule } from '@/types/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rule: RegexRule = { id: 'recent', name: '最近两楼', findRegex: '/foo/g', replaceString: 'bar', placement: ['all'], disabled: false, maxDepth: 1 };
const session: ChatSession = { id: 'depth', title: '范围测试', character: { name: 'c' }, user: { name: 'u' }, createdAt: 1, messages: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', content: `foo${i}`, rawData: { mes: `foo${i}` } })) };
let host: HTMLDivElement; let root: Root; let blobs: Blob[];
class Observer {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) { const box = target.getBoundingClientRect(); this.callback([{ target, contentRect: box, borderBoxSize: [{ inlineSize: box.width, blockSize: box.height }] } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver); }
  unobserve() {} disconnect() {}
}
beforeEach(() => {
  blobs = []; host = document.createElement('div'); host.style.overflowY = 'auto'; document.body.append(host); root = createRoot(host);
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = Number((this as HTMLElement).dataset.index ?? 0) * 90;
    const height = this === host ? 600 : 90;
    return { top, left: 0, right: 700, bottom: top + height, width: 700, height, x: 0, y: top, toJSON() {} };
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:test'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function click(label: string) { const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function readBlob(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); }); }

it('processes preview floors relative to the full conversation before hiding messages', async () => {
  const onMap = vi.fn();
  const input = { ...session, messages: session.messages.map((message, index) => ({ ...message, hidden: index === 3 })) };
  await act(async () => root.render(<ChatPreview session={input} theme="minimal" showTimestamp={false} showAvatar={false} fontSize={16} showHidden={false} regexRules={[{ ...rule, findRegex: '/foo[0-9]/g', replaceString: '' }]} onFloorMapChange={onMap} />));
  expect([...onMap.mock.calls.at(-1)![0].keys()]).toEqual(['m0', 'm1', 'm2']);
});
it('only highlights eligible recent floors in inline preview', async () => {
  await act(async () => root.render(<ChatPreview session={session} theme="minimal" showTimestamp={false} showAvatar={false} fontSize={16} regexRules={[rule]} previewRule={rule} />));
  const highlighted = [...host.querySelectorAll('.line-through')];
  expect(highlighted).toHaveLength(2);
  expect(highlighted.map(node => node.closest('[data-index]')?.getAttribute('data-index'))).toEqual(['3', '4']);
});
it.each(['TXT', 'Markdown', 'JSONL'])('exports %s using full conversation depths even for a selected middle range', async format => {
  const settings = { ...getDefaultExportSettings(), regexRules: [rule], prefixMode: 'none' as const, exportRange: 'custom' as const, customStart: 1, customEnd: 3 };
  await act(async () => root.render(<ExportButton session={session} settings={settings} onSettingsChange={vi.fn()} />));
  await click('导出'); await click(format);
  await vi.waitFor(() => expect(blobs).toHaveLength(1));
  const text = await readBlob(blobs[0]);
  if (format === 'JSONL') expect(text.split('\n').slice(1).map(line => JSON.parse(line).mes)).toEqual(['foo1', 'foo2', 'bar3']);
  else expect(text).toContain('foo1\n\nfoo2\n\nbar3');
  expect(text).not.toContain('bar1'); expect(text).not.toContain('bar2');
});
