export interface ParsedPortraitItem {
  line: number; raw: string; name: string; file: string; url: string; nameSource: 'explicit' | 'prefix' | 'filename';
}
export interface PortraitLineIssue { line: number; text: string; reason: string }
export interface PortraitParseResult { items: ParsedPortraitItem[]; failed: PortraitLineIssue[]; skipped: number[] }
export const DEFAULT_PORTRAIT_HOST = 'https://files.catbox.moe/';
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif)$/i;

export function normalizePortraitUrl(value: string): URL {
  let url: URL; try { url = new URL(value); } catch { throw new Error('无效的图片 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片链接必须为不含登录信息的 HTTP(S) URL');
  url.hash = ''; return url;
}

export function portraitUrl(value: string): URL {
  const url = normalizePortraitUrl(value);
  if (!IMAGE_EXTENSION.test(url.pathname)) throw new Error('图片扩展名需为 PNG/JPEG/GIF/WebP/AVIF');
  return url;
}

function parseLine(raw: string, line: number, host: string): ParsedPortraitItem {
  const text = raw.trim();
  const namedUrl = /^(.+?)[:：]\s*(https?:\/\/\S+)$/i.exec(text);
  if (/^https?:\/\//i.test(text) || namedUrl) {
    const url = portraitUrl(namedUrl ? namedUrl[2] : text);
    const file = url.pathname.split('/').pop()!;
    let filename = file; try { filename = decodeURIComponent(file); } catch { /* Keep the server path intact. */ }
    return { line, raw, name: namedUrl ? namedUrl[1].trim() : filename.replace(IMAGE_EXTENSION, ''), file, url: url.href,
      nameSource: namedUrl ? 'explicit' : 'filename' };
  }
  const match = /([A-Za-z0-9]{4,}\.(?:png|jpe?g|gif|webp|avif))$/i.exec(text);
  if (!match) throw new Error(IMAGE_EXTENSION.test(text) ? '未找到至少 4 位字母/数字文件码，请补充完整链接' : '未找到图片文件码或支持的图片链接');
  const file = match[1], prefix = text.slice(0, match.index).trim();
  const colon = prefix.search(/[:：]/);
  const name = (colon >= 0 ? prefix.slice(0, colon) : prefix).replace(/[\s_\-:：]+$/, '').trim();
  const base = new URL(host);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('图床地址无效');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return { line, raw, file, name: name || file.replace(IMAGE_EXTENSION, ''), nameSource: name ? colon >= 0 ? 'explicit' : 'prefix' : 'filename',
    url: portraitUrl(new URL(encodeURIComponent(file), base).href).href };
}

/** Linear, bounded parsing. A malformed row never discards its valid neighbours. */
export function parsePortraitList(source: string, host = DEFAULT_PORTRAIT_HOST): PortraitParseResult {
  if (new TextEncoder().encode(source).byteLength > 512_000) throw new Error('输入超过 512 KB，请分批导入');
  const result: PortraitParseResult = { items: [], failed: [], skipped: [] }, urls = new Set<string>();
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1, text = raw.trim();
    if (!text || /^<\/?[\w:.-]+(?:\s[^<>]*)?>$/.test(text)) { result.skipped.push(line); return; }
    try {
      const item = parseLine(raw, line, host);
      if (urls.has(item.url)) { result.skipped.push(line); return; }
      urls.add(item.url); result.items.push(item);
    } catch (error) { result.failed.push({ line, text: raw, reason: error instanceof Error ? error.message : String(error) }); }
  });
  if (result.items.length > 1000) throw new Error('单次最多导入 1000 张，请分批处理');
  const reserved = new Set(result.items.map(item => item.name)), used = new Set<string>();
  for (const item of result.items) {
    const base = item.name; let suffix = 2;
    while (used.has(item.name)) { do { item.name = `${base}_${suffix++}`; } while (reserved.has(item.name)); }
    used.add(item.name);
  }
  return result;
}
