import { expect, it, vi } from 'vitest';
import { createTokenCountCache } from '@/lib/roleplay/token-count-cache';

it('reuses exact counts including zero, recalculates edits, and releases on clear', () => {
  const encode = vi.fn((text: string) => text.length);
  const cache = createTokenCountCache(encode);
  expect(cache.count('')).toBe(0); expect(cache.count('')).toBe(0);
  expect(cache.count('正文')).toBe(2); expect(cache.count('正文')).toBe(2);
  expect(cache.count('正文。')).toBe(3);
  expect(encode).toHaveBeenCalledTimes(3);
  cache.clear(); cache.count('正文'); expect(encode).toHaveBeenCalledTimes(4);
});

it('evicts least recently used text by both character and entry limits, bypassing oversized input', () => {
  const encode = vi.fn((text: string) => text.length);
  const cache = createTokenCountCache(encode, 5, 2);
  cache.count('aa'); cache.count('bb'); cache.count('aa'); cache.count('ccc');
  encode.mockClear(); cache.count('aa'); expect(encode).not.toHaveBeenCalled();
  cache.count('bb'); expect(encode).toHaveBeenCalledTimes(1);
  cache.count('123456'); cache.count('123456'); expect(encode).toHaveBeenCalledTimes(3);
  const small = createTokenCountCache(encode, 100, 1);
  small.count('a'); small.count('b'); encode.mockClear(); small.count('a');
  expect(encode).toHaveBeenCalledOnce();
});
