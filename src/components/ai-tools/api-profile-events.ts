/** Notifications contain no configuration or credentials. */
export const API_PROFILES_CHANGED_EVENT = 'ste-api-profiles-changed';
export type ApiProfilesChange = 'profiles' | 'scope';

export function notifyApiProfilesChanged(reason: ApiProfilesChange = 'profiles'): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(API_PROFILES_CHANGED_EVENT, { detail: reason }));
}
