import { defineConfig } from '@playwright/test';
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/pwa.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4188/running/', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'npm run preview -- --port 4188 --base /running/', url: 'http://127.0.0.1:4188/running/', reuseExistingServer: !process.env.CI },
});
