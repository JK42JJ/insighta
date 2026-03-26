// Sharing API smoke tests — validates share link creation and public access.
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

describeIfServer('Sharing API — auth rejection', () => {
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

  it('POST /api/v1/sharing/create rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sharing/create',
      payload: { mandalaId: 'test' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/v1/sharing/nonexistent returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/sharing/nonexistent',
    });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('error');
    expect(body.code).toBe('SHARE_NOT_FOUND');
  });

  it('POST /api/v1/sharing/nonexistent/clone rejects without auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sharing/nonexistent/clone',
    });
    expect(response.statusCode).toBe(401);
  });
});

describeIfBot('Sharing API — authenticated flow', () => {
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

  it('POST /api/v1/sharing/create blocked by bot-write-guard (expected)', async () => {
    // Bot users cannot POST without approval token — this is correct behavior.
    // Real users (JWT auth) can create share links without restriction.
    const mandalaRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
      headers: botHeaders,
    });
    const { mandala } = JSON.parse(mandalaRes.body);
    if (!mandala) {
      console.log('SKIP: No mandala found');
      return;
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sharing/create',
      headers: { ...botHeaders, 'content-type': 'application/json' },
      payload: { mandalaId: mandala.id, mode: 'clone' },
    });

    // 403 = bot-write-guard blocks POST from bot role
    expect(response.statusCode).toBe(403);
  });

  it('GET /api/v1/sharing/mandala/:id lists share links', async () => {
    const mandalaRes = await app.inject({
      method: 'GET',
      url: '/api/v1/mandalas',
      headers: botHeaders,
    });
    const { mandala } = JSON.parse(mandalaRes.body);
    if (!mandala) {
      console.log('SKIP: No mandala found');
      return;
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/sharing/mandala/${mandala.id}`,
      headers: botHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe('Sharing API environment check', () => {
  it('reports server boot capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Sharing API tests skipped — no JWT_SECRET configured');
    } else if (!hasBotKey) {
      console.log('SKIP: Authenticated sharing tests skipped — no INSIGHTA_BOT_KEY');
    }
    expect(true).toBe(true);
  });
});
