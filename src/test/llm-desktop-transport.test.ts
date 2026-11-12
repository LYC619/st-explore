import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ fetch: vi.fn(), invoke: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}) }));
vi.mock('@/lib/runtime', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: platform.fetch }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: platform.invoke }));
import { callOpenAIMessages, fetchModels } from '@/lib/llm';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('uses native HTTP for STE requests and sends only safe classified diagnostics', async () => {
  const browserFetch = vi.fn(); vi.stubGlobal('fetch', browserFetch);
  const config = { apiKey:'synthetic-key', apiUrl:'https://synthetic-host.invalid/v1/chat/completions', model:'synthetic-private-model' };
  platform.fetch.mockImplementation(async () => new Response('synthetic-private-response synthetic-key', {status:401}));
  await expect(callOpenAIMessages(config, [{role:'user',content:'synthetic-private-prompt'}])).rejects.toMatchObject({ category:'permission', attempts:1 });
  await expect(fetchModels(config.apiUrl, config.apiKey)).rejects.toMatchObject({ category:'permission' });
  expect(platform.fetch).toHaveBeenCalledTimes(2); expect(browserFetch).not.toHaveBeenCalled();
  expect(platform.invoke).toHaveBeenCalled();
  expect(platform.invoke.mock.calls[0][0]).toBe('write_diagnostic_event');
  const diagnostic=JSON.stringify(platform.invoke.mock.calls);
  expect(diagnostic).toContain('permission');
  for(const privateValue of ['synthetic-key','synthetic-host','synthetic-private-model','synthetic-private-response','synthetic-private-prompt']) expect(diagnostic).not.toContain(privateValue);
});
