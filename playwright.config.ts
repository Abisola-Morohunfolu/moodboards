import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'node scripts/browser-api.mjs',
      url: 'http://127.0.0.1:3011/health/ready',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command:
        'VITE_API_URL=http://127.0.0.1:3011 pnpm --filter @moodboard/web build && WEB_PORT=3010 pnpm --filter @moodboard/web start',
      url: 'http://127.0.0.1:3010/help',
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
