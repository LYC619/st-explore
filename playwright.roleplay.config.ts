import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/roleplay',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: '.cache/roleplay-browser',
  use: {
    baseURL: 'http://127.0.0.1:4178',
    viewport: { width: 1360, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
  },
  webServer: {
    command: 'node scripts/tavern/roleplay-test-server.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
