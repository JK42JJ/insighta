/**
 * Route tests for /internal/video-pool/promote-from-youtube-videos (CP494 ②).
 *
 * The contract under test: token auth, and the SUPPLY_YT_BRIDGE_ENABLED
 * default-off no-op ({enabled:false, promoted:0} without touching the
 * promote module) — flag off must mean prod behavior unchanged.
 */

import Fastify, { type FastifyInstance } from 'fastify';

jest.mock('@/config/internal-auth', () => ({
  getInternalBatchToken: () => 'test-token',
}));

// Mutable flag the route reads through config.supplyYtBridge.enabled.
// Keep the REAL config (logger reads config.paths at import time) and
// override only the bridge flag.
const flagState = { enabled: false };
jest.mock('@/config/index', () => {
  const actual = jest.requireActual('@/config/index') as { config: Record<string, unknown> };
  return {
    ...actual,
    config: {
      ...actual.config,
      supplyYtBridge: {
        get enabled() {
          return flagState.enabled;
        },
      },
    },
  };
});

const mockPromoteYt = jest.fn();
jest.mock('@/modules/video-pool/promote-from-youtube-videos', () => ({
  promoteYoutubeVideosToPool: (...args: unknown[]) => mockPromoteYt(...args),
}));
const mockPromoteV2 = jest.fn();
jest.mock('@/modules/video-pool/promote-from-v2', () => ({
  promoteV2ToVideoPool: (...args: unknown[]) => mockPromoteV2(...args),
}));

import { internalVideoPoolPromoteRoutes } from '@/api/routes/internal/video-pool-promote';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(internalVideoPoolPromoteRoutes, { prefix: '/internal' });
  return app;
}

const URL = '/internal/video-pool/promote-from-youtube-videos';
const HEADERS = { 'x-internal-token': 'test-token', 'content-type': 'application/json' };

beforeEach(() => {
  flagState.enabled = false;
  mockPromoteYt.mockReset();
  mockPromoteV2.mockReset();
});

describe('POST /internal/video-pool/promote-from-youtube-videos', () => {
  test('rejects without internal token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(mockPromoteYt).not.toHaveBeenCalled();
    await app.close();
  });

  test('flag off (default) → {enabled:false, promoted:0} no-op', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: URL, headers: HEADERS, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: false, promoted: 0 });
    expect(mockPromoteYt).not.toHaveBeenCalled();
    await app.close();
  });

  test('flag on → delegates with clamped limit + dry_run', async () => {
    flagState.enabled = true;
    mockPromoteYt.mockResolvedValueOnce({
      candidates: 1,
      promoted: 0,
      embedded: 0,
      gold: 1,
      silver: 0,
      skipped_bronze: 0,
      skipped_rejected: 0,
      embeddings_skipped_unreachable: false,
      errors: [],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: HEADERS,
      payload: { limit: 9999, dry_run: true, skip_embeddings: true },
    });
    expect(res.statusCode).toBe(200);
    // MAX_LIMIT clamp + skip_embeddings pass-through
    expect(mockPromoteYt).toHaveBeenCalledWith({ limit: 500, dryRun: true, skipEmbeddings: true });
    const body = JSON.parse(res.body) as { enabled: boolean; dry_run: boolean };
    expect(body.enabled).toBe(true);
    expect(body.dry_run).toBe(true);
    await app.close();
  });
});
