import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: '.cache/production-browser',
  use: {
    baseURL: 'http://127.0.0.1:4194',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4194 --strictPort',
    url: 'http://127.0.0.1:4194',
    reuseExistingServer: false,
  },
});
