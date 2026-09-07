// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync, Zip, ZipDeflate } from 'fflate';
import { DEFAULT_LIMITS, parseReadingPackBytes, unzipReadingPack } from '@/lib/reading-pack/import';
import { MAX_READING_PACK_ENTRY_BYTES } from '@/types/reading-pack';

const zip = (entries: Record<string, Uint8Array>) => zipSync(entries, { level: 6 });
const tinyZip = () => zip({ 'media/a': strToU8('test') });
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function centralOffsets(bytes: Uint8Array): number[] {
  const view = viewOf(bytes);
  const end = bytes.length - 22;
  let offset = view.getUint32(end + 16, true);
  return Array.from({ length: view.getUint16(end + 10, true) }, () => {
    const current = offset;
    offset += 46 + view.getUint16(offset + 28, true)
      + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    return current;
  });
}

function declareExpandedSizes(bytes: Uint8Array, size: number): Uint8Array {
  const view = viewOf(bytes);
  for (const offset of centralOffsets(bytes)) {
    view.setUint32(offset + 24, size, true);
    view.setUint32(view.getUint32(offset + 42, true) + 22, size, true);
  }
  return bytes;
}

describe('bounded reading-pack ZIP extraction', () => {
  it('extracts stored and deflated entries exactly, including empty entries', () => {
    const entries = { 'media/a': new Uint8Array(40000).fill(97), 'media/empty': new Uint8Array() };
    for (const level of [0, 6] as const) {
      expect(unzipReadingPack(zipSync(entries, { level }))).toEqual(entries);
    }
  });

  it('supports streaming ZIP data descriptors with unknown local sizes', () => {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
    const file = new ZipDeflate('media/a');
    archive.add(file);
    file.push(strToU8('streamed bytes'), true);
    archive.end();
    expect(unzipReadingPack(Buffer.concat(chunks))['media/a']).toEqual(strToU8('streamed bytes'));
  });

  it('enforces compressed input before touching ZIP metadata', () => {
    expect(() => unzipReadingPack(new Uint8Array(33), { ...DEFAULT_LIMITS, maxInputBytes: 32 }))
      .toThrow(expect.objectContaining({ code: 'input-too-large' }));
  });

  it('rejects 5000 empty entries without inflating them', () => {
    const entries = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`media/${i}`, new Uint8Array()]));
    expect(() => unzipReadingPack(zip(entries))).toThrow(expect.objectContaining({ code: 'entry-limit' }));
  });

  it('rejects declared oversize entries without allocating their expanded size', () => {
    const bytes = declareExpandedSizes(tinyZip(), MAX_READING_PACK_ENTRY_BYTES + 1);
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'entry-too-large' }));
  });

  it('counts actual expanded bytes even when both headers understate the size', () => {
    const bytes = declareExpandedSizes(zip({ 'media/a': new Uint8Array(65536).fill(97) }), 1);
    expect(() => unzipReadingPack(bytes, { ...DEFAULT_LIMITS, maxEntryBytes: 1024 }))
      .toThrow(expect.objectContaining({ code: 'entry-too-large' }));
  });

  it.each([false, true])('enforces total expansion (understated headers=%s)', (understate) => {
    const bytes = zip(Object.fromEntries(['a', 'b', 'c'].map(id => [`media/${id}`, new Uint8Array(512 * 1024)])));
    if (understate) {
      const view = viewOf(bytes);
      const last = centralOffsets(bytes)[2];
      view.setUint32(last + 24, 1, true);
      view.setUint32(view.getUint32(last + 42, true) + 22, 1, true);
    }
    expect(() => unzipReadingPack(bytes, {
      ...DEFAULT_LIMITS, maxEntryBytes: 1024 * 1024, maxUncompressedBytes: 1024 * 1024 + 16,
    })).toThrow(expect.objectContaining({ code: 'uncompressed-limit' }));
  });

  it('rejects understated entries that stay within the budget but do not match the directory', () => {
    expect(() => unzipReadingPack(declareExpandedSizes(tinyZip(), 1)))
      .toThrow(expect.objectContaining({ code: 'truncated-zip' }));
  });

  it('checks JSON size before decoding or parsing it', () => {
    const bytes = zip({ 'manifest.json': new Uint8Array(256).fill(32) });
    expect(() => parseReadingPackBytes(bytes, { ...DEFAULT_LIMITS, maxJsonBytes: 128 }))
      .toThrow(expect.objectContaining({ code: 'entry-too-large', message: expect.stringContaining('JSON') }));
  });

  it.each(['', '/media/a', 'media/../a', 'media/./a', 'media//a', 'media\\a',
    'C:/a', 'media/a\0b', 'elsewhere/a', `media/${'a'.repeat(256)}`, 'media/a/b'])('rejects unsafe entry %j', path => {
    expect(() => unzipReadingPack(zip({ [path]: strToU8('test') })))
      .toThrow(expect.objectContaining({ code: 'invalid-path' }));
  });

  it('rejects duplicate names even when their directory offsets are distinct', () => {
    const bytes = zip({ 'media/a': strToU8('one'), 'media/b': strToU8('two') });
    const view = viewOf(bytes);
    const offset = centralOffsets(bytes)[1];
    bytes[offset + 46 + 6] = 97;
    bytes[view.getUint32(offset + 42, true) + 30 + 6] = 97;
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'duplicate-entry' }));
  });

  it('rejects unsupported compression before starting the decoder', () => {
    const bytes = tinyZip();
    const view = viewOf(bytes);
    view.setUint16(8, 99, true);
    view.setUint16(centralOffsets(bytes)[0] + 10, 99, true);
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'unsupported-compression' }));
  });

  it('rejects encrypted entries', () => {
    const bytes = tinyZip();
    const view = viewOf(bytes);
    view.setUint16(6, 1, true);
    view.setUint16(centralOffsets(bytes)[0] + 8, 1, true);
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'invalid-format' }));
  });

  it.each([1, 22, 40])('rejects a ZIP missing its last %s bytes', missing => {
    expect(() => unzipReadingPack(tinyZip().subarray(0, -missing)))
      .toThrow(expect.objectContaining({ code: 'truncated-zip' }));
  });

  it('requires a complete central directory, not just a valid EOCD', () => {
    const bytes = tinyZip();
    bytes[centralOffsets(bytes)[0]] = 0;
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'truncated-zip' }));
  });

  it('rejects local paths that disagree with the central directory', () => {
    const bytes = tinyZip();
    bytes[30 + 6] = 98;
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'invalid-format' }));
  });

  it('rejects corrupt DEFLATE data', () => {
    const bytes = tinyZip();
    const view = viewOf(bytes);
    const dataStart = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[dataStart] = 7;
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'truncated-zip' }));
  });

  it('rejects corrupted stored bytes even when size and ZIP structure remain valid', () => {
    const bytes = zipSync({ 'media/a': strToU8('test') }, { level: 0 });
    bytes[30 + 7] ^= 1;
    expect(() => unzipReadingPack(bytes)).toThrow(expect.objectContaining({ code: 'invalid-format' }));
  });
});
