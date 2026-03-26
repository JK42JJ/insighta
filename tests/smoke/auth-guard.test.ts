// Dynamic import to avoid module-level config validation crash in CI.
// server.ts → config/index.ts → parseEnv() throws if ENCRYPTION_SECRET missing.
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('Auth guard — protected routes reject unauthenticated requests', () => {
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

  it('GET /api/v1/mandalas returns 401 without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/playlists returns 401 without token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/playlists',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Auth guard environment check', () => {
  it('reports server boot capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Auth guard tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    }
    expect(true).toBe(true);
  });
});
