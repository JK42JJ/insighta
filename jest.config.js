module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    }],
  },
  setupFiles: ['<rootDir>/tests/setup.ts'],
  globalTeardown: '<rootDir>/tests/teardown.js',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.interface.ts',
    '!src/index.ts',
    // Exclude CLI entry point (contains command setup code, tested via integration tests)
    '!src/cli/index.ts',
    // Exclude API plugin setup files (infrastructure code)
    '!src/api/plugins/scalar.ts',
    '!src/api/plugins/swagger.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@/api/(.*)$': '<rootDir>/src/api/$1',
    '^@/modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/cli/(.*)$': '<rootDir>/src/cli/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@scalar|@fastify)/)',
  ],
  verbose: true,
  testTimeout: 30000,
  // Force exit to prevent worker process hanging
  // This is a workaround for open handles in some tests
  forceExit: true,
};
