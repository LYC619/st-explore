// Builds an independent identity; never launches STE or reads/writes user app data.
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const identifier = process.argv[2];
if (!/^com\.ste\.explorer\.[a-z0-9-]+$/.test(identifier ?? '')) throw Error('Usage: node scripts/smoke/build-isolated-native.mjs com.ste.explorer.<test-name>');
const dir = path.resolve('.cache/native-test-artifacts', randomUUID());
await mkdir(dir, { recursive: true });
const config = path.join(dir, 'tauri-test.json');
const targetDir = path.resolve('.cache/native-test-build', identifier);
await writeFile(config, JSON.stringify({ identifier, build: { beforeBuildCommand: 'npm run build' }, bundle: { active: false } }));
const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--debug', '--no-bundle', '--config', config], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, CARGO_TARGET_DIR: targetDir },
});
await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Isolated build exited ${code}`))); });
const executable = path.join(dir, 'STE.exe');
await copyFile(path.join(targetDir, 'debug/STE.exe'), executable);
const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex');
const receipt = path.join(dir, 'receipt.json');
await writeFile(receipt, JSON.stringify({ schema: 1, identifier, executable, sha256, builtAt: new Date().toISOString() }, null, 2));
console.log(`STE_NATIVE_TEST_RECEIPT=${receipt}`);
