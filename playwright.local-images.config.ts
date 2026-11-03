import { defineConfig } from '@playwright/test';
import config from './playwright.config';
export default defineConfig({ ...config, testMatch: '**/local-images.spec.ts', testIgnore: [], outputDir: 'test-results/local-images' });
