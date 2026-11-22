import { defineConfig } from '@playwright/test';

// Uploads always go to the local S3Mock (`pnpm e2e:s3`), never to the production R2 bucket.
const S3MOCK_VARS = {
  R2_S3_ENDPOINT: 'http://localhost:9090',
  R2_ACCESS_KEY_ID: 'e2e',
  R2_SECRET_ACCESS_KEY: 'e2e',
};
const wranglerVars = Object.entries(S3MOCK_VARS)
  .map(([key, value]) => `--var ${key}:${value}`)
  .join(' ');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8787',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  webServer: {
    command: `pnpm cf:preview ${wranglerVars}`,
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
  reporter: process.env.CI ? 'github' : 'list',
});
