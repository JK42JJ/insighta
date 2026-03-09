import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

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
    // CI: use preview server (serves production build with base: '/v2/')
    // Local: use dev server (base: '/', but BrowserRouter handles /v2/ routing)
    command: isCI ? 'npx vite preview --port 8082' : 'npm run dev',
    url: 'http://localhost:8082/v2',
    reuseExistingServer: !isCI,
    timeout: isCI ? 30_000 : 10_000,
  },
});
