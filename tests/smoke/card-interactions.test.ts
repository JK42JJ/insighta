/**
 * Card Interactions Routes smoke tests (CP462+ Issue #649) —
 * auth rejection on every new endpoint introduced in Phase 2.
 *
 * Validates the 6 new endpoints exist with the correct auth gate. DB
 * writes are not exercised — those need a live DB which the smoke suite
 * does not provide. Body / videoId validation behind the auth gate is
 * covered by future end-to-end tests once a JWT fixture is wired up.
 *
 * Mirrors the cards-pin-routes.test.ts pattern.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

const VALID_VIDEO_ID = 'dQw4w9WgXcQ';

describeIfServer('Card Interactions API — auth gate on every endpoint', () => {
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

  it('POST /api/v1/cards/:videoId/like returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/like`,
      headers: { 'content-type': 'application/json' },
      payload: { mandalaId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/cards/:videoId/unlike returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/unlike`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/cards/:videoId/archive returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/archive`,
      headers: { 'content-type': 'application/json' },
      payload: { mandalaId: '00000000-0000-0000-0000-000000000001' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/cards/:videoId/unarchive returns 401 without token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/unarchive`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/cards/v2-summaries returns 401 without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/cards/v2-summaries?videoIds=${VALID_VIDEO_ID}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/cards/:videoId/enrich-stream returns 401 without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/enrich-stream`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('like endpoint does NOT respond 200 without auth (no false-pass on body shape)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/cards/${VALID_VIDEO_ID}/like`,
      payload: {},
    });
    expect(response.statusCode).not.toBe(200);
    expect(response.statusCode).not.toBe(202);
  });
});
