import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { PresetPlayground } from '@/components/preset/PresetPlayground';
import { createMemFs } from '@/lib/vault/fs';
import { createVault } from '@/lib/vault/vault-backend';
import { setActiveVault } from '@/lib/vault/active';
import { persistProfiles } from '@/components/ai-tools/api-profiles';
import { parsePreset } from '@/lib/preset-parser';
import { DEFAULT_ENTRY } from '@/types/worldbook';
import type { WorldBookItem } from '@/types/worldbook';
import type { PresetItem } from '@/types/preset';
import type { ArchiveCharacter } from '@/types/archive';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined;
  setActiveVault(null); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const response = (content: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === text)!;
const textarea = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="试用消息"]')!;
async function fill(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea(), value); textarea().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function select(label: string, value: string) { await act(async () => { const el = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function click(text: string) { await act(async () => button(text).click()); }
async function settle(check: () => void) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); check(); }); }
async function render(id = 'p1') { await act(async () => root!.render(<MemoryRouter><PresetPlayground presetId={id} /></MemoryRouter>)); }
async function fixture() {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const vault = createVault(createMemFs()); setActiveVault(vault);
  persistProfiles([{ id: 'fixture-service', name: '测试服务', apiUrl: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture-key', model: 'fixture-model' }], 'fixture-service');
  for (const id of ['p1', 'p2']) await vault.repo<PresetItem>('presets').put({ id, title: id, createdAt: 1, updatedAt: 2, preset: parsePreset({ temperature: 0.31,
    prompts: [{ identifier: 'main', content: `启用预设 ${id} {{char}}/{{user}}` }, { identifier: 'off', content: '禁用预设块' }, ...['charDescription','worldInfoBefore','worldInfoAfter','chatHistory'].map(identifier => ({ identifier, marker: true }))],
    prompt_order: [{ character_id: 100000, order: ['main','off','charDescription','worldInfoBefore','worldInfoAfter','chatHistory'].map(identifier => ({ identifier, enabled: identifier !== 'off' })) }],
  }) });
  await vault.repo<ArchiveCharacter>('characters').put({ id: 'c1', name: '阿林', card: { name: '阿林', description: '角色描述：港城守卫', first_mes: '你好，{{user}}' }, tags: [], status: '未开始', createdAt: 1, updatedAt: 2 });
  await vault.repo<WorldBookItem>('worldbooks').put({ id: 'w1', title: '港城世界书', worldbook: { entries: { '0': { ...DEFAULT_ENTRY, uid: 0, key: ['港城'], content: '港城世界条目' } } }, createdAt: 1, updatedAt: 2 });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render();
  await settle(() => expect(document.querySelector('select[aria-label="试用角色卡"] option[value="c1"]')).not.toBeNull());
  return vault;
}

it('only sends on action, compiles the chosen assets into the real request and never persists trial history', async () => {
  const fetcher = vi.fn(async () => response('夹具回复')); vi.stubGlobal('fetch', fetcher);
  const vault = await fixture();
  const before = await Promise.all(['presets','characters','worldbooks','archiveStories'].map(store => vault.repo(store as 'presets').list()));
  expect(fetcher).not.toHaveBeenCalled();
  await select('试用角色卡', 'c1'); await select('试用世界书', 'w1');
  expect(fetcher).not.toHaveBeenCalled();
  await fill('请介绍港城'); await click('发送');
  await settle(() => expect(document.querySelector('[role="log"]')?.textContent).toContain('夹具回复'));
  const [, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(String(options.body));
  expect(body).toMatchObject({ model: 'fixture-model', temperature: 0.31, stream: true });
  for (const text of ['启用预设 p1 阿林/User','角色描述：港城守卫','港城世界条目','请介绍港城']) expect(JSON.stringify(body.messages)).toContain(text);
  expect(JSON.stringify(body.messages)).not.toContain('禁用预设块');
  expect(await Promise.all(['presets','characters','worldbooks','archiveStories'].map(store => vault.repo(store as 'presets').list()))).toEqual(before);
  await click('清空'); expect(document.querySelector('[role="log"]')?.textContent).not.toContain('夹具回复');
});

it('retries a failed turn without duplicating its user message', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"error":{"message":"fixture unavailable"}}', { status: 503 })).mockImplementationOnce(async () => response('重试成功'));
  vi.stubGlobal('fetch', fetcher); await fixture(); await fill('一条问题'); await click('发送');
  await settle(() => { const alert = document.querySelector('[role="alert"]')?.textContent ?? ''; expect(alert).toContain('HTTP 503'); expect(alert).not.toContain('fixture unavailable'); });
  await click('重试本轮'); await settle(() => expect(document.querySelector('[role="log"]')?.textContent).toContain('重试成功'));
  const options = fetcher.mock.calls[1][1] as RequestInit;
  expect(JSON.parse(String(options.body)).messages.filter((message: { role: string }) => message.role === 'user')).toHaveLength(1);
});

it('aborts on version and vault switches and rejects late answers from a noncancellable transport', async () => {
  let release!: (value: Response) => void; let firstSignal: AbortSignal | undefined;
  const fetcher = vi.fn((_url: string, options: RequestInit) => { firstSignal = options.signal as AbortSignal; return new Promise<Response>(resolve => { release = resolve; }); });
  vi.stubGlobal('fetch', fetcher); await fixture(); await fill('旧版本问题'); await click('发送');
  await settle(() => expect(fetcher).toHaveBeenCalledOnce());
  await render('p2'); expect(firstSignal?.aborted).toBe(true);
  await act(async () => { release(response('旧响应不得混入')); });
  expect(document.querySelector('[role="log"]')?.textContent).not.toContain('旧响应不得混入');
  expect(textarea().value).toBe('');
  await fill('新版本问题'); await click('发送'); await settle(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await act(async () => setActiveVault(createVault(createMemFs())));
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => { release(response('旧资料库回复')); });
  expect(document.querySelector('[role="log"]')?.textContent).not.toContain('旧资料库回复');
});

it('stops immediately and leaves a retry path while resource/transport work is still pending', async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
  vi.stubGlobal('fetch', fetcher); await fixture(); await fill('停止测试'); await click('发送');
  await settle(() => expect(fetcher).toHaveBeenCalledOnce()); await click('停止');
  expect(button('重试本轮')).toBeEnabled(); expect(textarea()).toBeEnabled();
  await act(async () => { release(response('不接受的后到回复')); });
  expect(document.querySelector('[role="log"]')?.textContent).not.toContain('不接受的后到回复');
});
