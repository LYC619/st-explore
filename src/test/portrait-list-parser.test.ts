import { expect, it } from 'vitest';
import { parsePortraitList } from '@/lib/portrait-list-parser';
import { portraitExamples } from './fixtures/portrait-lists';

it.each(portraitExamples)('automatically parses %s', (source, name, file) => {
  expect(parsePortraitList(source).items).toEqual([expect.objectContaining({ name, file, url: `https://files.catbox.moe/${file}`, line: 1 })]);
});
it('recognizes complete URLs before colons and preserves signed escaped URLs', () => {
  const result = parsePortraitList('https://files.catbox.moe/hv26xb.png\n笑： https://img.example/a%20b.webp?sig=a%2Fb#ignored\nabcd.AVIF');
  expect(result.items.map(item => [item.name, item.url])).toEqual([
    ['hv26xb', 'https://files.catbox.moe/hv26xb.png'], ['笑', 'https://img.example/a%20b.webp?sig=a%2Fb'], ['abcd', 'https://files.catbox.moe/abcd.AVIF'],
  ]);
});
it('keeps valid rows, skips wrappers/duplicate URLs and reports original malformed line numbers', () => {
  const result = parsePortraitList('<portraits>\n不开心: 不开心_hv26xb.png\n坏行\nAndrea_happy_2ctstv.png\n\n</portraits>\nhttps://files.catbox.moe/hv26xb.png');
  expect(result.items.map(item => item.name)).toEqual(['不开心', 'Andrea_happy']);
  expect(result.failed).toEqual([expect.objectContaining({ line: 3, text: '坏行', reason: expect.any(String) })]);
  expect(result.skipped).toEqual([1, 5, 6, 7]);
});
it('allocates globally unique names without taking a later explicit suffix', () => {
  const result = parsePortraitList('名称: abcd.png\n名称: efgh.png\n名称_2: ijkl.png');
  expect(result.items.map(item => item.name)).toEqual(['名称', '名称_3', '名称_2']);
});
it('rejects credential URLs, unsupported extensions and bounds source bytes and item counts', () => {
  expect(parsePortraitList('https://u:p@img.example/a.png\nhttps://x.test/file.txt\n这一行没有图片').failed).toHaveLength(3);
  expect(() => parsePortraitList('中'.repeat(180_000))).toThrow(/输入|分批/);
  expect(() => parsePortraitList(Array.from({ length: 1001 }, (_, i) => `https://x.test/${i}.png`).join('\n'))).toThrow(/1000/);
});
