import { runSteps } from './verify.mjs';

const result = await runSteps([
  { name: 'smoke', command: process.execPath, args: ['scripts/smoke/run.mjs'] },
  { name: 'roleplay-browser', command: process.execPath, args: ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.roleplay.config.ts'] },
  { name: 'production-browser', command: process.execPath, args: ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.production.config.ts'] },
]);
console.log(`E2E logs: ${result.logDir}`);
process.exitCode = result.exitCode;
