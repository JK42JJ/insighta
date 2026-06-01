/**
 * probeAndTagShorts() — CP491 step 3. Prisma + isShort mocked (no DB/HTTP).
 */
import { probeAndTagShorts, type PrismaLike } from '@/modules/video-pool/short-probe-runner';
import { SHORT_SIGNAL } from '@/modules/video-pool/is-short';

function makePrisma(rows: Array<{ video_id: string; duration_seconds: number | null }>) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const prisma: PrismaLike = {
    video_pool: {
      findMany: async () => rows,
      update: async (args: unknown) => {
        updates.push(args as { where: unknown; data: Record<string, unknown> });
        return {};
      },
    },
  };
  return { prisma, updates };
}

describe('probeAndTagShorts', () => {
  test('writes is_short + signal for short and normal; probe_error left NULL (no update)', async () => {
    const { prisma, updates } = makePrisma([
      { video_id: 'sh1', duration_seconds: 30 },
      { video_id: 'no1', duration_seconds: 120 },
      { video_id: 'err1', duration_seconds: 45 },
    ]);
    const isShortImpl = (async (id: string) => {
      if (id === 'sh1') return { isShort: true, signal: SHORT_SIGNAL.URL_REDIRECT };
      if (id === 'no1') return { isShort: false, signal: SHORT_SIGNAL.URL_REDIRECT };
      return { isShort: false, signal: SHORT_SIGNAL.PROBE_ERROR };
    }) as unknown as typeof import('@/modules/video-pool/is-short').isShort;

    const r = await probeAndTagShorts({ prisma, isShortImpl, delayMs: 0 });

    expect(r).toMatchObject({ probed: 2, shorts: 1, normals: 1, errors: 1, demoted: 0 });
    // err1 must NOT have been updated (left NULL for retry)
    expect(updates.map((u) => (u.where as { video_id: string }).video_id).sort()).toEqual([
      'no1',
      'sh1',
    ]);
    const shUpdate = updates.find((u) => (u.where as { video_id: string }).video_id === 'sh1')!;
    expect(shUpdate.data['is_short']).toBe(true);
    expect(shUpdate.data['short_signal']).toBe(SHORT_SIGNAL.URL_REDIRECT);
    expect(shUpdate.data['short_probed_at']).toBeInstanceOf(Date);
    expect(shUpdate.data['is_active']).toBeUndefined(); // demote default false
  });

  test('demote=true soft-deletes shorts only', async () => {
    const { prisma, updates } = makePrisma([
      { video_id: 'sh1', duration_seconds: 30 },
      { video_id: 'no1', duration_seconds: 120 },
    ]);
    const isShortImpl = (async (id: string) => ({
      isShort: id === 'sh1',
      signal: SHORT_SIGNAL.URL_REDIRECT,
    })) as unknown as typeof import('@/modules/video-pool/is-short').isShort;

    const r = await probeAndTagShorts({ prisma, isShortImpl, demote: true, delayMs: 0 });

    expect(r.demoted).toBe(1);
    const shUpdate = updates.find((u) => (u.where as { video_id: string }).video_id === 'sh1')!;
    const noUpdate = updates.find((u) => (u.where as { video_id: string }).video_id === 'no1')!;
    expect(shUpdate.data['is_active']).toBe(false);
    expect(noUpdate.data['is_active']).toBeUndefined(); // normal not demoted
  });

  test('empty backlog → zero counts', async () => {
    const { prisma } = makePrisma([]);
    const r = await probeAndTagShorts({ prisma, delayMs: 0 });
    expect(r).toEqual({ probed: 0, shorts: 0, normals: 0, errors: 0, demoted: 0 });
  });
});
