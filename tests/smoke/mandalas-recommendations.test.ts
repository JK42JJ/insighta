/**
 * GET /api/v1/mandalas/:id/recommendations smoke tests.
 *
 * Covers:
 *   - Auth rejection (401)
 *   - Ownership check (404 when mandala not owned)
 *   - cell_index query validation (400 on out-of-range / non-int)
 *   - 200 with empty items[] when recommendation_cache has no rows
 *   - 200 with shaped items[] when row exists
 *   - cell_index filter applied
 *
 * Mocking strategy mirrors mandala-quota.test.ts: PrismaClient + getMandalaManager
 * are stubbed at module load so the route handler runs without DB IO.
 */
export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockGetMandalaById = jest.fn();
const mockRecFindMany = jest.fn();

const mockPrisma = {
  recommendation_cache: {
    findMany: mockRecFindMany,
  },
  // Other models touched by the dashboard endpoint share the same mock object
  // but only recommendation_cache.findMany is exercised in this file.
};

jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('../../src/modules/mandala', () => ({
  getMandalaManager: jest.fn(() => ({
    getMandalaById: mockGetMandalaById,
  })),
}));

// ---------------------------------------------------------------------------
// Environment guards (same pattern as skills-api.test.ts)
// ---------------------------------------------------------------------------

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const canSignTokens = !!(
  (process.env['SUPABASE_JWT_SECRET'] || process.env['JWT_SECRET']) &&
  !process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;
const describeIfSigning = canSignTokens ? describe : describe.skip;

const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEST_MANDALA_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mandalaStub = {
  id: TEST_MANDALA_ID,
  title: 'Test mandala',
  levels: [
    { depth: 0, position: 0, centerGoal: 'Root goal', centerLabel: 'Root', subjects: [] },
    { depth: 1, position: 0, centerGoal: 'Cell A', subjects: [] },
    { depth: 1, position: 2, centerGoal: 'Cell C', subjects: [] },
  ],
};

function makeRecRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    user_id: TEST_USER_ID,
    mandala_id: TEST_MANDALA_ID,
    cell_index: 0,
    keyword: 'fastify',
    domain: null,
    video_id: 'vid-001',
    title: 'Fastify intro',
    thumbnail: 'https://img/thumb.jpg',
    channel: 'Code TV',
    channel_subs: 12000,
    view_count: 1000,
    like_ratio: 0.95,
    duration_sec: 720,
    rec_score: 0.87,
    iks_score: 0.8,
    trend_keywords: [],
    rec_reason: 'High relevance to cell A',
    status: 'pending',
    weight_version: 1,
    created_at: new Date('2026-04-08T10:00:00Z'),
    expires_at: new Date('2099-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth rejection — no token required
// ---------------------------------------------------------------------------

describeIfServer('GET /api/v1/mandalas/:id/recommendations — auth rejection', () => {
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

  it('rejects without auth (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations`,
    });
    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Authenticated happy/edge paths
// ---------------------------------------------------------------------------

describeIfSigning('GET /api/v1/mandalas/:id/recommendations — authenticated', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    token = app.jwt.sign({ sub: TEST_USER_ID, userId: TEST_USER_ID, role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockGetMandalaById.mockReset();
    mockRecFindMany.mockReset();
  });

  it('returns 404 when mandala is not owned', async () => {
    mockGetMandalaById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(mockRecFindMany).not.toHaveBeenCalled();
  });

  it('returns 200 with empty items[] when DB has no recommendations', async () => {
    mockGetMandalaById.mockResolvedValue(mandalaStub);
    mockRecFindMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({
      mandalaId: TEST_MANDALA_ID,
      mode: 'auto',
      items: [],
      lastRefreshed: null,
    });
  });

  it('returns shaped items[] with cellLabel resolved when row exists', async () => {
    mockGetMandalaById.mockResolvedValue(mandalaStub);
    mockRecFindMany.mockResolvedValue([
      makeRecRow({ cell_index: 0 }),
      makeRecRow({ id: 'rec-2', video_id: 'vid-002', cell_index: 2, rec_score: 0.7 }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.mandalaId).toBe(TEST_MANDALA_ID);
    expect(body.mode).toBe('auto');
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      id: 'rec-1',
      videoId: 'vid-001',
      title: 'Fastify intro',
      channel: 'Code TV',
      thumbnail: 'https://img/thumb.jpg',
      durationSec: 720,
      recScore: 0.87,
      cellIndex: 0,
      cellLabel: 'Cell A',
      keyword: 'fastify',
      source: 'auto_recommend',
      recReason: 'High relevance to cell A',
    });
    expect(body.items[1].cellLabel).toBe('Cell C');
    expect(body.lastRefreshed).toBe('2026-04-08T10:00:00.000Z');
  });

  it('rejects out-of-range cell_index with 400', async () => {
    mockGetMandalaById.mockResolvedValue(mandalaStub);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations?cell_index=8`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
    expect(mockRecFindMany).not.toHaveBeenCalled();
  });

  it('rejects non-integer cell_index with 400', async () => {
    mockGetMandalaById.mockResolvedValue(mandalaStub);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations?cell_index=foo`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
  });

  it('forwards cell_index filter to prisma when valid', async () => {
    mockGetMandalaById.mockResolvedValue(mandalaStub);
    mockRecFindMany.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/recommendations?cell_index=2`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(mockRecFindMany).toHaveBeenCalledTimes(1);
    const call = mockRecFindMany.mock.calls[0]?.[0];
    expect(call?.where?.cell_index).toBe(2);
    expect(call?.where?.user_id).toBe(TEST_USER_ID);
    expect(call?.where?.mandala_id).toBe(TEST_MANDALA_ID);
    expect(call?.where?.status).toBe('pending');
    expect(call?.take).toBe(80);
  });
});
