import { isTauri } from '@tauri-apps/api/core';
import { sniffImageBytes, imageExtension, validateDownloadedImage } from './image-signature';

export interface PortraitLinkRules { source: string; pattern: string; template: string; encode: boolean }
export interface PortraitLink { name: string; url: string; rowId?: string | null; rowTitle?: string; force?: boolean }
export interface PortraitSourceLink extends PortraitLink { raw: string; line: number }

export const CATBOX_WORLDBOOK_PRESET = {
  pattern: String.raw`^\s*([^:：]+?)\s*[:：]\s*[^\x00-\x7F]+([0-9A-Za-z]+\.[A-Za-z]+)`,
  template: 'https://files.catbox.moe/$2#$1.png',
} as const;

/** Executed in a disposable worker: a creator-provided regex cannot block the UI. */
export function buildPortraitLinks({ source, pattern, template, encode }: PortraitLinkRules): PortraitSourceLink[] {
  if (source.length > 512_000 || pattern.length > 2000 || template.length > 4000) throw new Error('输入过长，请分批导入');
  const regex = new RegExp(pattern || '[^\\r\\n]+', 'gm');
  const links: PortraitSourceLink[] = [], seen = new Set<string>();
  let line = 1, position = 0;
  for (const match of source.matchAll(regex)) {
    while (position < match.index) { if (source[position] === '\n') line++; position++; }
    if (!match[0].trim()) continue;
    const name = (match[1] ?? match[0]).trim();
    const encodePart = (value: string) => encode ? encodeURIComponent(value.trim()) : value.trim();
    const rendered = template.trim().replace(/\{name\}|\$(\$|&|\d{1,2}|<[^>]+>)/g, (token, group: string | undefined) => {
      if (token === '{name}') return encodePart(name);
      if (group === '$') return '$';
      if (group === '&') return encodePart(match[0]);
      const value = group?.startsWith('<') ? match.groups?.[group.slice(1, -1)] : match[Number(group)];
      return encodePart(value ?? '');
    });
    let url: URL;
    try { url = new URL(rendered); } catch { throw new Error(`「${name.slice(0, 45)}」未生成有效链接，请检查拼接模板`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片链接必须使用 HTTP 或 HTTPS，且不能包含登录信息');
    url.hash = '';
    if (!seen.has(url.href)) { seen.add(url.href); links.push({ name, url: url.href, raw: match[0], line }); }
    if (links.length > 1000) throw new Error('单次最多导入 1000 张，请分批处理');
  }
  return links;
}

const MAX_BYTES = 20 * 1024 * 1024;
export async function downloadPortrait(link: PortraitLink, signal: AbortSignal, transport?: typeof fetch, onProgress?: (received: number, total?: number) => void): Promise<File> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, 30_000);
  try {
    const send = transport ?? (isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : fetch);
    const response = await send(link.url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('图片超过 20 MB');
    const total = Number(response.headers.get('content-length')) || undefined;
    onProgress?.(0, total);
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('下载响应为空');
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('图片超过 20 MB'); }
        chunks.push(value);
        onProgress?.(size, total);
      }
    } finally { reader.releaseLock(); }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const mime = sniffImageBytes(bytes);
    if (!mime) throw new Error('链接返回的不是 PNG、JPEG、GIF、WebP 或 AVIF 图片（可能是网页或防盗链提示）');
    validateDownloadedImage(bytes, mime);
    return new File([bytes], portraitDownloadName(link.name, mime), { type: mime });
  } catch (error) {
    if (timedOut) throw new Error('图片下载超过 30 秒，请重试');
    if (signal.aborted) throw new DOMException('图片下载已取消', 'AbortError');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export function portraitDownloadName(name: string, mime: string): string {
  const stem = [...name].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.(png|jpe?g|gif|webp|avif)$/i, '').trim().slice(0, 120) || '立绘';
  return `${stem}.${imageExtension(mime)}`;
}
