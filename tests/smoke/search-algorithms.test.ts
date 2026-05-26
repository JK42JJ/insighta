/**
 * Admin Search Algorithm Versions — smoke tests (CP488)
 *
 * Validates the 5 new admin endpoints reject unauthenticated requests with
 * 401 (and authenticated-non-admin requests with 403 once a JWT fixture
 * lands). Mirrors the cards-pin-routes / card-interactions smoke pattern.
 *
 * Resolver unit assertions (mandala override → global active → fallback)
 * land in tests/unit/modules/search-algorithm-resolver.test.ts in a
 * follow-up commit once a DB fixture wrapper is available.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

const VALID_ALGO_ID = 'v1-current';
const VALID_MANDALA_ID = '00000000-0000-0000-0000-000000000001';

describeIfServer('Admin Search Algorithms API — auth gate on every endpoint', () => {
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

  it('GET /api/v1/admin/search-algorithms returns 401 without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/search-algorithms',
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/admin/search-algorithms returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/search-algorithms',
      headers: { 'content-type': 'application/json' },
      payload: {
        id: 'v2-test',
        display_name: 'test',
        parameters: { foo: 'bar' },
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it(`PATCH /api/v1/admin/search-algorithms/${VALID_ALGO_ID} returns 401 without token`, async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/search-algorithms/${VALID_ALGO_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: { is_active: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it(`PATCH /api/v1/admin/search-algorithms/mandala/${VALID_MANDALA_ID} returns 401 without token`, async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/search-algorithms/mandala/${VALID_MANDALA_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: { algorithm_version: VALID_ALGO_ID },
    });
    expect(response.statusCode).toBe(401);
  });

  it(`DELETE /api/v1/admin/search-algorithms/mandala/${VALID_MANDALA_ID} returns 401 without token`, async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/search-algorithms/mandala/${VALID_MANDALA_ID}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it(`GET /api/v1/admin/search-algorithms/comparison/${VALID_MANDALA_ID} returns 401 without token`, async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/search-algorithms/comparison/${VALID_MANDALA_ID}`,
    });
    expect(response.statusCode).toBe(401);
  });
});
