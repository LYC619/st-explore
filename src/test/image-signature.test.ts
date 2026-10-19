import { expect, it } from 'vitest';
import { sniffImageBytes } from '@/lib/image-signature';
const ftyp = (major: string, compatible: string) => {
  const bytes = new Uint8Array(24); new DataView(bytes.buffer).setUint32(0, 24);
  bytes.set(new TextEncoder().encode(`ftyp${major}`), 4); bytes.set(new TextEncoder().encode(compatible), 16); return bytes;
};
it('accepts AVIF major/compatible brands only inside a valid ftyp box', () => {
  expect(sniffImageBytes(ftyp('avif', 'mif1'))).toBe('image/avif');
  expect(sniffImageBytes(ftyp('mif1', 'avif'))).toBe('image/avif');
  expect(sniffImageBytes(ftyp('mif1', 'heic'))).toBeUndefined();
  const truncated = ftyp('avif', 'avif').slice(0, 12); expect(sniffImageBytes(truncated)).toBeUndefined();
});
