import { digest } from './fingerprint';
import type { FrontendDraft } from '@/lib/frontend-workbench';

export const FRONTEND_SCRIPT_PREFIX = 'ste-frontend:';
export function frontendScripts(frontend: FrontendDraft | null, chatKey: string) {
  return (frontend?.scripts ?? []).filter(script => script.enabled).map(script => ({ ...script,
    id: FRONTEND_SCRIPT_PREFIX + digest(chatKey).slice(0, 20) + ':' + script.id }));
}
export function withoutFrontendScripts<T extends { id?: string; scripts?: T[] }>(scripts: T[]): T[] {
  return scripts.filter(script => !script.id?.startsWith(FRONTEND_SCRIPT_PREFIX)).map(script =>
    Array.isArray(script.scripts) ? { ...script, scripts: withoutFrontendScripts(script.scripts) } : script);
}
