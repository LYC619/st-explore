import en from './locales/en.json';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const LOCALE_STORAGE_KEY = 'ste-language';
const messages: Readonly<Record<string, string>> = en;
const listeners = new Set<() => void>();

export function normalizeLocale(value: string | null | undefined): Locale | undefined {
  if (!value) return undefined;
  if (/^zh(?:-|$)/i.test(value)) return 'zh-CN';
  if (/^en(?:-|$)/i.test(value)) return 'en';
  return undefined;
}

export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  return normalizeLocale(saved) ?? languages.map(normalizeLocale).find(Boolean) ?? 'en';
}

function initialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  const requested = normalizeLocale(new URLSearchParams(window.location.search).get('lang'));
  if (requested) {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, requested); } catch { /* Optional display preference. */ }
    return requested;
  }
  let saved: string | null = null;
  try { saved = localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* Optional display preference. */ }
  return detectLocale(saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
}

let locale = initialLocale();
export const getLocale = (): Locale => locale;
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(next: Locale, persist = true): void {
  if (!LOCALES.includes(next)) return;
  if (persist) {
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Session choice still works. */ }
  }
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang') && url.searchParams.get('lang') !== next) {
      url.searchParams.set('lang', next);
      window.history.replaceState(window.history.state, '', url);
    }
  }
  const changed = locale !== next;
  locale = next;
  syncDocumentLanguage();
  if (changed) listeners.forEach(listener => listener());
}

export function syncDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = locale === 'en' ? 'ST Explorer · Your roleplay library' : 'ST Explorer · 拾忆';
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', locale === 'en' ? '/manifest.en.json' : '/manifest.json');
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === LOCALE_STORAGE_KEY || event.key === null) {
      setLocale(detectLocale(event.newValue, navigator.languages), false);
    }
  });
}

/** Only authored interface messages belong here. Never pass user content to this function. */
export function translate(source: string, values: Record<string, string | number | undefined> = {}, language = locale): string {
  const template = language === 'en' ? messages[source] ?? source : source;
  // Replace once: values containing braces are text, never a second template or HTML.
  return template.replace(/&(?:amp|lt|gt|quot|apos);/g, entity =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity] ?? entity))
    .replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match);
}

export const tr = translate;
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(value: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}
export function formatList(items: readonly string[], language = locale): string {
  return items.join(language === 'en' ? ', ' : '、');
}
