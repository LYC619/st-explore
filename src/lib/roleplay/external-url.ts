/** Called in the STE parent window; the embedded Tavern has a compatibility Tauri shim. */
export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅支持打开 HTTP(S) 网页链接');
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:opener|open_url', { url: url.href });
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}
