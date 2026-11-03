import { defineConfig, devices } from '@playwright/test';
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/e2e',
  testIgnore: ['**/pwa.spec.ts', '**/local-images.spec.ts'],
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 4187', url: 'http://127.0.0.1:4187', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } },
    { name: 'chromium-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
});
