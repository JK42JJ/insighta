// Dynamic import to avoid module-level config validation crash in CI.
// database/client.ts → config/index.ts → parseEnv() throws if ENCRYPTION_SECRET missing.
export {};

const hasDatabase = !!process.env['DATABASE_URL'];
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('Prisma connection', () => {
  afterAll(async () => {
    const { disconnectDatabase } = await import('../../src/modules/database/client');
    await disconnectDatabase();
  });

  it('connects to the database successfully', async () => {
    const { getPrismaClient } = await import('../../src/modules/database/client');
    const prisma = getPrismaClient();
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Prisma environment check', () => {
  it('reports database availability', () => {
    if (!hasDatabase) {
      console.log('SKIP: Prisma tests skipped — no DATABASE_URL configured');
    }
    expect(true).toBe(true);
  });
});
