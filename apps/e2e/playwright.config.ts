import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3110);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4110);
const devServer = process.env.E2E_WEB !== 'start';

/**
 * Runs against a fresh, seeded copy of the system (see stack.mjs). Tests share that one database,
 * so they run in order and each creates the orders it needs.
 * Locally the installed Google Chrome is used; CI installs Playwright's Chromium (E2E_BROWSER=chromium).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // `next dev` compiles each page on first visit.
  timeout: devServer ? 120_000 : 45_000,
  expect: { timeout: devServer ? 30_000 : 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome' } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome' },
      // The storefront is mobile-first; staff screens are checked on desktop.
      testMatch: /storefront\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'node stack.mjs',
    url: `http://localhost:${WEB_PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_WEB_PORT: String(WEB_PORT), E2E_API_PORT: String(API_PORT) },
  },
});
