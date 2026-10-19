import { sha256 } from 'js-sha256';
import type { ArchiveCharacter, PortraitImportSource } from '@/types/archive';
import { normalizePortraitUrl } from './portrait-list-parser';

export function portraitImportSource(value: string): PortraitImportSource {
  const url = normalizePortraitUrl(value);
  return { url: url.href, host: url.hostname.toLowerCase(), file: url.pathname.split('/').pop() ?? '' };
}
export function portraitSourceKey(source: PortraitImportSource): string {
  const url = new URL(source.url); url.hash = '';
  return ['files.catbox.moe', 'litter.catbox.moe'].includes(url.hostname.toLowerCase())
    ? `${url.hostname.toLowerCase()}/${url.pathname.split('/').pop()}` : url.href;
}
export function hasPortraitSource(character: ArchiveCharacter, source: PortraitImportSource): boolean {
  const key = portraitSourceKey(source);
  return !!character.portraitRows?.some(row => row.items.some(item => {
    try { return item.importSource && portraitSourceKey(item.importSource) === key; } catch { return false; }
  }));
}
export const portraitContentHash = (base64: string) => sha256(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
