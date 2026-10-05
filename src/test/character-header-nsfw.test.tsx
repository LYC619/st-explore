/**
 * 角色页 NSFW 标记的说明可达性（阶段 B3）。
 *
 * 原先 embedded-reader.test.ts 里 grep CharacterHeader.tsx 有没有引入 tooltip、
 * 有没有「<TooltipContent」。要保的是：问号是个能聚焦的控件，聚焦后给出完整说明，
 * 而不是只挂一个原生 title（键盘用户与读屏都拿不到）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveCharacter } from '@/types/archive';
import { normalizeCharacterCard, type STCharacterCard } from '@/lib/png-parser';
vi.mock('@/lib/archive-index', () => ({ listCharacterIndex: vi.fn(async () => [{ tags: ['技术/别人创建的标签'] }]) }));
vi.mock('@/lib/archive-db', () => ({ getLibraryTagPreferences: vi.fn(async () => ({ version: 1, customTags: [], customCategories: [], categoryOrder: [], order: [], hidden: [] })) }));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/library-tag-preferences', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/library-tag-preferences')>()),
  getLibraryTagPreferences: vi.fn(async () => ({ hidden: [], categories: {} })),
}));

import { CharacterHeader } from '@/components/character/CharacterHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const card: STCharacterCard = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: { name: '测试角色', description: '一段描述', first_mes: '开场白' },
};

const character = {
  id: 'c1',
  name: '测试角色',
  tags: [],
  nsfw: false,
  card,
  createdAt: 1,
  updatedAt: 1,
} as unknown as ArchiveCharacter;

const norm = normalizeCharacterCard(card);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('NSFW 标记的说明', () => {
  it('offers tags created on other characters in the quick-add menu', async () => {
    await act(async () => { root.render(<CharacterHeader character={character} norm={norm} onPatch={vi.fn(async () => character)} />); });
    const trigger = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('标签'))!;
    await act(async () => trigger.click());
    expect(document.body.textContent).toContain('别人创建的标签');
  });
  it('问号是可聚焦控件，聚焦后给出完整说明，不只靠原生 title', async () => {
    await act(async () => {
      root.render(<CharacterHeader character={character} norm={norm} onPatch={vi.fn(async () => character)} />);
    });
    await act(async () => { await Promise.resolve(); });

    const help = container.querySelector<HTMLElement>('[aria-label="NSFW 标记说明"]');
    expect(help).not.toBeNull();
    expect(help!.tagName).toBe('BUTTON');
    expect(document.body.textContent).not.toContain('标记卡面尺度');

    await act(async () => { help!.focus(); });

    // Tooltip 内容进 portal，挂在 body 上
    expect(document.body.textContent).toContain('标记卡面尺度');
  });
});
