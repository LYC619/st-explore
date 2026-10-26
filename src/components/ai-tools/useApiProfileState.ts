import { useEffect, useState } from 'react';
import { subscribeActiveVault } from '@/lib/vault/active';
import { loadApiProfiles } from './api-profiles';
import { API_PROFILES_CHANGED_EVENT } from './api-profile-events';

export function subscribeApiProfileChanges(listener: (scopeChanged: boolean) => void): () => void {
  const changed = (event: Event) => listener((event as CustomEvent).detail === 'scope');
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === 'st-beautifier-api-profiles' || event.key === 'st-beautifier-api-active-profile') listener(false);
  };
  window.addEventListener(API_PROFILES_CHANGED_EVENT, changed);
  window.addEventListener('storage', storage);
  const unsubscribe = subscribeActiveVault(() => listener(true));
  return () => { window.removeEventListener(API_PROFILES_CHANGED_EVENT, changed); window.removeEventListener('storage', storage); unsubscribe(); };
}

/** Shared saved state; form drafts stay inside useApiProfiles. */
export function useApiProfileState() {
  const [state, setState] = useState<ReturnType<typeof loadApiProfiles>>({ profiles: [], activeId: '' });
  useEffect(() => {
    const sync = () => setState(loadApiProfiles());
    sync();
    return subscribeApiProfileChanges(sync);
  }, []);
  return state;
}
