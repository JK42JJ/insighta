import { defineConfig } from 'vitest/config';
import path from 'path';

// Local worker cap: 14 cores would otherwise start 14 workers alongside Jest,
// OrbStack and the dev servers on the 24 GB dev machine. CI keeps the default.
const LOCAL_MAX_WORKERS = 4;
const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    environment: 'happy-dom',
    ...(isCI ? {} : { maxWorkers: LOCAL_MAX_WORKERS }),
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'tests/**/*.spec.ts'],
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@app': path.resolve(__dirname, './src/app'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@widgets': path.resolve(__dirname, './src/widgets'),
      '@features': path.resolve(__dirname, './src/features'),
      '@entities': path.resolve(__dirname, './src/entities'),
      '@shared': path.resolve(__dirname, './src/shared'),
      'virtual:pwa-register/react': path.resolve(__dirname, './src/__tests__/__mocks__/pwa-register.ts'),
    },
  },
});
