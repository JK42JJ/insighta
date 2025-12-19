/**
 * Global teardown - runs after all tests complete
 */

module.exports = async function globalTeardown() {
  // The Prisma client will be automatically disconnected
  // by the afterAll hooks in integration tests
  // This teardown is just a safety net
  console.log('Global teardown complete');
};
