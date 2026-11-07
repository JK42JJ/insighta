import { defineConfig, devices } from '@playwright/test';

// Design parity run for the morning feed (오늘의 픽): compares /morning-cards?fixture=1
// with the delivered reference page, state by state. Served from a production build.
export default defineConfig({
  testDir: './tests',
  testMatch: /morning-feed\.parity\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/parity-report' }]],
  outputDir: 'test-results/parity-artifacts',
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
