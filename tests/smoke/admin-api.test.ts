// Admin API smoke tests — validates auth rejection and response format.
// Dynamic import to avoid module-level config validation crash in CI.
export {};

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);

const describeIfServer = canBootServer ? describe : describe.skip;

describeIfServer('Admin API — auth rejection', () => {
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

  const adminEndpoints = [
    { method: 'GET' as const, url: '/api/v1/admin/health' },
    { method: 'GET' as const, url: '/api/v1/admin/users' },
    { method: 'GET' as const, url: '/api/v1/admin/stats/overview' },
    { method: 'GET' as const, url: '/api/v1/admin/analytics/users' },
    { method: 'GET' as const, url: '/api/v1/admin/audit-log' },
    { method: 'GET' as const, url: '/api/v1/admin/promotions' },
    { method: 'GET' as const, url: '/api/v1/admin/content/mandalas' },
    { method: 'GET' as const, url: '/api/v1/admin/enrichment/jobs' },
    { method: 'GET' as const, url: '/api/v1/admin/llm' },
  ];

  it.each(adminEndpoints)(
    '$method $url rejects without auth (401)',
    async ({ method, url }) => {
      const response = await app.inject({ method, url });

      expect(response.statusCode).toBe(401);
    }
  );

  it('rejects invalid bearer token (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/health',
      headers: { authorization: 'Bearer invalid-token-12345' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('PATCH /api/v1/admin/users/:id/subscription rejects without auth', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/subscription',
      payload: { tier: 'pro', reason: 'test upgrade' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('PATCH /api/v1/admin/users/:id/status rejects without auth', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/status',
      payload: { banned: true, banReason: 'test' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('Admin API environment check', () => {
  it('reports admin test capability', () => {
    if (!canBootServer) {
      console.log(
        'SKIP: Admin API tests skipped — no JWT_SECRET/SUPABASE_URL configured'
      );
    }
    expect(true).toBe(true);
  });
});
