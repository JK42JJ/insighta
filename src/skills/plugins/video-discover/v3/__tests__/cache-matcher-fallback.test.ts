/**
 * Regression: two-stage pool matching must degrade to the brute-force path
 * instead of throwing — a cold-cache run blew Prisma's 5s default transaction
 * timeout and zeroed out step2 (0-card mandala, 2026-07-11 08:08Z).
 */

jest.mock('@/modules/database', () => ({ getPrismaClient: jest.fn() }));
jest.mock('@/modules/discover-tracing', () => ({ recordTrace: jest.fn() }));
jest.mock('../config', () => ({
  v3Config: {
    poolMatchTwoStage: true,
    poolMatchShortlistK: 32,
    poolMatchOverfetch: 256,
    poolMatchEfSearch: 400,
    poolMatchTxTimeoutMs: 30000,
  },
}));

import { getPrismaClient } from '@/modules/database';
import { recordTrace } from '@/modules/discover-tracing';
import { matchFromVideoPool, matchFromVideoPoolByCenterGoal } from '../cache-matcher';

const mockGetPrismaClient = getPrismaClient as jest.Mock;
const mockRecordTrace = recordTrace as jest.Mock;

function poolRow(overrides: Record<string, unknown> = {}) {
  return {
    video_id: 'vid-1',
    title: 'brute row',
    description: null,
    channel_name: null,
    channel_id: null,
    thumbnail_url: null,
    view_count: null,
    like_count: null,
    duration_seconds: null,
    published_at: null,
    cell_index: 0,
    score: 0.9,
    rn: 1n,
    ...overrides,
  };
}

describe('two-stage pool match fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('matchFromVideoPool: tx failure falls back to brute query instead of throwing', async () => {
    const db = {
      $transaction: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Transaction already closed: A query cannot be executed on an expired transaction.'
          )
        ),
      $queryRaw: jest.fn().mockResolvedValue([poolRow()]),
    };
    mockGetPrismaClient.mockReturnValue(db);

    const out = await matchFromVideoPool({ mandalaId: 'm-1', language: 'ko' });

    expect(out).toHaveLength(1);
    expect(out[0]!.videoId).toBe('vid-1');
    expect(db.$queryRaw).toHaveBeenCalledTimes(1); // brute path ran
    const trace = mockRecordTrace.mock.calls[0]![0];
    expect(trace.request.two_stage_fallback).toBe(true);
  });

  test('matchFromVideoPool: two-stage success does not touch the brute query', async () => {
    const db = {
      $transaction: jest.fn().mockResolvedValue([poolRow({ title: 'two-stage row' })]),
      $queryRaw: jest.fn(),
    };
    mockGetPrismaClient.mockReturnValue(db);

    const out = await matchFromVideoPool({ mandalaId: 'm-1', language: 'ko' });

    expect(out[0]!.title).toBe('two-stage row');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    // the tx timeout knob must reach Prisma — default 5s is what broke prod
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
    const trace = mockRecordTrace.mock.calls[0]![0];
    expect(trace.request.two_stage_fallback).toBe(false);
  });

  test('matchFromVideoPoolByCenterGoal: tx failure falls back to brute query', async () => {
    const db = {
      $transaction: jest.fn().mockRejectedValue(new Error('boom')),
      $queryRaw: jest.fn().mockResolvedValue([poolRow({ cell_index: undefined, rn: undefined })]),
    };
    mockGetPrismaClient.mockReturnValue(db);

    const out = await matchFromVideoPoolByCenterGoal({
      centerEmbedding: [0.1, 0.2],
      language: 'ko',
      subGoals: ['a', 'b'],
    });

    expect(out).toHaveLength(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const trace = mockRecordTrace.mock.calls[0]![0];
    expect(trace.request.two_stage_fallback).toBe(true);
  });
});
