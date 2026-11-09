import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { requireIsolatedNativeArtifact } from './native-test-artifact.mjs';

test('retired test exits before touching production sentinel directories or launching an app', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ste-test-retirement-'));
  try {
    const profile = path.join(root, 'com.ste.explorer'); mkdirSync(profile);
    const sentinel = path.join(profile, 'config.json'); writeFileSync(sentinel, 'production sentinel');
    const result = spawnSync(process.execPath, ['scripts/smoke-tauri.cjs'], { env: { ...process.env, APPDATA: root, LOCALAPPDATA: root }, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /RETIRED_UNSAFE_PROFILE_TEST/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'production sentinel');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native launch guard refuses production identity and missing receipt before any mutation', async () => {
  await assert.rejects(requireIsolatedNativeArtifact('com.ste.explorer'), /independent test identifier/);
  await assert.rejects(requireIsolatedNativeArtifact('com.ste.explorer.chat1107', ''), /STE_NATIVE_TEST_RECEIPT/);
  const root = mkdtempSync(path.join(tmpdir(), 'ste-test-receipt-'));
  try {
    const receipt = path.join(root, 'receipt.json');
    writeFileSync(receipt, JSON.stringify({ schema: 1, identifier: 'com.ste.explorer' }));
    await assert.rejects(requireIsolatedNativeArtifact('com.ste.explorer.chat1107', receipt), /identifier mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native launch guard accepts the copied artifact and rejects a changed executable', async () => {
  const base = path.resolve('.cache/native-test-artifacts'); mkdirSync(base, { recursive: true });
  const root = mkdtempSync(path.join(base, 'guard-test-'));
  assert.equal(path.dirname(root), base);
  try {
    const executable = path.join(root, 'fixture.exe'), receipt = path.join(root, 'receipt.json');
    writeFileSync(executable, 'inert fixture, never executed');
    writeFileSync(receipt, JSON.stringify({ schema: 1, identifier: 'com.ste.explorer.guard-test', executable, sha256: createHash('sha256').update(readFileSync(executable)).digest('hex') }));
    assert.equal(await requireIsolatedNativeArtifact('com.ste.explorer.guard-test', receipt), executable);
    writeFileSync(executable, 'changed fixture');
    await assert.rejects(requireIsolatedNativeArtifact('com.ste.explorer.guard-test', receipt), /changed since its isolated build/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
