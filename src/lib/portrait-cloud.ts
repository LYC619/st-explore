import { isTauri } from '@tauri-apps/api/core';

export interface PortraitLinkRules { source: string; pattern: string; template: string; encode: boolean }
export interface PortraitLink { name: string; url: string }

/** Executed in a disposable worker: a creator-provided regex cannot block the UI. */
export function buildPortraitLinks({ source, pattern, template, encode }: PortraitLinkRules): PortraitLink[] {
  if (source.length > 512_000 || pattern.length > 2000 || template.length > 4000) throw new Error('输入过长，请分批导入');
  const regex = new RegExp(pattern || '[^\\r\\n]+', 'gm');
  const links: PortraitLink[] = [], seen = new Set<string>();
  for (const match of source.matchAll(regex)) {
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
    if (!seen.has(url.href)) { seen.add(url.href); links.push({ name, url: url.href }); }
    if (links.length > 1000) throw new Error('单次最多导入 1000 张，请分批处理');
  }
  return links;
}

const MAX_BYTES = 20 * 1024 * 1024;
export async function downloadPortrait(link: PortraitLink, signal: AbortSignal, transport?: typeof fetch): Promise<File> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, 30_000);
  try {
    const send = transport ?? (isTauri() ? (await import('@tauri-apps/plugin-http')).fetch : fetch);
    const response = await send(link.url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('图片超过 20 MB');
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('下载响应为空');
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('图片超过 20 MB'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const prefix = new TextDecoder('ascii').decode(bytes.slice(0, 12));
    const ext = bytes[0] === 137 && prefix.slice(1, 4) === 'PNG' ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
        : /^GIF8[79]a/.test(prefix) ? 'gif'
          : prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP' ? 'webp' : undefined;
    if (!ext) throw new Error('链接返回的不是 PNG、JPEG、GIF 或 WebP 图片（可能是网页或防盗链提示）');
    const stem = [...link.name].map(char => char.charCodeAt(0) < 32 ? '_' : char).join('').replace(/[\\/:*?"<>|]/g, '_').replace(/\.(png|jpe?g|gif|webp)$/i, '').trim().slice(0, 120) || '立绘';
    return new File([bytes], `${stem}.${ext}`, { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
