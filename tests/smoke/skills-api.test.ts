/**
 * Skills API smoke tests — auth rejection, body validation, and authenticated
 * happy-path scenarios (skill list, preview, execute).
 *
 * Mocking strategy:
 *   - skillRegistry: mocked to return a predictable stub skill
 *   - getPrismaClient: mocked to avoid real DB connections
 *   - createGenerationProvider: mocked to avoid real LLM calls
 *
 * Dynamic import defers server boot until env check passes, avoiding
 * module-level config validation crash in CI.
 */
export {};

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Jest before any imports
// ---------------------------------------------------------------------------

const mockSkill = {
  id: 'newsletter',
  version: '1.0.0',
  description: 'Weekly newsletter from your mandala',
  trigger: { type: 'manual' },
  tiers: ['pro', 'enterprise'],
  inputSchema: { type: 'object', properties: { mandala_id: { type: 'string' } } },
  dryRun: jest.fn().mockResolvedValue({
    subject: 'Your Weekly Insighta',
    preview_html: '<p>Preview content</p>',
    curated_count: 5,
  }),
  execute: jest.fn().mockResolvedValue({
    success: true,
    data: { sent: true, message_id: 'mock-msg-id' },
    metadata: { duration_ms: 42 },
  }),
};

jest.mock('../../src/modules/skills', () => ({
  skillRegistry: {
    listForTier: jest.fn().mockReturnValue([mockSkill]),
    get: jest.fn((id: string) => (id === 'newsletter' ? mockSkill : undefined)),
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: { sent: true, message_id: 'mock-msg-id' },
      metadata: { duration_ms: 42 },
    }),
  },
  checkSkillQuota: jest.fn(),
  checkSummaryQuality: jest.fn(),
}));

jest.mock('../../src/modules/database', () => ({
  getPrismaClient: jest.fn().mockReturnValue({
    user_subscriptions: {
      findUnique: jest.fn().mockResolvedValue({ tier: 'pro' }),
    },
  }),
}));

jest.mock('../../src/modules/llm', () => ({
  createGenerationProvider: jest.fn().mockResolvedValue({ generate: jest.fn() }),
}));

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Auth rejection tests — no token required
// ---------------------------------------------------------------------------

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

  it('GET /api/v1/skills rejects without auth (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/skills',
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/skills/newsletter/preview rejects without auth (401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/preview',
      payload: { mandala_id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/v1/skills/newsletter/execute rejects without auth (401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/execute',
      payload: { mandala_id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Body validation tests — require token signing
// ---------------------------------------------------------------------------

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

  it('POST /api/v1/skills/newsletter/execute with missing mandala_id returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/execute',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('POST /api/v1/skills/newsletter/preview with invalid uuid returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/preview',
      headers: { authorization: `Bearer ${token}` },
      payload: { mandala_id: 'not-a-uuid' },
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
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Authenticated happy-path tests — mocked skillRegistry + DB + LLM
// ---------------------------------------------------------------------------

describeIfSigning('Skills API — authenticated happy-path (mocked)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;
  const VALID_MANDALA_ID = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    token = app.jwt.sign({ sub: 'test-user-id', userId: 'test-user-id', role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/skills returns skill list for user tier (200)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/skills',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    // Mock returns one skill (newsletter)
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const skill = body.data[0];
    expect(skill).toHaveProperty('id');
    expect(skill).toHaveProperty('description');
    expect(skill).toHaveProperty('version');
    expect(skill).toHaveProperty('trigger');
    expect(skill).toHaveProperty('inputSchema');
  });

  it('POST /api/v1/skills/newsletter/preview with valid skillId returns preview data (200)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/preview',
      headers: { authorization: `Bearer ${token}` },
      payload: { mandala_id: VALID_MANDALA_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('subject');
    expect(body.data).toHaveProperty('preview_html');
    expect(body.data).toHaveProperty('curated_count');
  });

  it('POST /api/v1/skills/newsletter/execute with valid body returns result (200)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/skills/newsletter/execute',
      headers: { authorization: `Bearer ${token}` },
      payload: { mandala_id: VALID_MANDALA_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('success', true);
  });
});

// ---------------------------------------------------------------------------
// Environment report — always runs
// ---------------------------------------------------------------------------

describe('Skills API environment check', () => {
  it('reports skills test capability', () => {
    if (!canBootServer) {
      console.log('SKIP: Skills API tests skipped — no JWT_SECRET/SUPABASE_URL configured');
    } else if (!canSignTokens) {
      console.log(
        'SKIP: Skills body validation + happy-path tests skipped — SUPABASE_URL is set (ES256 JWKS, cannot sign test tokens)'
      );
    }
    expect(true).toBe(true);
  });
});
