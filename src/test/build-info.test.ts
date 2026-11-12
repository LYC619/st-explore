import { describe, expect, it } from 'vitest';
import { formatBuildInfo } from '@/lib/build-info';

describe('visible build identity', () => {
  it('uses China calendar date and marks uncommitted production changes', () => {
    expect(formatBuildInfo({version:'0.9.9',commit:'abc123',dirty:true,builtAt:'2026-11-11T18:00:00Z'}))
      .toBe('0.9.9 · abc123 · 2026-11-12 · 含未提交改动');
  });
  it('distinguishes unavailable metadata from a clean build', () => {
    expect(formatBuildInfo({}, '0.9.9')).toBe('0.9.9 · 提交未知 · 时间未知 · 改动状态未知');
    expect(formatBuildInfo({version:'0.9.9',commit:'abc',dirty:false,builtAt:'invalid'}))
      .toBe('0.9.9 · abc · 时间未知');
  });
});
