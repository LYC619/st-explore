import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageNavBar } from '@/components/chat/MessageNavBar';
import { MessageRow } from '@/components/chat/ChatMessageRow';
import { RegexSidebar } from '@/components/chat/RegexSidebar';
import { getThemeClasses } from '@/components/chat/chat-theme-classes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { buildStoryReadPath } from '@/lib/editor-story-context';
import {
  DEFAULT_PAPER_WIDTH,
  getDefaultExportSettings,
  loadCustomRegexRules,
  saveCustomRegexRules,
} from '@/lib/session-storage';
import type { RegexRule } from '@/types/chat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Batch 1 reading & regex guardrails', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    host?.remove();
    host = null;
    vi.unstubAllGlobals();
  });

  it('builds unified /story/:id read paths with optional branch and floor parameters', () => {
    expect(buildStoryReadPath('story-1')).toBe('/story/story-1');
    expect(buildStoryReadPath('story-1', { branchId: null, floor: 18 })).toBe('/story/story-1?branch=&floor=18');
    expect(buildStoryReadPath('story-1', { branchId: 'b-alt', floor: 5 })).toBe('/story/story-1?branch=b-alt&floor=5');
  });

  it('raises default paperWidth to 860 and does not wipe global custom regexes on passive RegexSidebar mount', async () => {
    expect(DEFAULT_PAPER_WIDTH).toBe(860);
    expect(getDefaultExportSettings().paperWidth).toBe(860);

    const globalRule: RegexRule = {
      id: 'custom-global-1',
      name: '清理状态栏',
      findRegex: '<status>[\\s\\S]*?</status>',
      replaceString: '',
      placement: ['assistant'],
      disabled: false,
    };
    saveCustomRegexRules([globalRule]);
    expect(loadCustomRegexRules()).toHaveLength(1);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    // 挂载一份旧故事的空规则集：绝不能把全局 localStorage 自定义正则反向清空！
    await act(async () => {
      root!.render(
        <RegexSidebar
          rules={[]}
          onRulesChange={vi.fn()}
          isOpen
        />,
      );
    });

    expect(loadCustomRegexRules().map((r) => r.id)).toEqual(['custom-global-1']);
  });

  it('renders per-floor star bookmark button and inline rawFloor number without branch/quote/share clutter', async () => {
    const onToggleFavorite = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(
        <TooltipProvider>
          <MessageRow
            message={{
              id: 'msg-12',
              role: 'assistant',
              name: '胡桃',
              content: '雪夜里的一盏热茶。',
              rawFloor: 12,
              depth: 0,
              paragraphs: ['雪夜里的一盏热茶。'],
              isNewSpeaker: true,
              ooc: false,
              swipeTotal: 1,
              swipeId: 0,
              swipeIsSteEdit: false,
            }}
            index={8}
            theme="novel"
            classes={getThemeClasses('novel')}
            showTimestamp={false}
            showAvatar={false}
            showModel={false}
            editMode={false}
            previewRule={null}
            searchQuery=""
            isActiveMatch={false}
            userName="旅人"
            charName="胡桃"
            isFavorited={false}
            onToggleFavorite={onToggleFavorite}
          />
        </TooltipProvider>,
      );
    });

    expect(host.querySelector('[data-floor-badge]')?.textContent).toBe('#12');
    expect(host.querySelector('[aria-label*="支线"]')).toBeNull();
    expect(host.querySelector('[aria-label*="分享图"]')).toBeNull();

    const starBtn = host.querySelector<HTMLButtonElement>('[aria-label="收藏第 12 楼"]');
    expect(starBtn).not.toBeNull();
    await act(async () => { starBtn!.click(); });
    expect(onToggleFavorite).toHaveBeenCalledWith('msg-12');
  });

  it('only commits floor jump on Enter and reverts on blur without accidental scroll', async () => {
    const onJumpToFloor = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(
        <MessageNavBar
          floorCount={20}
          maxFloor={19}
          currentFloor={3}
          currentMessageId="m3"
          favorites={[]}
          onJumpToFloor={onJumpToFloor}
          onPrev={vi.fn()}
          onNext={vi.fn()}
          onToggleFavorite={vi.fn()}
          onJumpToMessageId={vi.fn()}
        />,
      );
    });

    const input = host.querySelector<HTMLInputElement>('[aria-label="跳转到楼层"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

    await act(async () => {
      input.focus();
      setValue.call(input, '15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('15');

    // 失焦取消：不触发跳转，恢复原楼层 3
    await act(async () => {
      input.blur();
    });
    expect(onJumpToFloor).not.toHaveBeenCalled();
    expect(input.value).toBe('3');

    // 按 Enter 才真正触发跳转
    await act(async () => {
      input.focus();
      setValue.call(input, '15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onJumpToFloor).toHaveBeenCalledWith(15);
  });
});
