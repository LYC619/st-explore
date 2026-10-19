import { expect, it } from 'vitest';
import { buildPortraitExampleRule, extractPortraitExample } from '@/lib/portrait-example-rule';

it('learns literal delimiters, allows varying field lengths and does not treat regex punctuation as code', () => {
  const sample = '姓名[艾] => 图片(abcd.png)';
  const rule = buildPortraitExampleRule(sample, { start: sample.indexOf('艾'), end: sample.indexOf('艾') + 1 }, { start: sample.indexOf('abcd'), end: sample.indexOf('.png') + 4 });
  expect(extractPortraitExample('姓名[乔伊·很长名字] => 图片(abcdefgh.avif)', rule)).toEqual({ name: '乔伊·很长名字', file: 'abcdefgh.avif' });
  expect(() => extractPortraitExample('姓名[艾] => 图片(abcd.png) => 图片(efgh.png)', rule)).toThrow(/歧义|分隔/);
});
it('supports a sample without a name and bounds input lengths', () => {
  const sample = '图=(abcd.png)';
  const rule = buildPortraitExampleRule(sample, null, { start: 3, end: 11 });
  expect(extractPortraitExample('图=(efgh.png)', rule)).toEqual({ file: 'efgh.png' });
  expect(() => extractPortraitExample('x'.repeat(10_000), rule)).toThrow(/过长/);
  expect(() => buildPortraitExampleRule(sample, null, { start: 0, end: 0 })).toThrow(/片段/);
});
