// Bot API smoke tests — validates bot auth, mood, report, subscription endpoints.
// Dynamic import to avoid module-level config validation crash in CI.
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const hasBotKey = !!(
  process.env['INSIGHTA_BOT_KEY'] &&
  process.env['INSIGHTA_BOT_USER_ID']
);

const describeIfServer = canBootServer ? describe : describe.skip;
const describeIfBot = canBootServer && hasBotKey ? describe : describe.skip;

describeIfServer('Bot API — auth rejection', () => {
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

  it('GET /api/v1/mandalas rejects invalid bot key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
      headers: { authorization: 'Bearer invalid-bot-key-12345' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/bot/request-approval rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/bot/request-approval',
      payload: { actionSummary: 'test action' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/bot/pending rejects without auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot/pending',
    });

    expect(response.statusCode).toBe(401);
  });
});

describeIfBot('Bot API — authenticated bot endpoints', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  const botHeaders = {
    authorization: `Bearer ${process.env['INSIGHTA_BOT_KEY']}`,
  };

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/mandalas returns 200 with default mandala', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('mandala');
    expect(body.mandala).toHaveProperty('id');
  });

  it('GET /api/v1/mandalas/:id/mood returns mood state', async () => {
    // Get default mandala to find a valid ID
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
      headers: botHeaders,
    });

    const { mandala } = JSON.parse(listResponse.body);
    if (!mandala) {
      console.log('SKIP: No mandala found for mood test');
      return;
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/mandalas/${mandala.id}/mood`,
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('signals');
  });

  it('GET /api/v1/analytics/weekly-report returns report data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/weekly-report',
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('mandalas');
    expect(Array.isArray(body.mandalas)).toBe(true);
  });

  it('GET /api/v1/subscriptions/updates returns updates array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subscriptions/updates',
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('updates');
    expect(Array.isArray(body.updates)).toBe(true);
  });

  it('GET /api/v1/bot/pending returns pending approvals', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/bot/pending',
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('Bot API environment check', () => {
  it('reports bot test capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Bot API tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    } else if (!hasBotKey) {
      console.log('SKIP: Authenticated bot tests skipped — no INSIGHTA_BOT_KEY configured');
    }
    expect(true).toBe(true);
  });
});
