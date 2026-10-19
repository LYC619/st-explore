const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
export function sniffImageBytes(bytes: Uint8Array): string | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(text(bytes, 0, 6))) return 'image/gif';
  if (text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 16 && text(bytes, 4, 8) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > bytes.length || size % 4 !== 0) return undefined;
    const brands = [text(bytes, 8, 12)];
    for (let offset = 16; offset < size; offset += 4) brands.push(text(bytes, offset, offset + 4));
    if (brands.some(brand => brand === 'avif' || brand === 'avis')) return 'image/avif';
  }
  return undefined;
}
export const imageExtension = (mime: string) => mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);

function hasCompleteJpeg(bytes: Uint8Array, view: DataView): boolean {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (marker === undefined || marker === 0 || marker === 216 || marker === 217 || offset + 2 > bytes.length) return false;
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) return false;
    offset += size;
    if (marker === 218) {
      if (size < 6) return false;
      // Entropy decoding belongs to the image decoder; require a scan and its end marker here.
      for (let i = offset + 1; i + 1 < bytes.length; i++) if (bytes[i] === 255 && bytes[i + 1] === 217) return true;
      return false;
    }
  }
  return false;
}

function hasCompleteGif(bytes: Uint8Array): boolean {
  if (bytes.length < 14) return false;
  let offset = 13, image = false;
  if (bytes[10] & 128) offset += 3 * 2 ** ((bytes[10] & 7) + 1);
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (size === 0) return true;
      offset += size;
    }
    return false;
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 59) return image;
    if (marker === 33) {
      offset++; // Extension label, followed by length-prefixed blocks.
      if (!skipBlocks()) return false;
    } else if (marker === 44) {
      if (offset + 9 > bytes.length) return false;
      const packed = bytes[offset + 8];
      offset += 9;
      if (packed & 128) offset += 3 * 2 ** ((packed & 7) + 1);
      offset++; // LZW minimum code size.
      if (!skipBlocks()) return false;
      image = true;
    } else return false;
  }
  return false;
}

function hasCompleteWebp(bytes: Uint8Array, view: DataView): boolean {
  if (bytes.length < 20) return false;
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 20) return false;
  let offset = 12, image = false;
  while (offset + 8 <= end) {
    const size = view.getUint32(offset + 4, true), type = text(bytes, offset, offset + 4);
    if (size > end - offset - 8) return false;
    if (size > 0 && (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF')) image = true;
    offset += 8 + size + size % 2;
  }
  return offset === end && image;
}

function hasCompleteAvif(bytes: Uint8Array, view: DataView): boolean {
  let offset = 0, content = false;
  while (offset + 8 <= bytes.length) {
    let size = view.getUint32(offset), header = 8;
    const type = text(bytes, offset + 4, offset + 8);
    if (size === 1) {
      if (offset + 16 > bytes.length || view.getUint32(offset + 8) !== 0) return false;
      size = view.getUint32(offset + 12); header = 16;
    } else if (size === 0) size = bytes.length - offset;
    if (size < header || size > bytes.length - offset) return false;
    if ((type === 'meta' || type === 'moov') && size > header) content = true;
    offset += size;
  }
  return offset === bytes.length && content;
}

export function validateDownloadedImage(bytes: Uint8Array, mime: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') {
    let offset = 8, header = false, data = false, end = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset), type = text(bytes, offset + 4, offset + 8);
      if (size > bytes.length - offset - 12) break;
      if (type === 'IHDR') header = size === 13 && view.getUint32(offset + 8) > 0 && view.getUint32(offset + 12) > 0;
      if (type === 'IDAT') data = true;
      if (type === 'IEND') { end = size === 0; break; }
      offset += size + 12;
    }
    if (!header || !data || !end) throw new Error('PNG 图片已损坏或不完整');
  } else if (mime === 'image/jpeg' && !hasCompleteJpeg(bytes, view)) throw new Error('JPEG 图片已损坏或不完整');
  else if (mime === 'image/gif' && !hasCompleteGif(bytes)) throw new Error('GIF 图片已损坏或不完整');
  else if (mime === 'image/webp' && !hasCompleteWebp(bytes, view)) throw new Error('WebP 图片已损坏或不完整');
  else if (mime === 'image/avif' && !hasCompleteAvif(bytes, view)) throw new Error('AVIF 图片已损坏或不完整');
}
