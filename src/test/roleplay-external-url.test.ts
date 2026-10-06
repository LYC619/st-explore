import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '@/lib/roleplay/external-url';

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); invoke.mockClear(); });

describe('external extension links', () => {
  it('uses the native opener from the desktop host instead of a WebView popup', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    await openExternalUrl('https://github.com/N0VI028/JS-Slash-Runner');
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://github.com/N0VI028/JS-Slash-Runner' });
  });
  it('opens browser links with no opener access', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openExternalUrl('https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/pinned');
    expect(open).toHaveBeenCalledWith('https://codeload.github.com/N0VI028/JS-Slash-Runner/zip/pinned', '_blank', 'noopener,noreferrer');
  });
  it.each(['file:///C:/secret', 'javascript:alert(1)', 'not a URL'])('rejects non-web links: %s', async url => {
    await expect(openExternalUrl(url)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
