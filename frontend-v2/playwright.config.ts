import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/artifacts',

  use: {
    baseURL: 'http://localhost:8082/v2',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup — run first, manual login saves session
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      timeout: 180_000, // 3 minutes for manual login
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Main regression tests — uses saved auth session
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
    // Run without auth (landing page tests)
    {
      name: 'no-auth',
      use: {
        ...devices['Desktop Chrome'],
      },
      testMatch: /\/(a11y|landing)\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8082/v2',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
