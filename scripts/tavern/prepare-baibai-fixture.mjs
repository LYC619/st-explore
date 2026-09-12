import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { prepareCacheDirectory } from './cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const commit = '5c8a6b60d8c1185e169c46d43f63fce7d35d8583';
const files = ['manifest.json', 'dist/index.js', 'dist/index.css', 'PUBLIC_API.md'];
const hashes = {
  'dist/index.js': '44254f4049f19b43e3c548cd1329530d33142e3e65218cf7735bafcdafd8ac1f',
  'dist/index.css': '075d0810c8c60645fe2ec816bd8579da55e97bdb537654147256bb71982ed99f',
};
const entries = {};
for (const file of files) {
  let bytes;
  try { bytes = await readFile(path.join(root, '_reference/projects/baibai', file)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://raw.githubusercontent.com/baibai-git/ST-BaiBai-Book/${commit}/${file}`);
    if (!response.ok) throw new Error(`Cannot obtain original BaiBai fixture: ${file} (${response.status})`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (hashes[file] && createHash('sha256').update(bytes).digest('hex') !== hashes[file]) throw new Error(`BaiBai fixture hash mismatch: ${file}`);
  entries[`ST-BaiBai-Book-${commit}/${file}`] = bytes;
}
const output = await prepareCacheDirectory(root, 'fixtures/baibai');
await writeFile(path.join(output, 'package.zip'), zipSync(entries));
process.stdout.write(`Original BaiBai 1.2.7 fixture: ${path.join(output, 'package.zip')}\n`);
