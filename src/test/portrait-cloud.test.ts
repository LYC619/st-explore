import { describe, expect, it, vi } from 'vitest';
import { buildPortraitLinks, downloadPortrait } from '@/lib/portrait-cloud';

describe('portrait cloud import', () => {
  it('extracts captures, encodes names, and deduplicates generated URLs', () => {
    expect(buildPortraitLinks({ source: '名：开心\n名：生气\n名：开心', pattern: '名：(\\S+)', template: 'https://example.com/{name}.png', encode: true })).toEqual([
      { name: '开心', url: 'https://example.com/%E5%BC%80%E5%BF%83.png' }, { name: '生气', url: 'https://example.com/%E7%94%9F%E6%B0%94.png' },
    ]);
    expect(buildPortraitLinks({ source: 'a-2', pattern: '(?<name>\\w+)-(\\d+)', template: 'https://x.test/$<name>/$2.webp', encode: false })[0].url).toBe('https://x.test/a/2.webp');
  });
  it('accepts pasted complete links and rejects invalid rules or executable URLs', () => {
    expect(buildPortraitLinks({ source: 'https://x.test/a.png', pattern: '', template: '$&', encode: false })[0].url).toBe('https://x.test/a.png');
    expect(() => buildPortraitLinks({ source: 'a', pattern: '(', template: 'https://x.test/$1', encode: false })).toThrow();
    expect(() => buildPortraitLinks({ source: 'a', pattern: '', template: 'javascript:alert(1)', encode: false })).toThrow(/HTTP/);
  });
  it('checks actual file content and preserves extension for names without an extension', async () => {
    const send = vi.fn(async () => new Response(new Uint8Array([137,80,78,71,13,10,26,10]), { headers: { 'content-type': 'application/octet-stream' } }));
    const file = await downloadPortrait({ name: '开心', url: 'https://x.test/a' }, new AbortController().signal, send);
    expect(file.name).toBe('开心.png'); expect(file.type).toBe('image/png');
    await expect(downloadPortrait({ name: 'a', url: 'https://x.test/a' }, new AbortController().signal, async () => new Response('<html>denied</html>'))).rejects.toThrow(/不是/);
  });
  it('rejects oversized images before reading the body', async () => {
    await expect(downloadPortrait({ name: 'a', url: 'https://x.test/a' }, new AbortController().signal, async () => new Response('x', { headers: { 'content-length': '99999999' } }))).rejects.toThrow(/20 MB/);
  });
});
