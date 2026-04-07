import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
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
    '^@scalar/fastify-api-reference$': '<rootDir>/tests/__mocks__/scalar.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};

export default config;
