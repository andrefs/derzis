import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: 'tests',
  testMatch: /(.+\.)?(test|spec)\.[jt]s/,
  workers: 1, // Run tests sequentially to avoid server overload
  use: {
    baseURL: 'http://localhost:4173',
    actionTimeout: 10000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  expect: {
    timeout: 10000
  },
  timeout: 60000,
  fullyParallel: false, // Ensure sequential execution
  // Configure retries for flaky tests
  retries: 2
};

export default config;
