import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // Only this runner's spec. The Jest file beside it belongs to the other one.
  testMatch: 'playwright.spec.ts',
  reporter: [['list']],
  use: { headless: true },
});
