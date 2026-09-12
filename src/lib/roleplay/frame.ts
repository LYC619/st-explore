import type { createTavernHost } from './tavern-host';

export type TavernHost = Awaited<ReturnType<typeof createTavernHost>>;
export interface TavernFrameWindow extends Window {
  __STE_TAVERN_FLUSH__?: () => Promise<void>;
  __STE_TAVERN_DIRTY__?: () => boolean;
}
declare global {
  interface Window {
    __STE_TAVERN_HOSTS__?: Map<string, TavernHost>;
  }
}

export function registerTavernHost(host: TavernHost) {
  const id = crypto.randomUUID();
  const registry = window.__STE_TAVERN_HOSTS__ ??= new Map();
  registry.set(id, host);
  return { id, remove: () => { registry.delete(id); host.close(); } };
}
