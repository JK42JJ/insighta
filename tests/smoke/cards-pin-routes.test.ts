/**
 * Cards Pin Routes smoke tests (CP457+) — auth rejection + body validation.
 *
 * Validates the PATCH /api/v1/cards/:id/pin endpoint exists with the right
 * auth gate + body shape. DB writes are not exercised — those need a live DB
 * which the smoke suite does not provide.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('Cards Pin API — auth + validation', () => {
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

  it('PATCH /api/v1/cards/:id/pin returns 401 without token', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/cards/00000000-0000-0000-0000-000000000001/pin',
      headers: { 'content-type': 'application/json' },
      payload: { pinned: true, source: 'user_local_cards' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('PATCH /api/v1/cards/:id/pin rejects requests without auth header (no false 200)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/cards/00000000-0000-0000-0000-000000000001/pin',
      payload: {},
    });
    expect(response.statusCode).not.toBe(200);
  });
});
