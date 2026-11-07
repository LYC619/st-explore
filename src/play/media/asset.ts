import { sha256 } from 'js-sha256';
import { sniffImageBytes, validateDownloadedImage } from '@/lib/image-signature';
export interface WorldMedia { id: string; mime: string; data: string; width: number; height: number; updatedAt: number }
export function bytesFromBase64(value: string) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function toBase64(bytes: Uint8Array) { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); }
/** Parse dimensions before allocating a decoded bitmap. Animated formats are rejected. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const mime = sniffImageBytes(bytes), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('请选择静态 PNG、JPEG 或 WebP 图片');
  validateDownloadedImage(bytes, mime);
  let width = 0, height = 0;
  if (mime === 'image/png') { width = view.getUint32(16); height = view.getUint32(20);
    for (let i = 8; i + 12 <= bytes.length;) { const size = view.getUint32(i), kind = String.fromCharCode(...bytes.subarray(i+4,i+8)); if (kind === 'acTL') throw new Error('暂不支持动画图片'); i += size + 12; }
  } else if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break; while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const size = view.getUint16(offset); if (size < 2 || offset + size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = view.getUint16(offset+3); width = view.getUint16(offset+5); break; } offset += size;
    }
  } else {
    for (let i = 12; i + 18 <= bytes.length;) {
      const kind = String.fromCharCode(...bytes.subarray(i,i+4)), size = view.getUint32(i+4,true), d = i+8;
      if (kind === 'ANIM' || kind === 'ANMF' || kind === 'VP8X' && bytes[d] & 2) throw new Error('暂不支持动画图片');
      if (kind === 'VP8X') { width = 1 + bytes[d+4] + bytes[d+5]*256 + bytes[d+6]*65536; height = 1 + bytes[d+7] + bytes[d+8]*256 + bytes[d+9]*65536; }
      if (kind === 'VP8 ') { width ||= view.getUint16(d+6,true) & 16383; height ||= view.getUint16(d+8,true) & 16383; }
      if (kind === 'VP8L') { const bits = view.getUint32(d+1,true); width ||= 1+(bits & 16383); height ||= 1+((bits >>> 14) & 16383); }
      i += 8 + size + size%2;
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width*height > 8_000_000) throw new Error('图片尺寸过大，请使用不超过 800 万像素、单边 4096 的图片');
  return { width, height, mime };
}
export function validWorldMedia(value: unknown): value is WorldMedia {
  try {
    const m = value as WorldMedia;
    if (!m || !/^[a-f0-9]{64}$/.test(m.id) || typeof m.data !== 'string' || m.data.length > 6_000_000 || !Number.isFinite(m.updatedAt)) return false;
    const bytes = bytesFromBase64(m.data), dims = imageDimensions(bytes);
    return sha256(bytes) === m.id && dims.width === m.width && dims.height === m.height && dims.mime === m.mime;
  } catch { return false; }
}
export async function importStageImage(file: Blob): Promise<WorldMedia> {
  if (file.size > 4 * 1024 * 1024) throw new Error('单张素材不能超过 4 MB');
  const input = new Uint8Array(await file.arrayBuffer()); imageDimensions(input);
  const bitmap = await createImageBitmap(new Blob([input]));
  try {
    const scale = Math.min(1, 1920 / bitmap.width, 1600 / bitmap.height), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('图像处理不可用'); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图像处理失败')), 'image/webp', .85));
    const bytes = new Uint8Array(await blob.arrayBuffer()), dims = imageDimensions(bytes);
    return { id: sha256(bytes), data: toBase64(bytes), ...dims, updatedAt: Date.now() };
  } finally { bitmap.close(); }
}
