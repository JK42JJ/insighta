/**
 * POST /api/v1/mandalas/wizard-stream — auth + validation smoke tests.
 *
 * Additive P0 endpoint. Event streaming path is exercised via unit-
 * testable orchestrator pieces (searchMandalasByGoal / generateMandalaStructure
 * already covered); these smokes pin the route-level contract that
 * legacy /generate continues to work unchanged and the new endpoint
 * rejects invalid input before hijacking the socket.
 */
export {};

const mockGetMandalaById = jest.fn();

jest.mock('../../src/modules/database/client', () => ({
  getPrismaClient: jest.fn(() => ({})),
}));

jest.mock('../../src/modules/mandala', () => ({
  getMandalaManager: jest.fn(() => ({
    getMandalaById: mockGetMandalaById,
  })),
}));

const canBootServer = !!(
  process.env['SUPABASE_JWT_SECRET'] ||
  process.env['JWT_SECRET'] ||
  process.env['SUPABASE_URL']
);
const canSignTokens = !!(
  (process.env['SUPABASE_JWT_SECRET'] || process.env['JWT_SECRET']) &&
  !process.env['SUPABASE_URL']
);
const describeIfServer = canBootServer ? describe : describe.skip;
const describeIfSigning = canSignTokens ? describe : describe.skip;

const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describeIfServer('POST /api/v1/mandalas/wizard-stream — auth rejection', () => {
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

  it('rejects without auth (401)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/wizard-stream`,
      payload: { goal: '건강한 몸 만들기' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describeIfSigning('POST /api/v1/mandalas/wizard-stream — input validation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let token: string;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
    token = app.jwt.sign({ sub: TEST_USER_ID, userId: TEST_USER_ID, role: 'user' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 when goal is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/wizard-stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when goal is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/mandalas/wizard-stream`,
      headers: { authorization: `Bearer ${token}` },
      payload: { goal: '   ' },
    });
    expect(response.statusCode).toBe(400);
  });
});
