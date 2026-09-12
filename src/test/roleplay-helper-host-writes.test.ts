import { createContext, runInContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import clientSource from '../tavern/helper-client.js?raw';
import hostSource from '../tavern/helper-host.js?raw';
import messagesSource from '../tavern/helper-messages.js?raw';

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
type Settings = {
  schema: number;
  scripts: { id: string; name: string; content: string; enabled: boolean; grants: string[]; data: Variables }[];
  html: { enabled: boolean; grants: string[] };
};
type HostApi = {
  readonly settings: Settings;
  readonly records: { frame: HTMLIFrameElement }[];
  flush(): Promise<void>;
  button(scriptId: string, name: string): Promise<void>;
};

// Run the production sources, adapting only ES module loading. The host's two
// absolute imports belong to the upstream Tavern, which is absent in unit tests.
const helperClient = new Function(clientSource.replace('export function helperClient', 'return function helperClient'))();
const messageModule = new Function(`${messagesSource.replace(/^export /gm, '')}\nreturn { helperMessages, helperMessageSource, prepareHelperMessageChanges };`)();
const installHelperHost = new Function('helperClient', 'messageModule', 'loadModule', `
  const { helperMessages, helperMessageSource, prepareHelperMessageChanges } = messageModule;
  ${hostSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '').replaceAll('await import(', 'await loadModule(')}
  return installHelperHost;
`)(helperClient, messageModule, async (name: string) => {
  if (name === '/scripts/extensions.js') return { extension_settings: { variables: { global: {} } } };
  if (name === '/scripts/slash-commands.js') return { executeSlashCommandsWithOptions: vi.fn() };
  throw new Error(`Unexpected upstream import: ${name}`);
}) as (host: unknown, st: unknown) => Promise<HostApi>;

beforeEach(() => {
  document.body.innerHTML = '<div id="chat"></div>';
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

async function bridge(generate = async () => 'response') {
  let persisted: { chatKey: string; revision: number; settings: Settings } = {
    chatKey: 'story:main', revision: 1,
    settings: {
      schema: 1,
      scripts: [{ id: 'counter', name: 'Counter', content: '', enabled: true, grants: ['read', 'write', 'generate'], data: { count: 0 } }],
      html: { enabled: false, grants: [] },
    },
  };
  let failSave = false;
  const host = {
    isGenerating: () => false,
    request: vi.fn(async (path: string, body?: { settings: Settings }) => {
      if (path === '/ste/helpers') return Response.json(structuredClone(persisted));
      if (path !== '/ste/helpers/save' || !body) throw new Error(`Unexpected host request: ${path}`);
      if (failSave) {
        failSave = false;
        return Response.json({ error: { message: 'simulated disk failure' } }, { status: 500 });
      }
      persisted = { ...persisted, revision: persisted.revision + 1, settings: structuredClone(body.settings) };
      return Response.json(structuredClone(persisted));
    }),
  };
  const events: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const listen = (name: string, listener: (...args: unknown[]) => unknown) => { (events[name] ??= []).push(listener); };
  const st = {
    chat: [{ name: 'Character', mes: 'original', is_user: false, swipe_id: 0, variables: [{ count: 0 }],
      extra: { ste_runtime: { messageId: 'm1', candidateId: 'c1' } } }],
    chat_metadata: { variables: { count: 0 } },
    name1: 'User', name2: 'Character',
    getCurrentChatId: () => 'main',
    event_types: { CHAT_CHANGED: 'chat-changed' },
    eventSource: { events, makeFirst: listen, on: listen },
    saveChatConditional: vi.fn(async () => {}),
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
