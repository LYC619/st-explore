import { act, createRef, forwardRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArchiveStory } from '@/types/archive';
import { setActiveVault } from '@/lib/vault/active';

const api = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn(), floor: undefined as undefined | ((n: number) => void), toast: vi.fn(), initialFloors: [] as (number | undefined)[] }));
vi.mock('@/lib/archive-db', async importActual => ({ ...await importActual<typeof import('@/lib/archive-db')>(), getArchiveStory: api.read, updateArchiveStory: api.update }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: api.toast }) }));
vi.mock('@/components/chat/ChatWorkbench', () => ({ ChatWorkbench: forwardRef(function Chat({ onFloorChange, initialFloor, toolbarExtras }: { onFloorChange: (n: number) => void; initialFloor?: number; toolbarExtras?: React.ReactNode }, _ref) { useState(() => { api.initialFloors.push(initialFloor); return initialFloor; }); api.floor = onFloorChange; return <><p>阅读器正文</p>{toolbarExtras}</>; }) }));
vi.mock('@/components/reader/NovelView', () => ({ default: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>关闭小说</button> }));
import { InlineStoryReader, type InlineStoryReaderHandle } from '@/components/character/InlineStoryReader';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
let host: HTMLDivElement; let root: Root;
const story = { id: 'reader-s', title: '故事', session: { messages: [], character: { name: 'a' }, user: { name: 'u' } }, markers: [], meta: { modelsUsed: [], playTimeMs: null }, createdAt: 1, updatedAt: 1 } as unknown as ArchiveStory;
const ref = createRef<InlineStoryReaderHandle>();
async function render(restoreFloor = true, onOpenChat?: (id: string, branchId: string | null) => void, initialBranchId?: string) { await act(async () => root.render(<InlineStoryReader ref={ref} storyId={story.id} stories={[story]} onBack={() => {}} onSwitchStory={() => {}} onOpenEditor={() => {}} onOpenChat={onOpenChat} initialBranchId={initialBranchId} restoreFloor={restoreFloor} />)); }
beforeEach(() => { vi.clearAllMocks(); api.initialFloors = []; api.read.mockResolvedValue(story); api.update.mockImplementation(async (_id, updater) => ({ ...story, ...await updater(story) })); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('exposes pending progress save and rejects rather than approving a failed transition', async () => {
  await render(); await act(async () => api.floor!(7)); api.update.mockRejectedValueOnce(new Error('只读目录'));
  await expect(ref.current!.flushPendingSave()).rejects.toThrow('只读目录');
  await ref.current!.flushPendingSave(); expect(api.update).toHaveBeenLastCalledWith(story.id, expect.any(Function));
  expect(await api.update.mock.calls.at(-1)![1](story)).toMatchObject({ lastFloor: 7 });
});
it('distinguishes a failed body read from a missing story and permits retry', async () => {
  api.read.mockRejectedValueOnce(new Error('读取失败')); await render();
  expect(host).toHaveTextContent('读取故事失败'); expect(host).not.toHaveTextContent('找不到该故事');
  const retry = [...host.querySelectorAll('button')].find(button => button.textContent === '重试读取故事');
  expect(retry).toBeTruthy(); await act(async () => retry!.click()); expect(host).toHaveTextContent('阅读器正文');
});
it('does not flush old progress into a newly active vault', async () => {
  await render(); await act(async () => api.floor!(5)); api.update.mockClear(); setActiveVault(null);
  await expect(ref.current!.flushPendingSave()).rejects.toThrow('文件库已切换'); expect(api.update).not.toHaveBeenCalled();
});
it('suppresses floor restoration only for the initial pixel-restored mount', async () => {
  const saved = { ...story, lastFloor: 7 };
  api.read.mockResolvedValue(saved); api.update.mockImplementation(async (_id, updater) => ({ ...saved, ...await updater(saved) }));
  await render(false); expect(api.initialFloors).toEqual([undefined]);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === '小说视图')!.click());
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '关闭小说')!.click());
  expect(api.initialFloors).toEqual([undefined, 7]);
});

it.each([null, 'alt'])('continues the current %s line only after pending reading changes save successfully', async branchId => {
  const saved = { ...story, branches: [{ id: 'alt', name: '另一条路', session: story.session, markers: [], createdAt: 1, updatedAt: 1 }] } as ArchiveStory;
  api.read.mockResolvedValue(saved);
  api.update.mockImplementation(async (_id, updater) => ({ ...saved, ...await updater(saved) }));
  const openChat = vi.fn();
  await render(true, openChat, branchId ?? undefined);
  await act(async () => api.floor!(5));
  const continueButton = host.querySelector<HTMLButtonElement>('[aria-label="继续聊天"]');
  expect(continueButton).not.toBeNull();
  api.update.mockRejectedValueOnce(new Error('只读目录'));
  await act(async () => continueButton!.click());
  expect(openChat).not.toHaveBeenCalled();
  expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '故事尚未保存，已取消离开' }));

  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  api.update.mockImplementationOnce(async (_id, updater) => { await gate; return { ...saved, ...await updater(saved) }; });
  await act(async () => continueButton!.click());
  expect(openChat).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(openChat).toHaveBeenCalledExactlyOnceWith(story.id, branchId);
});
