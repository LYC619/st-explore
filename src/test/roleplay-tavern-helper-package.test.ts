// @vitest-environment node
import { expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { existsSync, readFileSync } from 'node:fs';
import { readTavernHelperZip, linkTavernHelper } from '@/lib/roleplay/tavern-helper-package';

it('rejects ambiguous or unverified helper packages', () => {
  expect(() => readTavernHelperZip(zipSync({ 'a/manifest.json': strToU8('{}'), 'b/manifest.json': strToU8('{}') }))).toThrow(/只有一个/);
  expect(() => readTavernHelperZip(zipSync({ 'a/manifest.json': strToU8('{}') }))).toThrow(/原版/);
});
it.skipIf(!existsSync('.cache/helper.zip'))('links the verified original package and its editor/iframe assets', () => {
  const pkg = readTavernHelperZip(new Uint8Array(readFileSync('.cache/helper.zip')));
  expect(pkg.version).toBe('4.11.3');
  const linked = linkTavernHelper(pkg, 'http://localhost', 'blob:editor', 'blob:tailwind');
  expect(linked).not.toContain('../../../../../'); expect(linked).not.toContain('../lib/jsoneditor.js');
  expect(linked).toContain('blob:editor'); expect(linked).toContain('blob:tailwind');
});
