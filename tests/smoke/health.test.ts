import { buildServer } from '../../src/api/server';

// buildServer() requires SUPABASE_JWT_SECRET or JWKS access.
// In CI (no DB, no Supabase), skip server boot tests.
const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });
});

describe('Health test environment check', () => {
  it('reports server boot capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Server boot tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    }
    // Always passes — ensures the test file itself is valid
    expect(true).toBe(true);
  });
});
