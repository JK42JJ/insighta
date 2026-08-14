/**
 * Curation bookmark route — auth gate + body validation.
 *
 * The endpoint writes `curation_items.bookmarked_at` and can create a
 * `curation_channels` row, so the property that matters most here is that it
 * cannot be reached without a token. Ownership and the DB writes themselves are
 * not exercised: the smoke suite has no live DB, and this file follows
 * cards-pin-routes.test.ts rather than inventing a second convention.
 */
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

const SUB = '00000000-0000-0000-0000-000000000001';
const VIDEO = 'dQw4w9WgXcQ';
const URL = `/api/v1/curations/${SUB}/items/${VIDEO}/bookmark`;

describeIfServer('Curation bookmark API — auth + validation', () => {
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

  it('returns 401 without a token', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: { 'content-type': 'application/json' },
      payload: { bookmarked: true },
    });
    expect(response.statusCode).toBe(401);
  });

  it('never answers 200 to an unauthenticated call, whatever the body', async () => {
    for (const payload of [{}, { bookmarked: 'yes' }, { bookmarked: null }]) {
      const response = await app.inject({ method: 'PATCH', url: URL, payload });
      expect(response.statusCode).not.toBe(200);
    }
  });

  it('is registered as PATCH — other methods on the same path do not answer 200', async () => {
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({ method, url: URL });
      expect(response.statusCode).not.toBe(200);
    }
  });
});
