import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/api/(.*)$': '<rootDir>/src/api/$1',
    '^@/modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/cli/(.*)$': '<rootDir>/src/cli/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};

export default config;
