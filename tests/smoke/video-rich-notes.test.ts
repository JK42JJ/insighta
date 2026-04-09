/**
 * Video Rich Notes API smoke tests — validates auth rejection + route registration.
 * Dynamic import to avoid module-level config validation crash in CI.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('Rich Notes API — auth rejection', () => {
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

  it('GET /api/v1/rich-notes/:cardId rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/rich-notes/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(401);
  });

  it('PATCH /api/v1/rich-notes/:cardId rejects without auth', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/rich-notes/00000000-0000-0000-0000-000000000000',
      payload: { note: { type: 'doc', content: [] } },
    });
    expect(response.statusCode).toBe(401);
  });
});
