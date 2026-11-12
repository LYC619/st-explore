import { spawn } from 'node:child_process';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nodeStep = (name, args) => ({ name, command: process.execPath, args });
export function verificationSteps(webOnly = false) {
  const steps = [
    nodeStep('version', ['scripts/sync-version.mjs', '--check']),
    nodeStep('script-tests', ['--test', 'scripts/sync-version.test.mjs', 'scripts/verify.test.mjs', 'scripts/build-info.test.mjs']),
    nodeStep('lint', ['node_modules/eslint/bin/eslint.js', '.']),
    nodeStep('types-app', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.app.json', '--noEmit']),
    nodeStep('types-node', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json', '--noEmit']),
    nodeStep('vitest', ['node_modules/vitest/vitest.mjs', 'run', '--reporter=dot']),
    nodeStep('tavern-source', ['--test', 'scripts/tavern/*.test.mjs']),
    nodeStep('smoke-tests', ['--test', 'scripts/smoke/*.test.mjs']),
    nodeStep('build', ['node_modules/vite/bin/vite.js', 'build']),
  ];
  if (!webOnly) steps.push(
    { name: 'rust-tests', command: 'cargo', args: ['test', '--lib'], cwd: 'src-tauri' },
    { name: 'clippy', command: 'cargo', args: ['clippy', '--lib', '--', '-D', 'warnings'], cwd: 'src-tauri' },
  );
  return steps;
}

export async function runSteps(steps, { cwd = root, logDir, report = console.log } = {}) {
  logDir ??= join(cwd, '.cache', 'verify', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(logDir, { recursive: true });
  const results = [];
  for (const step of steps) {
    const started = Date.now();
    const logPath = join(logDir, `${step.name}.log`);
    const file = await open(logPath, 'w');
    let exitCode;
    try {
      exitCode = await new Promise(resolveExit => {
        const child = spawn(step.command, step.args, {
          cwd: resolve(cwd, step.cwd ?? '.'), stdio: ['ignore', file.fd, file.fd], windowsHide: true,
        });
        child.once('error', () => resolveExit(1));
        child.once('close', code => resolveExit(code ?? 1));
      });
    } finally { await file.close(); }
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    results.push({ name: step.name, exitCode, seconds, logPath });
    await writeFile(join(logDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    report(`${exitCode === 0 ? 'PASS' : 'FAIL'} ${step.name} (${seconds}s)${exitCode ? ` — ${logPath}` : ''}`);
    if (exitCode !== 0) return { exitCode, results, logDir };
  }
  return { exitCode: 0, results, logDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2).filter(arg => arg !== '--web');
  if (unknown.length) throw new Error('Usage: node scripts/verify.mjs [--web]');
  const result = await runSteps(verificationSteps(process.argv.includes('--web')));
  console.log(`Verification logs: ${result.logDir}`);
  process.exitCode = result.exitCode;
}
