/**
 * CP489 Phase 2+3 — Unit tests for surfaced (shown-but-not-picked) persistence
 * + reuse-priority boost.
 *
 * Why: per user directive "이전 라운드에서 안 픽한 카드 버리지 말 것", add-cards
 * now records every shown videoId as card_interactions(signal='surfaced') and
 * boosts those candidates on subsequent searches. This file pins:
 *   1. The pure scoring contract (applySurfaceBoost) so a refactor cannot
 *      silently drop the reuse-priority behaviour.
 *   2. The two DB-touching helpers (loadSurfacedVideoIds + recordSurfacedCards)
 *      with mocked prisma so we exercise the failure-quiet contract without
 *      a real DB.
 */

import {
  applySurfaceBoost,
  loadSurfacedVideoIds,
  recordSurfacedCards,
} from '../../../src/api/routes/add-cards';

type CandidateLike = {
  videoId: string;
  score: number;
  title: string;
  channelName: string;
};

function makeCandidate(videoId: string, score: number): CandidateLike {
  return { videoId, score, title: `t-${videoId}`, channelName: `c-${videoId}` };
}

describe('applySurfaceBoost (pure scoring contract)', () => {
  it('returns the same array reference shape when set is empty', () => {
    const input = [makeCandidate('a', 0.5), makeCandidate('b', 0.3)];
    const out = applySurfaceBoost(input as never, new Set(), 0.05);
    expect(out).toBe(input);
  });

  it('returns the same array when boost <= 0 (no-op)', () => {
    const input = [makeCandidate('a', 0.5)];
    const surfaced = new Set(['a']);
    expect(applySurfaceBoost(input as never, surfaced, 0)).toBe(input);
    expect(applySurfaceBoost(input as never, surfaced, -0.1)).toBe(input);
  });

  it('multiplies score by (1 + boost) only for surfaced videoIds', () => {
    const input = [makeCandidate('a', 0.5), makeCandidate('b', 0.4)];
    const surfaced = new Set(['a']);
    const out = applySurfaceBoost(input as never, surfaced, 0.1) as CandidateLike[];
    expect(out[0]!.score).toBeCloseTo(0.55, 10);
    expect(out[1]!.score).toBe(0.4);
  });

  it('does not mutate the input array', () => {
    const input = [makeCandidate('a', 0.5)];
    const original = JSON.parse(JSON.stringify(input));
    applySurfaceBoost(input as never, new Set(['a']), 0.05);
    expect(input).toEqual(original);
  });

  it('preserves order of candidates after boost', () => {
    const input = [makeCandidate('a', 0.5), makeCandidate('b', 0.4), makeCandidate('c', 0.3)];
    const out = applySurfaceBoost(input as never, new Set(['b']), 0.05);
    expect(out.map((c) => c.videoId)).toEqual(['a', 'b', 'c']);
  });
});

describe('loadSurfacedVideoIds', () => {
  it('returns a Set of video_id strings from card_interactions rows', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ video_id: 'v1' }, { video_id: 'v2' }, { video_id: 'v3' }]);
    const prisma = { card_interactions: { findMany } } as never;
    const out = await loadSurfacedVideoIds({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
    });
    expect(out).toEqual(new Set(['v1', 'v2', 'v3']));
    expect(findMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', mandala_id: 'm1', signal: 'surfaced' },
      select: { video_id: true },
    });
  });

  it('returns empty set when no rows match', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { card_interactions: { findMany } } as never;
    const out = await loadSurfacedVideoIds({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
    });
    expect(out.size).toBe(0);
  });

  it('returns empty set (failure-quiet) when prisma throws', async () => {
    const findMany = jest.fn().mockRejectedValue(new Error('db down'));
    const prisma = { card_interactions: { findMany } } as never;
    const out = await loadSurfacedVideoIds({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
    });
    expect(out).toEqual(new Set());
  });

  it('skips null video_id rows defensively', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ video_id: 'v1' }, { video_id: null }, { video_id: 'v2' }]);
    const prisma = { card_interactions: { findMany } } as never;
    const out = await loadSurfacedVideoIds({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
    });
    expect(out).toEqual(new Set(['v1', 'v2']));
  });
});

describe('recordSurfacedCards', () => {
  it('no-ops when videoIds is empty', async () => {
    const upsert = jest.fn();
    const prisma = { card_interactions: { upsert } } as never;
    await recordSurfacedCards({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
      videoIds: [],
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('issues one upsert per videoId with signal=surfaced', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { card_interactions: { upsert } } as never;
    await recordSurfacedCards({
      prisma,
      userId: 'u1',
      mandalaId: 'm1',
      videoIds: ['v1', 'v2'],
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: {
        user_id_video_id_signal: {
          user_id: 'u1',
          video_id: 'v1',
          signal: 'surfaced',
        },
      },
      create: {
        user_id: 'u1',
        mandala_id: 'm1',
        video_id: 'v1',
        signal: 'surfaced',
      },
      update: { mandala_id: 'm1' },
    });
  });

  it('continues after a single upsert failure (failure-quiet contract)', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('unique violation'))
      .mockResolvedValueOnce({});
    const prisma = { card_interactions: { upsert } } as never;
    await expect(
      recordSurfacedCards({
        prisma,
        userId: 'u1',
        mandalaId: 'm1',
        videoIds: ['v1', 'v2', 'v3'],
      })
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(3);
  });
});
