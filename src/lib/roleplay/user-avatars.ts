import { bytesToBase64 } from '@/lib/utils';

export function userAvatarName(value: unknown): string {
  const name = String(value ?? '');
  if (!name || name.length > 180 || /[\\/:*?"<>|]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) || name === '.' || name === '..') throw new Error('用户头像文件名无效');
  return name;
}

/** Store only bounded raster images, never active SVG/HTML from an upload. */
export async function readUserAvatar(file: unknown): Promise<string> {
  const blob = file as Blob;
  if (!blob || typeof blob.arrayBuffer !== 'function' || !blob.size || blob.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 PNG、JPEG、GIF 或 WebP 头像');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = Array.from(bytes.slice(0, 12), b => String.fromCharCode(b)).join('');
  const mime = bytes[0] === 137 && header.slice(1, 4) === 'PNG' ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
      : /^GIF8[79]a/.test(header) ? 'image/gif'
        : header.startsWith('RIFF') && header.slice(8) === 'WEBP' ? 'image/webp' : undefined;
  if (!mime) throw new Error('头像内容不是支持的图片格式');
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
