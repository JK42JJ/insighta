// YouTube API smoke tests — validates subscriptions/playlists endpoints.
// Dynamic import to avoid module-level config validation crash in CI.
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('YouTube API — auth rejection', () => {
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

  it('GET /api/v1/youtube/subscriptions rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/youtube/subscriptions',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/youtube/playlists rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/youtube/playlists',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('YouTube API environment check', () => {
  it('reports server boot capability', () => {
    if (!canBootServer) {
      console.log('SKIP: YouTube API tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    }
    expect(true).toBe(true);
  });
});
