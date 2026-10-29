import { defineConfig, devices } from '@playwright/test';

// Post-deploy integrity tests against the staging environment.
//
// Unlike playwright.config.ts there is no dev server and no saved session:
// every spec signs in through the real UI with the staging test account, so a
// passing run means the deployed bundle, the staging API and the staging
// Supabase project work together. BASE_URL is required -- a default would let
// this run against whatever happens to be on localhost and report green.
const TEST_TIMEOUT_MS = 60_000;
const EXPECT_TIMEOUT_MS = 15_000;
const CI_RETRIES = 1;

const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error('BASE_URL is required, e.g. BASE_URL=https://stg.insighta.one');
}

export default defineConfig({
  testDir: './tests/stg',
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? CI_RETRIES : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/stg-report' }]],
  outputDir: 'test-results/stg-artifacts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
