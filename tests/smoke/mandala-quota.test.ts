/**
 * Mandala quota smoke tests — auth rejection, response structure, quota enforcement.
 *
 * Covers the bug fixed in #339:
 *   - API wraps response as { quota: {...} } (was missing before the fix)
 *   - null limit means unlimited (is_super_admin / admin tier)
 *   - remaining is null when limit is null
 *   - createMandala enforces quota: limit !== null && count >= limit → 409
 *
 * Mocking strategy:
 *   - getPrismaClient: mocked to avoid real DB connections
 *   - getMandalaManager: partially mocked for unit-style group 4 tests
 *
 * Dynamic import defers server boot until env check passes, avoiding
 * module-level config validation crash in CI.
 */
export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockFindUnique = jest.fn();
const mockCount = jest.fn();
const mockQueryRaw = jest.fn();

const mockPrisma = {
  user_subscriptions: {
    findUnique: mockFindUnique,
  },
  user_mandalas: {
    count: mockCount,
  },
  $queryRaw: mockQueryRaw,
};

jest.mock('../../src/modules/database', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
}));

// manager.ts imports from '../database/client' directly — mock that path too
jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
  db: mockPrisma,
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
  resetConnectionPool: jest.fn(),
  withRetry: jest.fn((fn: () => unknown) => fn()),
  executeTransaction: jest.fn(),
  testDatabaseConnection: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

// Authenticated tests require HS256 signing capability (JWT_SECRET without JWKS).
// When SUPABASE_URL is set, the server uses ES256 JWKS and app.jwt.sign cannot
// create valid tokens (no private key available in tests).
const canSignTokens = !!(
  (process.env['SUPABASE_JWT_SECRET'] || process.env['JWT_SECRET']) &&
  !process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;
const describeIfSigning = canSignTokens ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Group 1: Auth rejection — no token required
// ---------------------------------------------------------------------------

describeIfServer('Mandala quota API — auth rejection', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/mandalas/quota without auth returns 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Group 2: Authenticated quota response structure (mock DB)
// ---------------------------------------------------------------------------

describeIfSigning('Mandala quota API — response structure (mocked)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    token = app.jwt.sign({ sub: 'test-user-id', userId: 'test-user-id', role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/v1/mandalas/quota returns response wrapped in { quota: {...} }', async () => {
    // free tier user, 1 mandala used
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(1);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // Must be wrapped — this was the bug fixed in #339
    expect(body).toHaveProperty('quota');
    expect(typeof body.quota).toBe('object');
    // Top-level must NOT expose quota fields directly (would indicate missing wrapper)
    expect(body).not.toHaveProperty('tier');
    expect(body).not.toHaveProperty('limit');
    expect(body).not.toHaveProperty('used');
  });

  it('GET /api/v1/mandalas/quota returns { tier, limit, used, remaining } inside quota', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(1);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const { quota } = JSON.parse(response.body);
    expect(quota).toHaveProperty('tier');
    expect(quota).toHaveProperty('limit');
    expect(quota).toHaveProperty('used');
    expect(quota).toHaveProperty('remaining');
  });

  it('free tier user: limit is 3 (numeric, not null)', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(1);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const { quota } = JSON.parse(response.body);
    expect(quota.tier).toBe('free');
    expect(quota.limit).toBe(3);
    expect(typeof quota.limit).toBe('number');
    expect(quota.used).toBe(1);
    expect(quota.remaining).toBe(2);
  });

  it('is_super_admin user: tier is admin and limit is null (unlimited)', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(10);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: true }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const { quota } = JSON.parse(response.body);
    expect(quota.tier).toBe('admin');
    expect(quota.limit).toBeNull();
    expect(quota.used).toBe(10);
  });

  it('when limit is null (admin), remaining is also null', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(10);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: true }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas/quota',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const { quota } = JSON.parse(response.body);
    expect(quota.limit).toBeNull();
    expect(quota.remaining).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 3: Mandala creation quota enforcement (mock DB)
// ---------------------------------------------------------------------------

describeIfSigning('Mandala quota API — creation enforcement (mocked)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    token = app.jwt.sign({ sub: 'test-user-id', userId: 'test-user-id', role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // $transaction passes a tx proxy to the callback.
    // createMandala also calls this.prisma.$queryRaw outside the tx (admin check),
    // so mockQueryRaw must be set before injecting.
    const prisma = require('../../src/modules/database').getPrismaClient();
    prisma.$transaction = jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user_subscriptions: { findUnique: mockFindUnique },
        user_mandalas: {
          count: mockCount,
          aggregate: jest.fn().mockResolvedValue({ _max: { position: 0 } }),
          create: jest.fn().mockResolvedValue({
            id: 'new-mandala-id',
            user_id: 'test-user-id',
            title: 'Test Mandala',
            is_default: false,
            position: 1,
            created_at: new Date(),
            updated_at: new Date(),
          }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'new-mandala-id',
            user_id: 'test-user-id',
            title: 'Test Mandala',
            is_default: false,
            position: 1,
            created_at: new Date(),
            updated_at: new Date(),
            levels: [],
          }),
        },
        user_mandala_levels: {
          create: jest.fn().mockResolvedValue({ id: 'level-id', level_key: 'root' }),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
      })
    );
  });

  it('POST /api/v1/mandalas/create succeeds (201) when user is under quota', async () => {
    // free tier, 1 mandala used out of 3
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(1);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mandalas/create',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'My New Mandala' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('POST /api/v1/mandalas/create returns 409 when free tier quota is exhausted', async () => {
    // free tier limit = 3, already at 3
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(3);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mandalas/create',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Quota-Breaker' },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error).toMatch(/quota exceeded/i);
    expect(body).toHaveProperty('quota', 3);
    expect(body).toHaveProperty('current', 3);
  });

  it('POST /api/v1/mandalas/create succeeds for admin even with high count (limit=null)', async () => {
    // admin has null limit — quota check should never fire
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(50);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: true }]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/mandalas/create',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Admin Mandala 51' },
    });

    expect(response.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Group 4: getUserQuota unit tests (direct manager via mocked prisma)
// ---------------------------------------------------------------------------

describeIfSigning('getUserQuota unit — direct manager (mocked prisma)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('free tier with 2 mandalas: remaining = 1', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(2);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    // MandalaManager has no constructor args — it calls getPrismaClient() via a getter
    const { MandalaManager } = await import('../../src/modules/mandala/manager');
    const manager = new MandalaManager();

    const quota = await manager.getUserQuota('user-free');

    expect(quota.tier).toBe('free');
    expect(quota.limit).toBe(3);
    expect(quota.used).toBe(2);
    expect(quota.remaining).toBe(1);
  });

  it('is_super_admin with 10 mandalas: limit = null, remaining = null', async () => {
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: null });
    mockCount.mockResolvedValue(10);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: true }]);

    const { MandalaManager } = await import('../../src/modules/mandala/manager');
    const manager = new MandalaManager();

    const quota = await manager.getUserQuota('user-super-admin');

    expect(quota.tier).toBe('admin');
    expect(quota.limit).toBeNull();
    expect(quota.used).toBe(10);
    expect(quota.remaining).toBeNull();
  });

  it('subscription override mandala_limit=5 takes precedence over tier default (3)', async () => {
    // free tier default is 3, but subscription row overrides with 5
    mockFindUnique.mockResolvedValue({ tier: 'free', mandala_limit: 5 });
    mockCount.mockResolvedValue(3);
    mockQueryRaw.mockResolvedValue([{ is_super_admin: false }]);

    const { MandalaManager } = await import('../../src/modules/mandala/manager');
    const manager = new MandalaManager();

    const quota = await manager.getUserQuota('user-with-override');

    expect(quota.tier).toBe('free');
    // mandala_limit override (5) must win over TIER_LIMITS.free.mandalas (3)
    expect(quota.limit).toBe(5);
    expect(quota.used).toBe(3);
    expect(quota.remaining).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Environment report — always runs
// ---------------------------------------------------------------------------

describe('Mandala quota environment check', () => {
  it('reports mandala quota test capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Mandala quota API tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    } else if (!canSignTokens) {
      console.log(
        'SKIP: Mandala quota authenticated tests skipped — SUPABASE_URL is set (ES256 JWKS, cannot sign test tokens)'
      );
    }
    expect(true).toBe(true);
  });
});
