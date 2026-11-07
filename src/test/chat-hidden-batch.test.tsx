import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { setManualHiddenRange } from '@/lib/chat-edit';
import { ChatWorkbench } from '@/components/chat/ChatWorkbench';
import { getDefaultExportSettings } from '@/lib/session-storage';
import type { ChatSession } from '@/types/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const session: ChatSession = { id: 'batch', title: '批量隐藏', character: { name: 'c' }, user: { name: 'u' }, createdAt: 1,
  messages: Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, role: index === 4 ? 'system' : 'assistant', hidden: true, content: `正文${index}`,
    rawData: { mes: `正文${index}`, is_system: true, extra: index === 2 ? { bbs_hidden: true } : index === 3 ? { type: 'comment' } : {} } })) };
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });

it('changes only the inclusive manual range and preserves plugin/system/OOC hiding and the source', () => {
  const next = setManualHiddenRange(session, 1, 4, false);
  expect(next.messages.map(message => message.hidden)).toEqual([true, false, true, true, true, true]);
  expect(next.messages[1].rawData?.is_system).toBe(false);
  expect(session.messages.every(message => message.hidden)).toBe(true);
  expect(() => setManualHiddenRange(session, -1, 99, false)).toThrow(/范围/);
});
it('handles a synthetic 496-floor branch with exact boundaries and no mainline mutation', () => {
  const main: ChatSession = { ...session, messages: Array.from({ length: 496 }, (_, index) => ({ id: `long-${index}`, role: 'assistant', content: `第${index}楼` })) };
  const branch = structuredClone(main);
  const next = setManualHiddenRange(branch, 20, 475, true);
  expect(next.messages[19].hidden).not.toBe(true); expect(next.messages[20].hidden).toBe(true);
  expect(next.messages[475].hidden).toBe(true); expect(next.messages[476].hidden).not.toBe(true);
  expect(next.messages.filter(message => message.hidden)).toHaveLength(456);
  expect(main.messages.some(message => message.hidden)).toBe(false);
  expect(branch.messages.some(message => message.hidden)).toBe(false);
});

it('clears all manual hiding in one workbench update', async () => {
  const changed = vi.fn();
  function Fixture() {
    const [value, setValue] = useState(session);
    return <ChatWorkbench session={value} markers={[]} favorites={[]} settings={getDefaultExportSettings()}
      onSessionChange={next => { changed(next); setValue(next); }} onFavoritesChange={() => {}} onSettingsChange={() => {}} />;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Fixture />));
  const menu = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('楼层处理'));
  await act(async () => menu!.click());
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === '取消全部手动隐藏');
  expect(button).toBeTruthy(); await act(async () => button!.click());
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed.mock.calls[0][0].messages.map((message: { hidden: boolean }) => message.hidden)).toEqual([false, false, true, true, true, false]);
});
