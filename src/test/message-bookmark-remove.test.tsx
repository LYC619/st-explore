import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageNavBar, type FavoriteItem } from '@/components/chat/MessageNavBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let host: HTMLDivElement;
let root: Root;
const jump = vi.fn();
const toggle = vi.fn();
const items: FavoriteItem[] = [{ messageId: 'a', floor: 3, snippet: '第三楼' }, { messageId: 'gone', floor: null, snippet: '已删除的楼层' }];
function Fixture() {
  const [favorites, setFavorites] = useState(items);
  return <MessageNavBar floorCount={10} currentFloor={0} currentMessageId="current" favorites={favorites} onJumpToFloor={jump} onPrev={jump} onNext={jump} onJumpToMessageId={jump} onToggleFavorite={id => { toggle(id); setFavorites(current => current.filter(item => item.messageId !== id)); }} />;
}
beforeEach(async () => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<Fixture />)); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('removes any bookmark directly without navigating, including a missing message', async () => {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  await act(async () => trigger.click());
  const remove = document.querySelector<HTMLButtonElement>('[aria-label="删除第 3 楼书签"]');
  expect(remove).not.toBeNull();
  await act(async () => remove!.click());
  expect(toggle).toHaveBeenCalledWith('a');
  expect(jump).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="删除第 3 楼书签"]')).toBeNull();
  const orphan = document.querySelector<HTMLButtonElement>('[aria-label="删除失效书签"]')!;
  await act(async () => orphan.click());
  expect(toggle).toHaveBeenLastCalledWith('gone');
  expect(document.body).toHaveTextContent('还没有收藏的楼层');
});
