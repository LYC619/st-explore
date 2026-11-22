import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { packRelease } from './release-pack.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ste-pack-synthetic-'));
  await mkdir(path.join(root, 'src-tauri'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.9.9' }));
  await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'ST Explorer', mainBinaryName: 'STE', identifier: 'com.ste.explorer' }));
  return root;
}
const now = new Date('2026-11-12T18:00:00Z');
const info = { schema: 1, version: '0.9.9', commit: 'abc123abc123', dirty: true, dirtyFiles: ['src/example.ts'], builtAt: now.toISOString(), inputPaths: ['src'] };
const outputName = '2026-11-13-fixture';

test('rejects unsafe tags and an existing delivery directory before building', async () => {
  const root = await fixture(); let calls = 0;
  const options = { root, now, collect: () => info, execute: async () => { calls++; } };
  for (const tag of ['../outside', '', 'has space', 'x/y', 'x\\y']) await assert.rejects(packRelease(tag, options), /标签/);
  const dir = path.join(root, 'release', outputName); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'preserve.txt'), 'existing delivery');
  await assert.rejects(packRelease('fixture', options), /已存在/);
  assert.equal(calls, 0); assert.equal(await readFile(path.join(dir, 'preserve.txt'), 'utf8'), 'existing delivery');
});

test('freezes one receipt, packages two outputs and records actual bytes without running them', async () => {
  const root = await fixture(), calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args });
    if (!args.includes('build')) return 'synthetic-tool 1.0';
    assert.equal(options.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS, '256');
    const receiptText = await readFile(options.env.STE_BUILD_INFO_FILE, 'utf8');
    assert.deepEqual(JSON.parse(receiptText), info);
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist/build-info.json'), receiptText);
    const target = options.env.CARGO_TARGET_DIR;
    await mkdir(path.join(target, 'release/bundle/nsis'), { recursive: true });
    await writeFile(path.join(target, 'release/STE.exe'), 'synthetic executable:' + receiptText.replace(/[\r\n]/g, ''));
    await writeFile(path.join(target, 'release/bundle/nsis/ST Explorer_0.9.9_x64-setup.exe'), 'synthetic installer');
    return '';
  };
  const result = await packRelease('fixture', { root, now, execute, collect: () => info });
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'build-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.buildInfo, info); assert.equal(manifest.status, 'packaged-not-run');
  assert.equal(path.basename(result.directory), outputName); assert.equal(manifest.artifacts.length, 2);
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(path.join(result.directory, artifact.file));
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(artifact.bytes, bytes.length);
  }
  assert.ok((await readdir(result.directory)).includes('使用与体验更新.md'));
  assert.ok(calls.every(call => !call.command.endsWith('.exe') || /node\.exe$/i.test(call.command)));
});

test('failed builds keep evidence and cannot create a completed manifest or overwrite a retry', async () => {
  const root = await fixture();
  const options = { root, now, collect: () => info, execute: async (_command, args) => {
    if (args.includes('build')) throw new Error('synthetic build failed'); return 'synthetic-tool';
  } };
  await assert.rejects(packRelease('fixture', options), /synthetic build failed/);
  const dir = path.join(root, 'release', outputName);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'build-execution.json'), 'utf8')).status, 'failed');
  await assert.rejects(readFile(path.join(dir, 'build-manifest.json')), { code: 'ENOENT' });
  await assert.rejects(packRelease('fixture', options), /已存在/);
});

test('supports portableOnly mode with --no-bundle and records single portable artifact', async () => {
  const root = await fixture(), calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args });
    if (!args.includes('build')) return 'synthetic-tool 1.0';
    assert.ok(args.includes('--no-bundle'));
    const receiptText = await readFile(options.env.STE_BUILD_INFO_FILE, 'utf8');
    await mkdir(path.join(root, 'dist'), { recursive: true });
    await writeFile(path.join(root, 'dist/build-info.json'), receiptText);
    const target = options.env.CARGO_TARGET_DIR;
    await mkdir(path.join(target, 'release'), { recursive: true });
    await writeFile(path.join(target, 'release/STE.exe'), 'synthetic portable:' + receiptText.replace(/[\r\n]/g, ''));
    return '';
  };
  const result = await packRelease('fixture', { root, now, execute, collect: () => info, portableOnly: true });
  const manifest = JSON.parse(await readFile(path.join(result.directory, 'build-manifest.json'), 'utf8'));
  assert.equal(manifest.buildSettings.bundle, 'none');
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].kind, 'portable');
  const bytes = await readFile(path.join(result.directory, manifest.artifacts[0].file));
  assert.equal(manifest.artifacts[0].sha256, createHash('sha256').update(bytes).digest('hex'));
});
