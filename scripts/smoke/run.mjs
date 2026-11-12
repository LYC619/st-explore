import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { runSteps } from '../verify.mjs';

const groups = [
  { production: false, port: 4275, scripts: ['maintenance-reader'] },
  { production: true, port: 4276, scripts: ['route-assets'] },
];
const selected = process.argv.slice(2);
if (selected.some(name => !groups.some(group => group.scripts.includes(name)))) throw new Error('Unknown smoke check');
const logDir = resolve('.cache/smoke', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(logDir, { recursive: true });
const built = await runSteps([
  { name: 'native-guard', command: process.execPath, args: ['--test', 'scripts/smoke/native-test-safety.test.mjs'] },
  { name: 'build', command: process.execPath, args: ['node_modules/vite/bin/vite.js', 'build'] },
], { logDir });
if (built.exitCode) process.exit(built.exitCode);

for (const group of groups) {
  const scripts = group.scripts.filter(name => !selected.length || selected.includes(name));
  if (!scripts.length) continue;
  const label = group.production ? 'production' : 'development';
  const output = await open(join(logDir, `server-${label}.log`), 'w');
  const base = `http://127.0.0.1:${group.port}`;
  // Keep the server in its own process, with bounded startup and captured diagnostics.
  const args = group.production
    ? ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(group.port), '--strictPort']
    : ['--experimental-strip-types', 'scripts/tavern/roleplay-test-server.mjs'];
  const server = spawn(process.execPath, args,
    { stdio: ['ignore', output.fd, output.fd], windowsHide: true, env: { ...process.env, STE_TEST_PORT: String(group.port) } });
  let stopped = false, launchError;
  const closed = new Promise(resolveClosed => { server.once('close', () => { stopped = true; resolveClosed(); }); });
  server.once('error', error => { launchError = error; });
  try {
    let ready = false;
    for (const deadline = Date.now() + 120000; Date.now() < deadline && !stopped && !launchError;) {
      try { const response = await fetch(base, { signal: AbortSignal.timeout(1500) }); await response.body?.cancel(); if (response.ok) { ready = true; break; } } catch { /* still starting */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 200));
    }
    if (!ready) throw new Error(`Smoke ${label} server did not start; inspect ${logDir}`);
    process.env.STE_SMOKE_URL = base;
    const result = await runSteps(scripts.map(name => ({ name, command: process.execPath, args: [`scripts/smoke/${name}.mjs`] })), { logDir: join(logDir, label) });
    if (result.exitCode) { process.exitCode = result.exitCode; break; }
  } finally {
    server.kill(); await closed; await output.close();
    console.log(`Smoke logs: ${logDir}`);
  }
}
