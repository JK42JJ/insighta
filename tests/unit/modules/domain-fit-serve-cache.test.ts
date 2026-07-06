/**
 * domain-fit-shadow/serve-cache — thin Prisma adapter for DomainFitServeCache.
 *
 * Pins:
 *   - get(): row present + a valid fit label → mapped entry; NO row, or a
 *     row whose fit column isn't a valid label (defensive — should never
 *     happen since set() only ever writes '적합'/'비적합') → null (miss).
 *   - set(): issues an upsert (INSERT ... ON CONFLICT DO UPDATE) scoped to
 *     the (video_id, mandala_id) the cache was constructed with.
 */

import { createPrismaDomainFitServeCache } from '@/modules/domain-fit-shadow/serve-cache';

function makePrismaMock() {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn().mockResolvedValue(1);
  return {
    prisma: { $queryRaw: queryRaw, $executeRaw: executeRaw } as unknown as Parameters<
      typeof createPrismaDomainFitServeCache
    >[0],
    queryRaw,
    executeRaw,
  };
}

describe('createPrismaDomainFitServeCache — get()', () => {
  it('maps a cached row to a DomainFitServeCacheEntry', async () => {
    const { prisma, queryRaw } = makePrismaMock();
    const scoredAt = new Date('2026-07-01T00:00:00Z');
    queryRaw.mockResolvedValueOnce([
      {
        fit: '비적합',
        lexical_conflict: true,
        multiplier: 0.2,
        model: 'mandala-gen:latest',
        scored_at: scoredAt,
      },
    ]);
    const cache = createPrismaDomainFitServeCache(prisma, 'mandala-1');
    const entry = await cache.get('vid12345678');
    expect(entry).toEqual({
      fit: '비적합',
      lexicalConflict: true,
      multiplier: 0.2,
      model: 'mandala-gen:latest',
      scoredAt: scoredAt.toISOString(),
    });
  });

  it('returns null on an empty result (cache miss)', async () => {
    const { prisma, queryRaw } = makePrismaMock();
    queryRaw.mockResolvedValueOnce([]);
    const cache = createPrismaDomainFitServeCache(prisma, 'mandala-1');
    await expect(cache.get('vid12345678')).resolves.toBeNull();
  });

  it('defensively treats a row with a non-fit-label fit column as a miss', async () => {
    const { prisma, queryRaw } = makePrismaMock();
    queryRaw.mockResolvedValueOnce([
      {
        fit: null,
        lexical_conflict: false,
        multiplier: 1,
        model: 'mandala-gen:latest',
        scored_at: new Date(),
      },
    ]);
    const cache = createPrismaDomainFitServeCache(prisma, 'mandala-1');
    await expect(cache.get('vid12345678')).resolves.toBeNull();
  });
});

describe('createPrismaDomainFitServeCache — set()', () => {
  it('issues exactly one $executeRaw upsert call', async () => {
    const { prisma, executeRaw } = makePrismaMock();
    const cache = createPrismaDomainFitServeCache(prisma, 'mandala-1');
    await cache.set('vid12345678', {
      fit: '적합',
      lexicalConflict: false,
      multiplier: 1,
      model: 'mandala-gen:latest',
      scoredAt: new Date('2026-07-01T00:00:00Z').toISOString(),
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
