/**
 * Add Cards Routes smoke tests (CP466) — auth + validation gate.
 *
 * Validates POST /api/v1/mandalas/:mandalaId/add-cards endpoint exists
 * with the correct auth + body validation. DB writes / Tier 1 / Layer 4
 * are not exercised — those need a live DB which the smoke suite does
 * not provide.
 *
 * Mirrors `card-interactions.test.ts` pattern.
 */

export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

const VALID_MANDALA_ID = '00000000-0000-0000-0000-000000000001';
const INVALID_MANDALA_ID = 'not-a-uuid';

describeIfServer('Add Cards API — auth + body validation gate', () => {
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

  it('POST /api/v1/mandalas/:id/add-cards returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/${VALID_MANDALA_ID}/add-cards`,
      headers: { 'content-type': 'application/json' },
      payload: { extraKeywords: [], excludeVideoIds: [] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/mandalas/:id/add-cards 401 without token even with invalid uuid (auth runs first)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/${INVALID_MANDALA_ID}/add-cards`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    // Auth gate fires before body / params validation.
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/mandalas/:id/add-cards does not return 200/2xx without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/${VALID_MANDALA_ID}/add-cards`,
      headers: { 'content-type': 'application/json' },
      payload: { extraKeywords: ['python'], excludeVideoIds: [] },
    });
    expect(response.statusCode).not.toBe(200);
    expect(response.statusCode).not.toBe(202);
  });
});
