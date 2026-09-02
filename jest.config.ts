import type { Config } from 'jest';

// Measured 2026-09-02 on the 24 GB M4 Pro dev machine: one ts-jest worker peaks
// at ~2.0 GB (each worker builds its own type-check program), so Jest's default
// of cores - 1 = 13 workers peaks near 26 GB and pushes the machine into swap.
// CI keeps Jest's default; the cap applies to local runs only.
const LOCAL_MAX_WORKERS = 3;
const isCI = !!process.env['CI'];

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  ...(isCI ? {} : { maxWorkers: LOCAL_MAX_WORKERS }),
  // A smoke suite boots a full Fastify app in beforeAll. Measured cold boot is
  // 1.7-2.1 s idle, and several suites booting at once push past Jest's 5 s
  // default long before anything is actually wrong.
  testTimeout: 30000,
  roots: ['<rootDir>/tests', '<rootDir>/src/skills'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/skills/**/__tests__/*.test.ts',
  ],
  moduleNameMapper: {
    '^@/api/(.*)$': '<rootDir>/src/api/$1',
    '^@/modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/cli/(.*)$': '<rootDir>/src/cli/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/skills/(.*)$': '<rootDir>/src/skills/$1',
    '^@/prompts/(.*)$': '<rootDir>/src/prompts/$1',
    '^@scalar/fastify-api-reference$': '<rootDir>/tests/__mocks__/scalar.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};

export default config;
