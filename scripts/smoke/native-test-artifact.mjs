import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Called before writes or launch. The receipt is emitted by build-isolated-native.mjs. */
export async function requireIsolatedNativeArtifact(identifier, receiptPath = process.env.STE_NATIVE_TEST_RECEIPT) {
  if (!/^com\.ste\.explorer\.[a-z0-9-]+$/.test(identifier)) throw Error('An independent test identifier is required');
  if (!receiptPath) throw Error('STE_NATIVE_TEST_RECEIPT is required; rebuild with scripts/smoke/build-isolated-native.mjs');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  if (receipt.identifier !== identifier || receipt.schema !== 1) throw Error('Test artifact identifier mismatch');
  const executable = await realpath(receipt.executable);
  const root = await realpath(path.resolve('.cache/native-test-artifacts'));
  const relative = path.relative(root, executable);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test executable must be inside the isolated artifact directory');
  const hash = createHash('sha256').update(await readFile(executable)).digest('hex');
  if (hash !== receipt.sha256) throw Error('Test executable changed since its isolated build');
  return executable;
}
