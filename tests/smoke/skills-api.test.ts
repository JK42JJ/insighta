/**
 * Skills API smoke tests — validates auth rejection + basic endpoint availability.
 * Dynamic import to avoid module-level config validation crash in CI.
 */
export {};

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

describeIfServer('Skills API — auth rejection', () => {
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

  it('GET /api/v1/skills rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/skills',
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/skills/newsletter/preview rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/preview',
      payload: { mandala_id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/skills/newsletter/execute rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/execute',
      payload: { mandala_id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfSigning('Skills API — body validation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    // Sign a test token using the server's registered JWT plugin (HS256 only).
    token = app.jwt.sign({ sub: 'test-user-id', userId: 'test-user-id', role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/skills/newsletter/preview with missing mandala_id returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/preview',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/v1/skills/nonexistent/preview with valid body returns 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/nonexistent/preview',
      headers: { authorization: `Bearer ${token}` },
      payload: { mandala_id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('Skills API environment check', () => {
  it('reports skills test capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Skills API tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    } else if (!canSignTokens) {
      console.log(
        'SKIP: Skills body validation tests skipped — SUPABASE_URL is set (ES256 JWKS, cannot sign test tokens)'
      );
    }
    expect(true).toBe(true);
  });
});
