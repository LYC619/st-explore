import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLocale, formatList, getLocale, LOCALE_STORAGE_KEY, setLocale, subscribeLocale, translate } from './index';

afterEach(() => { vi.restoreAllMocks(); setLocale('zh-CN'); window.history.replaceState(null, '', '/'); });
describe('interface language', () => {
  it('prefers a saved choice, matches regional languages, and falls back to English', () => {
    expect(detectLocale('en', ['zh-TW'])).toBe('en');
    expect(detectLocale(null, ['fr', 'zh-HK'])).toBe('zh-CN');
    expect(detectLocale(null, ['en-GB'])).toBe('en');
    expect(detectLocale('unknown', ['fr'])).toBe('en');
  });
  it('interpolates once and preserves card macros and literal user text', () => {
    expect(translate('已选择 {{v0}} 项', { v0: '{{char}} &amp; <b>test</b>' }, 'zh-CN')).toBe('已选择 {{char}} &amp; <b>test</b> 项');
    expect(translate('{{char}} 与 {{user}}', {}, 'en')).toBe('{{char}} 与 {{user}}');
    expect(translate('未知文案 {{v0}}', { v0: 3 }, 'en')).toBe('未知文案 3');
    expect(translate('保存', {}, 'en')).toBe('Save');
  });
  it('updates the document and notifies only for a changed choice', () => {
    const notify = vi.fn(); const stop = subscribeLocale(notify);
    setLocale('en'); setLocale('en');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    stop();
  });
  it('keeps an in-session choice when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('disabled'); });
    expect(() => setLocale('en')).not.toThrow();
    expect(getLocale()).toBe('en');
  });
  it('updates a language deep link when the user changes the choice', () => {
    window.history.replaceState(null, '', '/settings?lang=en&tab=display');
    setLocale('zh-CN');
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('zh-CN');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('display');
  });
  it('receives a cross-window preference without writing back to storage and syncs any ?lang= param', () => {
    window.history.replaceState(null, '', '/?lang=zh-CN');
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    window.dispatchEvent(new StorageEvent('storage', { key: LOCALE_STORAGE_KEY, newValue: 'en' }));
    expect(getLocale()).toBe('en');
    expect(new URLSearchParams(window.location.search).get('lang')).toBe('en');
    expect(persist).not.toHaveBeenCalled();
  });
  it('formats localized item lists with English commas or Chinese enumeration commas', () => {
    expect(formatList(['Lorebook', 'Preset'], 'en')).toBe('Lorebook, Preset');
    expect(formatList(['世界书', '预设'], 'zh-CN')).toBe('世界书、预设');
  });
});
