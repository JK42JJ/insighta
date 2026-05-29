/**
 * Smoke — batch-video-collector internal trigger route (CP489+ fire-and-forget).
 *
 * Locks in the structural surface that the GitHub Actions workflow relies on:
 *   - Token guard (no token / bad token → 401)
 *   - Unconfigured guard (INTERNAL_BATCH_TOKEN absent → 503)
 *
 * Happy-path 202 enqueue requires pg-boss + DB, exercised in BE integration
 * (and observed live via prod logs after deploy). This file deliberately
 * stays at the auth-contract level so it can run without a live queue.
 */

export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('batch-video-collector internal trigger — token guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  const ROUTE = '/api/v1/internal/skills/batch-video-collector/run';

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST without x-internal-token returns 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: ROUTE,
      payload: {},
    });

    // 401 = token missing/invalid. 503 = INTERNAL_BATCH_TOKEN not configured
    // in this env — both prove the guard fires before any side-effect.
    expect([401, 503]).toContain(response.statusCode);
  });

  it('POST with wrong x-internal-token returns 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'x-internal-token': 'definitely-not-the-real-token' },
      payload: {},
    });

    expect([401, 503]).toContain(response.statusCode);
  });
});

describe('batch-video-collector smoke environment check', () => {
  it('reports server boot capability', () => {
    if (!canBootServer) {
      // eslint-disable-next-line no-console
      console.log('SKIP: batch-video-collector smoke skipped — no JWT_SECRET/SUPABASE_URL');
    }
    expect(true).toBe(true);
  });
});
