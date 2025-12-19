// Jest setup file for global test configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./data/test.db';
process.env.LOG_LEVEL = 'error';

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  // Keep warn and error for debugging test failures
  warn: console.warn,
  error: console.error,
};

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here
});
