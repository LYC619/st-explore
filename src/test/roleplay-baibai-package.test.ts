import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { BAIBAI_PIN, readBaiBaiZip, validateBaiBaiPackage, linkBaiBaiModule } from '@/lib/roleplay/baibai-package';

it('rejects an unknown plugin build before any source can be executed', () => {
  const value = { id: 'ST-BaiBai-Book' as const, version: '1.2.7' as const, sourceCommit: BAIBAI_PIN.commit, installedAt: 1,
    files: { 'manifest.json': JSON.stringify({ version: '1.2.7', js: 'dist/index.js?ver=1.2.7', generate_interceptor: 'bbs_generateInterceptor' }),
      'dist/index.js': 'globalThis.unverified = true;', 'dist/index.css': '' } };
  expect(() => validateBaiBaiPackage(value)).toThrow(/原版/);
  expect(() => linkBaiBaiModule(value)).toThrow(/原版/);
});

it('rejects ambiguous packages and traversal prefixes without extracting files to disk', () => {
  const manifest = strToU8('{}');
  expect(() => readBaiBaiZip(zipSync({ 'first/manifest.json': manifest, 'second/manifest.json': manifest }))).toThrow(/仅有一个/);
  expect(() => readBaiBaiZip(zipSync({ '../plugin/manifest.json': manifest }))).toThrow();
});
