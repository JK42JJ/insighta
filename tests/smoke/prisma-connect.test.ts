import { getPrismaClient, disconnectDatabase } from '../../src/modules/database/client';

const hasDatabase = !!process.env['DATABASE_URL'];
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('Prisma connection', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('connects to the database successfully', async () => {
    const prisma = getPrismaClient();
    // Simple query to verify connection
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
