import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelperHostController } from '../tavern/helper-host';
import { installHelperHost } from '../tavern/helper-host';

const mockUpstreamState = {
  extension_settings: { variables: { global: {} as Record<string, unknown> } },
  executeSlashCommandsWithOptions: vi.fn(),
};

vi.mock('../tavern/upstream.js', async () => {
  const actual = await vi.importActual<typeof import('../tavern/upstream')>('../tavern/upstream');
  return {
    ...actual,
    loadUpstream: vi.fn(async (name: string) => {
      if (name === '/scripts/extensions.js') return { extension_settings: mockUpstreamState.extension_settings };
      if (name === '/scripts/slash-commands.js') return { executeSlashCommandsWithOptions: mockUpstreamState.executeSlashCommandsWithOptions };
      throw new Error(`Unexpected upstream import: ${name}`);
    }),
  };
});

type Variables = { count: number };
type VariableScope = { type: 'chat' | 'script' | 'message'; message_id?: number };
type ClientApi = {
  getVariables(option?: VariableScope): Variables;
  replaceVariables(value: Variables, option?: VariableScope): void;
  updateVariablesWith(updater: (value: Variables) => Promise<Variables>, option?: VariableScope): Promise<Variables>;
  flushHelperWrites(): Promise<void>;
  eventOn(name: string, listener: () => Promise<void>): void;
  generate(options: { user_input: string }): Promise<string>;
  generateRaw(options: { user_input: string }): Promise<string>;
};
type Settings = HelperHostController['settings'];

beforeEach(() => {
  mockUpstreamState.extension_settings = { variables: { global: {} } };
  mockUpstreamState.executeSlashCommandsWithOptions.mockReset();
  document.body.innerHTML = '<div id="sheld"><div id="chat"></div><div id="form_sheld"></div></div>';
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('toastr', { error: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('')));
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function bridge(generate = async () => 'response', scriptPatch: Partial<Settings['scripts'][number]> = {}) {
  let persisted: { chatKey: string; revision: string; settings: Settings } = {
    chatKey: 'story:main', revision: '1',
    settings: {
      schema: 1,
      scripts: [{
        type: 'script', id: 'counter', name: 'Counter', content: '', enabled: true,
        grants: ['read', 'write', 'generate'], info: '', data: { count: 0 },
        button: { enabled: false, buttons: [] }, ...scriptPatch,
      }],
      html: { enabled: false, grants: [] },
    },
  };
  let failSave = false;
  const host = {
    isGenerating: () => false,
    request: vi.fn(async (path: string, body?: unknown) => {
      if (path === '/ste/helpers') return Response.json(structuredClone(persisted));
      const payload = body as { settings: Settings } | undefined;
      if (path !== '/ste/helpers/save' || !payload) throw new Error(`Unexpected host request: ${path}`);
      if (failSave) {
        failSave = false;
        return Response.json({ error: { message: 'simulated disk failure' } }, { status: 500 });
      }
      persisted = { ...persisted, revision: String(Number(persisted.revision) + 1), settings: structuredClone(payload.settings) };
      return Response.json(structuredClone(persisted));
    }),
  };
  const events: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const listen = <T extends unknown[] = unknown[]>(name: string, listener: (...args: T) => unknown) => { (events[name] ??= []).push(listener as (...args: unknown[]) => unknown); };
  const st = {
    chat: [{ name: 'Character', mes: 'original', is_user: false, swipe_id: 0, variables: [{ count: 0 }],
      extra: { ste_runtime: { messageId: 'm1', candidateId: 'c1' } } }],
    chat_metadata: { variables: { count: 0 } } as Record<string, unknown>,
    name1: 'User', name2: 'Character',
    getCurrentChatId: () => 'main',
    event_types: { CHAT_CHANGED: 'chat-changed' },
    eventSource: { events, makeFirst: listen, on: listen, emit: vi.fn(async () => {}) },
    saveChatConditional: vi.fn(async () => {}),
    cancelPendingSettingsSave: vi.fn(),
    saveSettings: vi.fn(async () => true),
    reloadCurrentChat: vi.fn(async () => {}),
    updateMessageBlock: vi.fn(),
    substituteParams: vi.fn((text: string) => text),
    generateQuietPrompt: vi.fn(generate),
    generateRaw: vi.fn(generate),
    stopGeneration: vi.fn(),
  };
  const helper = await installHelperHost(host, st);
  const frame = helper.records[0].frame, frameWindow = frame.contentWindow!;
  type ClientMessage = { source: unknown; data: unknown };
  const listeners = new Map<string, ((event: ClientMessage) => unknown)[]>();
  const parent = {
    postMessage(data: unknown) {
      const message = structuredClone(data);
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: message, source: frameWindow })));
    },
  };
  vi.spyOn(frameWindow, 'postMessage').mockImplementation(data => {
    const message = structuredClone(data);
    queueMicrotask(() => {
      for (const listener of listeners.get('message') ?? []) void listener({ source: parent, data: message });
    });
  });
  const realm = createContext({
    parent, structuredClone, setTimeout, clearTimeout,
    document: { documentElement: { scrollHeight: 0 } },
    ResizeObserver: class { observe() {} },
    addEventListener(name: string, listener: (event: ClientMessage) => unknown) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name)!.push(listener);
    },
  });
  // Use the exact client bootstrap and initial snapshot produced by makeFrame.
  const frameDocument = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
  runInContext(frameDocument.head.querySelector('script')!.textContent!, realm);
  await Promise.resolve(); // Deliver the client's ready handshake.
  return {
    client: realm as unknown as ClientApi, helper, st,
    failNextSave() { failSave = true; },
    saved: () => structuredClone(persisted.settings),
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

describe('helper writes across the real client and host bridge', () => {
  it.each(['inline', 'floating'] as const)('renders only the built-in status widget in a bounded, collapsible %s container and removes it when disabled', async mode => {
    const { helper } = await bridge(undefined, { id: 'ste-beautify-status', data: { count: 0, ste_widget: { mode } } });
    const widget = document.querySelector<HTMLElement>(`[data-ste-widget="${mode}"]`);
    expect(widget).not.toBeNull();
    const record = helper.records[0]; expect(widget!.contains(record.frame)).toBe(true); expect(record.frame.closest('[hidden]')).toBeNull();
    window.dispatchEvent(new MessageEvent('message', { source: record.frame.contentWindow!, data: { steHelper: record.token, kind: 'height', height: 10000 } }));
    expect(parseFloat(record.frame.style.height)).toBeLessThanOrEqual(window.innerHeight * .45);
    widget!.querySelector('button')!.click(); expect(record.frame.hidden).toBe(true);
    widget!.querySelector('button')!.click(); expect(record.frame.hidden).toBe(false);
    const settings = helper.settings; settings.scripts[0].enabled = false; await helper.configure(settings);
    expect(document.querySelector('[data-ste-widget]')).toBeNull();
  });
  it('keeps generic scripts hidden even when they carry widget metadata', async () => {
    const { helper } = await bridge(undefined, { data: { count: 0, ste_widget: { mode: 'floating' } } });
    expect(document.querySelector('[data-ste-widget]')).toBeNull(); expect(helper.records[0].frame.closest('[hidden]')).not.toBeNull();
  });
  it('restores the saved script snapshot after a failed write even when the script consumes its flush error', async () => {
    const { client, helper, saved, failNextSave } = await bridge();
    const scope = { type: 'script' } as const;
    failNextSave();
    client.replaceVariables({ count: 1 }, scope);
    await expect(client.flushHelperWrites()).rejects.toThrow('simulated disk failure');

    await expect(helper.flush()).resolves.toBeUndefined();
    expect(helper.settings.scripts[0].data).toEqual({ count: 0 });
    expect(client.getVariables(scope)).toEqual({ count: 0 });
    expect(saved().scripts[0].data).toEqual({ count: 0 });

    client.replaceVariables({ count: 2 }, scope);
    await client.flushHelperWrites();
    await helper.flush();
    expect(client.getVariables(scope)).toEqual({ count: 2 });
    expect(saved().scripts[0].data).toEqual({ count: 2 });
  });

  it('rejects an asynchronous updater whose starting variables were replaced by a newer snapshot', async () => {
    const { client, helper, st } = await bridge();
    const wait = gate();
    const updating = client.updateVariablesWith(async value => {
      await wait.promise;
      return { count: value.count + 1 };
    }).then(value => ({ value }), error => ({ error }));
    st.chat_metadata.variables = { count: 10 };
    await helper.flush();
    expect(client.getVariables()).toEqual({ count: 10 });

    wait.release();
    const outcome = await updating;
    await client.flushHelperWrites();
    expect(st.chat_metadata.variables).toEqual({ count: 10 });
    expect(client.getVariables()).toEqual({ count: 10 });
    expect(outcome).toMatchObject({ error: { message: expect.stringMatching(/变化/) } });
    expect(st.saveChatConditional).not.toHaveBeenCalled();
  });

  it('rejects an asynchronous message updater after the candidate changes even when its variable value is unchanged', async () => {
    const { client, helper, st } = await bridge();
    const wait = gate(), scope = { type: 'message', message_id: 0 } as const;
    const updating = client.updateVariablesWith(async value => {
      await wait.promise;
      return { count: value.count + 1 };
    }, scope).then(value => ({ value }), error => ({ error }));
    st.chat[0].extra.ste_runtime.candidateId = 'c2';
    await helper.flush();

    wait.release();
    const outcome = await updating;
    await client.flushHelperWrites();
    expect(st.chat[0].variables).toEqual([{ count: 0 }]);
    expect(outcome).toMatchObject({ error: { message: expect.stringMatching(/变化/) } });
    expect(st.saveChatConditional).not.toHaveBeenCalled();
  });

  it('persists an asynchronous update when its starting snapshot is still current', async () => {
    const { client, helper, st } = await bridge();
    await expect(client.updateVariablesWith(async value => ({ count: value.count + 1 }))).resolves.toEqual({ count: 1 });
    await client.flushHelperWrites();
    await helper.flush();
    expect(st.chat_metadata.variables).toEqual({ count: 1 });
    expect(client.getVariables()).toEqual({ count: 1 });
    expect(st.saveChatConditional).toHaveBeenCalledOnce();
  });

  it.each(['generate', 'generateRaw'] as const)('waits for a legal %s button request that takes longer than five seconds', async method => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish!: (value: string) => void;
    const response = new Promise<string>(resolve => { finish = resolve; });
    const { client, helper, st } = await bridge(() => response);
    client.eventOn('ste-helper-button:Generate', async () => {
      const text = await client[method]({ user_input: 'slow model' });
      client.replaceVariables({ count: text.length });
      await client.flushHelperWrites();
    });
    let status = 'pending';
    const button = helper.button('counter', 'Generate').then(() => { status = 'complete'; }, error => { status = error.message; });
    await vi.advanceTimersByTimeAsync(30_000);
    const whileModelIsWorking = status;

    finish('done');
    await vi.advanceTimersByTimeAsync(0);
    await button;
    await helper.flush();
    expect(whileModelIsWorking).toBe('pending');
    expect(status).toBe('complete');
    expect(st.chat_metadata.variables).toEqual({ count: 4 });
  });

  it('still times out a button handler that stops responding after its model request finishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let finish!: (value: string) => void;
    const response = new Promise<string>(resolve => { finish = resolve; });
    const { client, helper } = await bridge(() => response);
    client.eventOn('ste-helper-button:Stall', async () => {
      await client.generate({ user_input: 'slow model' });
      await new Promise<void>(() => {});
    });
    let status = 'pending';
    const button = helper.button('counter', 'Stall').then(() => { status = 'complete'; }, error => { status = error.message; });
    await vi.advanceTimersByTimeAsync(30_000);
    const whileModelIsWorking = status;

    finish('done');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_001);
    await button;
    expect(whileModelIsWorking).toBe('pending');
    expect(status).toMatch(/5 秒/);
  });
});
