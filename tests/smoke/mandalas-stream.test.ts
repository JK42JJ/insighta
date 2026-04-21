/**
 * GET /api/v1/mandalas/:id/videos/stream — SSE smoke tests.
 *
 * Phase 1 slice 2 coverage:
 *   - 401 when no auth
 *   - 404 when mandala not owned
 *
 * End-to-end publisher→SSE event delivery is covered by:
 *   - tests/unit/modules/rec-publisher.test.ts (publisher contract)
 *   - manual prod smoke (see PR description for the curl / browser
 *     EventSource recipe)
 *
 * Fastify `.inject()` cannot fully exercise long-lived SSE streams
 * because the handler awaits the request-close event and inject()
 * does not simulate socket close cleanly. The auth + ownership
 * paths terminate the handler early (via `reply.code(401).send` and
 * `reply.code(404).send` respectively, both pre-hijack), so those
 * DO work under inject().
 */
export {};

const mockGetMandalaById = jest.fn();

jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => ({})),
}));

jest.mock('../../src/modules/mandala', () => ({
  getMandalaManager: jest.fn(() => ({
    getMandalaById: mockGetMandalaById,
  })),
}));

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

describeIfServer('GET /api/v1/mandalas/:id/videos/stream — auth rejection', () => {
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
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/videos/stream`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describeIfSigning('GET /api/v1/mandalas/:id/videos/stream — authenticated', () => {
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
  });

  it('returns 404 when mandala is not owned', async () => {
    mockGetMandalaById.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${TEST_MANDALA_ID}/videos/stream`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Mandala not found');
  });
});
