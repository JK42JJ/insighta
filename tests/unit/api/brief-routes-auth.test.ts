/**
 * The brief routes read the account id the auth plugin actually sets.
 *
 * They did not. All five handlers did this:
 *
 *   const userId = (request.user as { id?: string } | undefined)?.id;
 *
 * `request.user` is typed `JWTPayload`, whose field is `userId`. The cast threw
 * that type away, so `id` compiled, came back `undefined`, and every brief
 * route answered 401 to a valid token. In production `/brief/subscribed` and
 * `/brief/categories` returned 401 thirteen times each in one session while
 * `/api/v1/mandalas/list` returned 200 twenty-four times.
 *
 * Nothing caught it. `tsc` could not — the cast is what silenced it. The unit
 * suite did not exercise these routes. And the symptom was an empty list
 * rather than an error, which reads as "no data" and not as "not signed in".
 *
 * So this pins the contract at the boundary where the mistake was made: an
 * authenticated request must not come back 401.
 */
import Fastify from 'fastify';

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
    $executeRaw: (...a: unknown[]) => mockExecuteRaw(...a),
  }),
}));

jest.mock('@/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import { briefRoutes } from '../../../src/api/routes/brief';

const USER_ID = '00000000-0000-0000-0000-0000000000b1';

/**
 * The stub sets `userId`, which is what `src/api/plugins/auth.ts` sets. A stub
 * that set `id` would make the broken code pass and the fixed code fail, so it
 * is the one detail in this file that must not drift from the plugin.
 */
async function makeApp() {
  const app = Fastify();
  app.decorate('authenticate', async (req: any) => {
    req.user = { userId: USER_ID, email: 'reader@example.com', name: 'reader', role: 'user' };
  });
  await app.register(briefRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryRaw.mockResolvedValue([]);
  mockExecuteRaw.mockResolvedValue(1);
});

describe('brief routes — authenticated requests are not 401', () => {
  it('GET /subscribed answers an authenticated reader', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/subscribed' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ issues: [], unread: 0 });
    await app.close();
  });

  it('GET /categories lists all ten briefs', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(200);
    // The empty screen this bug produced looked exactly like an empty list,
    // so the count is asserted rather than the shape.
    expect(res.json().data.categories).toHaveLength(10);
    expect(res.json().data.categories[0]).toMatchObject({
      key: 'ai-tech',
      subscribed: false,
    });
    await app.close();
  });

  it('POST /subscribe records against the id the plugin set', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/subscribe',
      payload: { categoryKey: 'ai-tech' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockExecuteRaw).toHaveBeenCalled();
    // The id must reach the query. Reading the wrong field returned undefined,
    // which a raw-SQL parameter would have accepted.
    const passed = JSON.stringify(mockExecuteRaw.mock.calls);
    expect(passed).toContain(USER_ID);
    await app.close();
  });

  it('POST /unsubscribe answers an authenticated reader', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/unsubscribe',
      payload: { categoryKey: 'ai-tech' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST /:slug/read answers an authenticated reader', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/2026-09-02-ai-tech/read' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('brief routes — an unauthenticated request is still 401', () => {
  it('answers 401 when the plugin set no user', async () => {
    const app = Fastify();
    app.decorate('authenticate', async () => undefined);
    await app.register(briefRoutes);

    const res = await app.inject({ method: 'GET', url: '/subscribed' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
