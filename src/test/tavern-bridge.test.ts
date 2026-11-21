import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHelperToHost, isHostToHelper, type HelperSnapshot } from '@/tavern/protocol';
import { installStatusPolling } from '@/tavern/status-polling';
import { installDraftRecovery } from '@/tavern/draft-recovery';
import { installHelperHost } from '@/tavern/helper-host';
import type { DraftState, PollPage } from '@/tavern/bridge-types';
import type { STRawMessage } from '@/types/chat';

const popupShow = vi.fn(async () => true);
let lastPopupContent: HTMLElement | undefined;

vi.mock('@/tavern/upstream.js', async () => {
  const actual = await vi.importActual<typeof import('@/tavern/upstream')>('@/tavern/upstream');
  return {
    ...actual,
    loadUpstream: vi.fn(async (path: string) => {
      if (path === '/scripts/popup.js') {
        return {
          POPUP_TYPE: { TEXT: 1, CONFIRM: 2 },
          Popup: class {
            constructor(content: HTMLElement) { lastPopupContent = content; }
            show() { return popupShow(); }
          },
        };
      }
      if (path === '/scripts/extensions.js') return { extension_settings: { variables: { global: {} } } };
      if (path === '/scripts/slash-commands.js') return { executeSlashCommandsWithOptions: vi.fn() };
      throw new Error(`Unexpected upstream load: ${path}`);
    }),
  };
});

const emptySnapshot: HelperSnapshot = {
  messages: [],
  sources: [],
  variables: {},
  globalVariables: {},
  scriptData: {},
  user: '旅人',
  character: '林',
};

describe('tavern bridge protocol message boundaries', () => {
  it('validates all legal HelperToHost discriminated-union envelopes and rejects malformed payloads', () => {
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'ready' })).toBe(true);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'height', height: 240 })).toBe(true);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'error', message: 'boom' })).toBe(true);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'event-done', id: 1 })).toBe(true);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'event-done', id: 2, error: 'failed' })).toBe(true);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 1, method: 'replaceVariables',
      args: { option: { type: 'message', message_id: 0 }, expected: '{}', value: { count: 1 }, source: 's0' },
    })).toBe(true);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 2, method: 'setChatMessages',
      args: { messages: [], sources: ['s0'], baselines: [{ data: {}, extra: {} }], options: { refresh: 'affected' } },
    })).toBe(true);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 3, method: 'substitute',
      args: { text: '{{char}}' },
    })).toBe(true);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 4, method: 'triggerSlash',
      args: { command: '/getvar count' },
    })).toBe(true);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 5, method: 'generateRaw',
      args: { user_input: '继续', should_stream: false, ordered_prompts: [{ role: 'system', content: '规则' }] },
    })).toBe(true);

    // Malformed envelopes across every discriminant branch
    expect(isHelperToHost(null)).toBe(false);
    expect(isHelperToHost({ steHelper: '', kind: 'ready' })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'height', height: Number.NaN })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'height', height: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'error', message: 123 })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'event-done', id: 0 })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'request', id: 1, method: 'unknown', args: {} })).toBe(false);
    expect(isHelperToHost({ steHelper: 'tok-1', kind: 'request', id: 1.5, method: 'substitute', args: { text: 'a' } })).toBe(false);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 1, method: 'replaceVariables',
      args: { option: { type: 'message' }, expected: '{}', value: {} },
    })).toBe(false);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 1, method: 'replaceVariables',
      args: { option: { type: 'chat' }, expected: '{}', value: [] },
    })).toBe(false);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 1, method: 'setChatMessages',
      args: { messages: [], sources: ['s0'], baselines: [{ data: null, extra: {} }] },
    })).toBe(false);
    expect(isHelperToHost({
      steHelper: 'tok-1', kind: 'request', id: 1, method: 'generateRaw',
      args: { ordered_prompts: [{ role: 'user', content: 42 }] },
    })).toBe(false);
  });

  it('validates HostToHelper envelopes and rejects corrupted snapshots or ids', () => {
    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'snapshot', snapshot: emptySnapshot })).toBe(true);
    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'reply', id: 1, result: 'ok', snapshot: emptySnapshot })).toBe(true);
    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'event', id: 2, name: 'CHAT_CHANGED', args: [], snapshot: emptySnapshot })).toBe(true);

    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'reply', id: 0, snapshot: emptySnapshot })).toBe(false);
    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'event', id: 1, name: 123, args: [], snapshot: emptySnapshot })).toBe(false);
    expect(isHostToHelper({ steHelper: 'tok-1', kind: 'snapshot', snapshot: { ...emptySnapshot, variables: null } })).toBe(false);
    expect(isHostToHelper({ steHelper: '', kind: 'snapshot', snapshot: emptySnapshot })).toBe(false);
  });

  it('drops messages from wrong sources, unknown tokens, malformed envelopes, or non-monotonic request ids', async () => {
    document.body.innerHTML = '<div id="sheld"><div id="chat"></div><div id="form_sheld"></div></div>';
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('toastr', { error: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
    const saveChatConditional = vi.fn(async () => {});
    const substituteParams = vi.fn((text: string) => `expanded:${text}`);
    const host = {
      isGenerating: () => false,
      request: vi.fn(async (path: string) => {
        if (path === '/ste/helpers') {
          return Response.json({
            chatKey: 'story:main',
            revision: '1',
            settings: {
              schema: 1,
              scripts: [{
                type: 'script', id: 's1', name: 'Probe', content: '', enabled: true,
                grants: ['read'], info: '', data: {}, button: { enabled: false, buttons: [] },
              }],
              html: { enabled: false, grants: [] },
            },
          });
        }
        throw new Error(`Unexpected path: ${path}`);
      }),
    };
    const st = {
      chat: [] as STRawMessage[],
      chat_metadata: {},
      name1: '旅人',
      name2: '林',
      getCurrentChatId: () => 'main',
      event_types: { CHAT_CHANGED: 'chat-changed' },
      eventSource: { events: {}, makeFirst: vi.fn(), on: vi.fn(), emit: vi.fn(async () => {}) },
      saveChatConditional,
      cancelPendingSettingsSave: vi.fn(),
      saveSettings: vi.fn(async () => true),
      reloadCurrentChat: vi.fn(async () => {}),
      updateMessageBlock: vi.fn(),
      substituteParams,
      generateQuietPrompt: vi.fn(async () => ''),
      generateRaw: vi.fn(async () => ''),
      stopGeneration: vi.fn(),
    };
    const helper = await installHelperHost(host, st);
    const record = helper.records[0];
    const postSpy = vi.spyOn(record.frame.contentWindow!, 'postMessage').mockImplementation(() => {});

    // Wrong source window
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { steHelper: record.token, kind: 'request', id: 1, method: 'substitute', args: { text: 'forged' } },
    }));
    // Wrong token
    window.dispatchEvent(new MessageEvent('message', {
      source: record.frame.contentWindow!,
      data: { steHelper: 'wrong-token', kind: 'request', id: 1, method: 'substitute', args: { text: 'wrong' } },
    }));
    // Malformed args for substitute
    window.dispatchEvent(new MessageEvent('message', {
      source: record.frame.contentWindow!,
      data: { steHelper: record.token, kind: 'request', id: 1, method: 'substitute', args: { text: 123 } },
    }));
    await helper.flush();
    expect(substituteParams).not.toHaveBeenCalled();

    // Valid request id=2 succeeds, then duplicate/older id=2 and id=1 are ignored
    window.dispatchEvent(new MessageEvent('message', {
      source: record.frame.contentWindow!,
      data: { steHelper: record.token, kind: 'request', id: 2, method: 'substitute', args: { text: 'ok' } },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: record.frame.contentWindow!,
      data: { steHelper: record.token, kind: 'request', id: 2, method: 'substitute', args: { text: 'dup' } },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      source: record.frame.contentWindow!,
      data: { steHelper: record.token, kind: 'request', id: 1, method: 'substitute', args: { text: 'old' } },
    }));
    await helper.flush();
    expect(substituteParams).toHaveBeenCalledTimes(1);
    expect(substituteParams).toHaveBeenCalledWith('ok');
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ steHelper: record.token, kind: 'reply', id: 2, result: 'expanded:ok' }), '*');

    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    document.head.replaceChildren();
    vi.unstubAllGlobals();
  });
});

describe('tavern status polling', () => {
  function createPollFixture(poll: () => Promise<unknown>) {
    const timers = new Map<number, () => void>();
    const activityListeners = new Set<() => void>();
    const docListeners = new Map<string, EventListener>();
    const pageListeners = new Map<string, EventListener>();
    let foreground = true;
    let generating = false;
    let visibilityState: DocumentVisibilityState = 'visible';
    let nextId = 0;

    const page: PollPage = {
      document: {
        get visibilityState() { return visibilityState; },
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
          docListeners.set(type, listener as EventListener);
        },
        removeEventListener(type: string) { docListeners.delete(type); },
      },
      setTimeout(callback: () => void) {
        const id = ++nextId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id: number) { timers.delete(id); },
      addEventListener: ((type: string, listener: EventListenerOrEventListenerObject) => {
        pageListeners.set(type, listener as EventListener);
      }) as Window['addEventListener'],
      removeEventListener: ((type: string) => {
        pageListeners.delete(type);
      }) as Window['removeEventListener'],
    };

    const host = {
      isForeground: () => foreground,
      isGenerating: () => generating,
      subscribeActivity: (listener: () => void) => {
        activityListeners.add(listener);
        return () => { activityListeners.delete(listener); };
      },
    };

    const close = installStatusPolling(host, poll, page, 1500);
    return {
      timers,
      activityListeners,
      close,
      setActivity(nextForeground: boolean, nextGenerating: boolean) {
        foreground = nextForeground;
        generating = nextGenerating;
        for (const listener of activityListeners) listener();
      },
      setHidden(hidden: boolean) {
        visibilityState = hidden ? 'hidden' : 'visible';
        docListeners.get('visibilitychange')?.(new Event('visibilitychange'));
      },
      firePagehide() { pageListeners.get('pagehide')?.(new Event('pagehide')); },
      runTimers() {
        const queued = [...timers.values()];
        timers.clear();
        for (const fn of queued) fn();
      },
    };
  }

  const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  it('pauses when backgrounded or hidden, resumes on foreground or generation, and cleans up on pagehide', async () => {
    let calls = 0;
    const f = createPollFixture(async () => { calls++; });
    await flushMicrotasks();
    expect(calls).toBe(1);
    expect(f.timers.size).toBe(1);

    f.setActivity(false, false);
    expect(f.timers.size).toBe(0);
    f.runTimers();
    await flushMicrotasks();
    expect(calls).toBe(1);

    f.setActivity(false, true);
    await flushMicrotasks();
    expect(calls).toBe(2);
    expect(f.timers.size).toBe(1);

    f.setHidden(true);
    // Still generating in background, so polling stays active even while hidden.
    await flushMicrotasks();
    expect(calls).toBe(3);

    f.setActivity(true, false);
    // Foreground but hidden -> pauses.
    expect(f.timers.size).toBe(0);

    f.setHidden(false);
    await flushMicrotasks();
    expect(calls).toBe(4);

    f.firePagehide();
    expect(f.timers.size).toBe(0);
    expect(f.activityListeners.size).toBe(0);
  });

  it('coalesces overlapping triggers into a single follow-up poll and survives poll errors', async () => {
    let release!: () => void;
    let calls = 0;
    const f = createPollFixture(() => {
      calls++;
      return new Promise<void>(resolve => { release = resolve; });
    });
    expect(calls).toBe(1);
    f.setActivity(false, false);
    f.setActivity(true, false);
    f.setActivity(false, true);
    expect(calls).toBe(1);

    release();
    await flushMicrotasks();
    expect(calls).toBe(2);

    f.close();
    release();
    await flushMicrotasks();
    expect(f.timers.size).toBe(0);
    expect(calls).toBe(2);

    let failedCalls = 0;
    const resilient = createPollFixture(async () => {
      failedCalls++;
      throw new Error('synthetic poll failure');
    });
    await flushMicrotasks();
    expect(failedCalls).toBe(1);
    expect(resilient.timers.size).toBe(1);
    resilient.runTimers();
    await flushMicrotasks();
    expect(failedCalls).toBe(2);
    resilient.close();
  });
});

describe('tavern draft recovery', () => {
  beforeEach(() => {
    popupShow.mockClear();
    lastPopupContent = undefined;
    document.body.innerHTML = '<div id="form_sheld"><textarea id="send_textarea"></textarea></div><div id="chat"></div>';
    vi.stubGlobal('toastr', { error: vi.fn() });
    window.__STE_STAMP_CHAT__ = vi.fn();
  });

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    document.head.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function createDraftHarness(handler: (path: string, body?: unknown) => Response | Promise<Response>) {
    const st: DraftState = {
      chat: [{ name: '林', mes: '初始正文', is_user: false }],
      chat_metadata: {},
      name1: '旅人',
      name2: '林',
      getCurrentChatId: () => 'main',
      printMessages: vi.fn(async () => {}),
      saveChatConditional: vi.fn(async () => {}),
    };
    let generating = false;
    const request = vi.fn(async (path: string, body?: unknown) => handler(path, body));
    const controller = installDraftRecovery(st, { request, isGenerating: () => generating });
    return { st, request, controller, setGenerating: (next: boolean) => { generating = next; } };
  }

  it('restores exported ste_recovery input once on clean load and captures debounced editor changes', async () => {
    vi.useFakeTimers();
    const captured: unknown[] = [];
    const { st, controller } = createDraftHarness((path, body) => {
      if (path === '/ste/draft') return Response.json(null);
      if (path === '/ste/draft/capture') { captured.push(body); return Response.json({}); }
      throw new Error(`Unexpected path: ${path}`);
    });
    st.chat_metadata.ste_recovery = { version: 1, input: '未发出的草稿' };

    await controller.select('story:main');
    const textarea = document.querySelector<HTMLTextAreaElement>('#send_textarea')!;
    expect(textarea.value).toBe('未发出的草稿');
    expect(st.chat_metadata.ste_recovery).toBeUndefined();
    expect(window.__STE_DRAFT_READY__()).toBe(true);

    // Selecting triggers input event -> debounced capture after 400ms
    const chat = document.querySelector('#chat')!;
    chat.innerHTML = '<div class="mes" mesid="0"><textarea class="edit_textarea">正在编辑的楼层</textarea></div>';
    const editor = chat.querySelector<HTMLTextAreaElement>('.edit_textarea')!;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(450);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      chatKey: 'story:main',
      input: '未发出的草稿',
      editor: { index: 0, text: '正在编辑的楼层' },
    });
  });

  it('shows pending banner for changed drafts, supports inspect and restore, and unlocks readiness', async () => {
    const { st, request, controller } = createDraftHarness(path => {
      if (path === '/ste/draft') {
        return Response.json({
          changed: true,
          conflict: false,
          draft: { version: 1, input: '待发内容', changes: [{ role: 'assistant', content: '中断的回复' }] },
        });
      }
      if (path === '/ste/draft/restore') {
        return Response.json({
          changed: true,
          conflict: false,
          draft: { version: 1, input: '待发内容', changes: [] },
          chat: [{ chat_metadata: {} }, { name: '林', mes: '恢复后的回复', is_user: false }],
          input: '待发内容',
        });
      }
      if (path === '/ste/draft/capture') return Response.json({});
      throw new Error(`Unexpected path: ${path}`);
    });

    await controller.select('story:pending');
    const banner = document.querySelector<HTMLElement>('#ste_draft_recovery')!;
    const buttons = [...banner.querySelectorAll('button')];
    const [restoreBtn, inspectBtn] = buttons;

    expect(banner.hidden).toBe(false);
    expect(restoreBtn.disabled).toBe(false);
    expect(window.__STE_DRAFT_READY__()).toBe(false);

    inspectBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(popupShow).toHaveBeenCalledOnce();
    expect((lastPopupContent as HTMLTextAreaElement).value).toContain('assistant: 中断的回复');
    expect((lastPopupContent as HTMLTextAreaElement).value).toContain('待发内容');

    restoreBtn.click();
    await vi.waitFor(() => expect(banner.hidden).toBe(true));
    expect(st.chat).toEqual([{ name: '林', mes: '恢复后的回复', is_user: false }]);
    expect(st.printMessages).toHaveBeenCalledOnce();
    expect(st.saveChatConditional).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLTextAreaElement>('#send_textarea')!.value).toBe('待发内容');
    expect(window.__STE_DRAFT_READY__()).toBe(true);
    expect(request).toHaveBeenCalledWith('/ste/draft/capture', expect.objectContaining({ chatKey: 'story:pending' }));
  });

  it('disables restore on conflict drafts while allowing discard, and reports select errors', async () => {
    const { controller } = createDraftHarness(path => {
      if (path === '/ste/draft') {
        return Response.json({
          changed: true,
          conflict: true,
          draft: { version: 1, input: '冲突草稿', changes: [] },
        });
      }
      if (path === '/ste/draft/discard') return Response.json({});
      throw new Error(`Unexpected path: ${path}`);
    });

    await controller.select('story:conflict');
    const banner = document.querySelector<HTMLElement>('#ste_draft_recovery')!;
    const [restoreBtn, , discardBtn] = [...banner.querySelectorAll('button')];
    expect(banner.hidden).toBe(false);
    expect(restoreBtn.disabled).toBe(true);
    expect(window.__STE_DRAFT_READY__()).toBe(false);

    discardBtn.click();
    await vi.waitFor(() => expect(banner.hidden).toBe(true));
    expect(window.__STE_DRAFT_READY__()).toBe(true);

    const errored = createDraftHarness(() => Response.json({ error: { message: '草稿文件损坏' } }, { status: 500 }));
    await errored.controller.select('story:error');
    const errorBanners = document.querySelectorAll<HTMLElement>('#ste_draft_recovery');
    const latestBanner = errorBanners[0];
    expect(latestBanner.hidden).toBe(false);
    expect(latestBanner.textContent).toContain('草稿文件损坏');
    expect(latestBanner.querySelector('button')!.disabled).toBe(true);
    expect(window.__STE_DRAFT_READY__()).toBe(false);
  });
});
