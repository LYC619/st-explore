import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runSteps, verificationSteps } from './verify.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ste-verify-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const step = (name, code) => ({ name, command: process.execPath, args: ['-e', code] });

test('runs in order, records durations and keeps successful command output in logs', async t => {
  const root = await fixture(t), reports = [];
  const result = await runSteps([
    step('first', 'console.log("fixture success")'),
    step('second', 'console.log("fixture next")'),
  ], { cwd: root, logDir: root, report: line => reports.push(line) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.results.map(row => row.name), ['first', 'second']);
  assert.ok(result.results.every(row => row.seconds >= 0));
  assert.equal(await readFile(join(root, 'first.log'), 'utf8'), 'fixture success\n');
  assert.equal(reports.length, 2);
  assert.ok(reports.every(line => line.startsWith('PASS')));
  assert.deepEqual(JSON.parse(await readFile(join(root, 'results.json'), 'utf8')), result.results);
});

test('returns the failing exit code and does not run later checks', async t => {
  const root = await fixture(t);
  const result = await runSteps([
    step('failure', 'console.error("fixture failure"); process.exit(7)'),
    step('must-not-run', 'throw new Error("should not execute")'),
  ], { cwd: root, logDir: root, report: () => {} });
  assert.equal(result.exitCode, 7);
  assert.equal(result.results.length, 1);
  assert.match(await readFile(join(root, 'failure.log'), 'utf8'), /fixture failure/);
  await assert.rejects(readFile(join(root, 'must-not-run.log')), { code: 'ENOENT' });
});

test('an unavailable command fails the gate', async t => {
  const root = await fixture(t);
  const result = await runSteps([{ name: 'missing', command: join(root, 'does-not-exist'), args: [] }],
    { cwd: root, logDir: root, report: () => {} });
  assert.notEqual(result.exitCode, 0);
});

test('web gate is the prefix of the full gate and builds assets before Rust', () => {
  const web = verificationSteps(true), full = verificationSteps();
  assert.deepEqual(full.slice(0, web.length), web);
  assert.equal(web.at(-1).name, 'build');
  assert.deepEqual(full.slice(web.length).map(row => row.name), ['rust-tests', 'clippy']);
});
