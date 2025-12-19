/**
 * Jest setup file - runs before all tests
 */

// Set NODE_ENV to test to skip documentation plugins
process.env['NODE_ENV'] = 'test';

// Set default log level to error for tests (minimal logging)
process.env['LOG_LEVEL'] = 'error';

// Set default JWT secret for tests
if (!process.env['JWT_SECRET']) {
  process.env['JWT_SECRET'] = 'test-jwt-secret-key-for-testing-only';
}

if (!process.env['JWT_REFRESH_SECRET']) {
  process.env['JWT_REFRESH_SECRET'] = 'test-jwt-refresh-secret-key-for-testing-only';
}

// Set default encryption secret for tests (minimum 64 characters)
if (!process.env['ENCRYPTION_SECRET']) {
  process.env['ENCRYPTION_SECRET'] = 'test-encryption-secret-key-for-testing-only-needs-64-chars-min';
}

// Set default database URL for tests (SQLite in-memory)
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'file:./prisma/test.db';
}
