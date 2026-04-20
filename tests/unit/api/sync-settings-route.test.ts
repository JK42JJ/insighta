/**
 * POST /api/v1/sync/settings (Plan 2) — unit pin.
 *
 * Verifies the two behavioral guarantees we introduced:
 *   1. The route mirrors `syncInterval` into both `youtube_sync_settings`
 *      AND every `sync_schedules` row for the user, converting the string
 *      ('1h'/'6h'/'12h'/'24h'/'manual') to the correct `interval_ms`.
 *   2. 'manual' disables every schedule (enabled=false) while preserving
 *      the previously stored numeric interval.
 *
 * Also guards the Bug B invariant by exercising the autoSyncEnabled=false
 * branch, which should flip every schedule's `enabled` flag even when
 * `syncInterval` is not supplied.
 *
 * Mocks Prisma + SchedulerManager at module load so the route can run
 * without a live DB or cron runtime. The route's `getSchedulerManager`
 * returns the same stub on every call because we replace the module
 * export before importing the route file.
 */
import Fastify from 'fastify';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockCreate = jest.fn();
const mockPlaylistFindMany = jest.fn();
const mockSchedulerGet = jest.fn();
const mockSchedulerUpdate = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({
    youtube_sync_settings: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      create: mockCreate,
    },
    youtube_playlists: { findMany: mockPlaylistFindMany },
  }),
}));

jest.mock('../../../src/modules/scheduler', () => ({
  getSchedulerManager: () => ({
    getSchedule: mockSchedulerGet,
    updateSchedule: mockSchedulerUpdate,
  }),
}));

jest.mock('../../../src/modules/playlist', () => ({
  getPlaylistManager: () => ({}),
}));

jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { syncRoutes } from '../../../src/api/routes/sync';

const USER_ID = '00000000-0000-0000-0000-000000000042';
const PL1 = '00000000-0000-0000-0000-000000000101';
const PL2 = '00000000-0000-0000-0000-000000000102';

// Stand up a minimal fastify app with the auth decorator stubbed to inject
// a predictable userId. We only register the /settings route to keep the
// test surface tight.
async function makeApp() {
  const app = Fastify();
  app.decorate('authenticate', async (req: any) => {
    req.user = { userId: USER_ID };
  });
  await app.register(syncRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/sync/settings (Plan 2)', () => {
  it('propagates syncInterval="24h" to every user schedule with the correct interval_ms', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ user_id: USER_ID, sync_interval: '6h', auto_sync_enabled: true })
      .mockResolvedValueOnce({ sync_interval: '24h', auto_sync_enabled: true });
    mockPlaylistFindMany.mockResolvedValueOnce([{ id: PL1 }, { id: PL2 }]);
    mockSchedulerGet
      .mockResolvedValueOnce({ interval: 6 * 3600_000, enabled: true })
      .mockResolvedValueOnce({ interval: 6 * 3600_000, enabled: true });
    mockSchedulerUpdate.mockResolvedValue(undefined);

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { syncInterval: '24h' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.appliedInterval).toBe('24h');
    expect(body.schedulesUpdated).toBe(2);

    expect(mockSchedulerUpdate).toHaveBeenCalledTimes(2);
    const intervalArgs = mockSchedulerUpdate.mock.calls.map((c) => c[1].interval);
    expect(intervalArgs).toEqual([24 * 3600_000, 24 * 3600_000]);
    await app.close();
  });

  it('syncInterval="manual" disables every schedule without touching interval_ms', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ user_id: USER_ID, sync_interval: '6h', auto_sync_enabled: true })
      .mockResolvedValueOnce({ sync_interval: 'manual', auto_sync_enabled: true });
    mockPlaylistFindMany.mockResolvedValueOnce([{ id: PL1 }]);
    mockSchedulerGet.mockResolvedValueOnce({ interval: 6 * 3600_000, enabled: true });
    mockSchedulerUpdate.mockResolvedValue(undefined);

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { syncInterval: 'manual' },
    });

    expect(res.statusCode).toBe(200);
    const update = mockSchedulerUpdate.mock.calls[0]?.[1];
    expect(update).toMatchObject({ enabled: false });
    // manual → no interval key should be passed
    expect(update).not.toHaveProperty('interval');
    await app.close();
  });

  it('autoSyncEnabled=false flips every schedule to enabled=false (Bug B guard)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ user_id: USER_ID, sync_interval: '6h', auto_sync_enabled: true })
      .mockResolvedValueOnce({ sync_interval: '6h', auto_sync_enabled: false });
    mockPlaylistFindMany.mockResolvedValueOnce([{ id: PL1 }, { id: PL2 }]);
    mockSchedulerGet
      .mockResolvedValueOnce({ interval: 6 * 3600_000, enabled: true })
      .mockResolvedValueOnce({ interval: 6 * 3600_000, enabled: true });
    mockSchedulerUpdate.mockResolvedValue(undefined);

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { autoSyncEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.autoSyncEnabled).toBe(false);
    expect(mockSchedulerUpdate).toHaveBeenCalledTimes(2);
    mockSchedulerUpdate.mock.calls.forEach((c) => {
      expect(c[1]).toMatchObject({ enabled: false });
    });
    await app.close();
  });

  it('rejects invalid syncInterval with 400', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/settings',
      payload: { syncInterval: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
