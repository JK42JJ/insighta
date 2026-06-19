/**
 * CP489 Phase 1 — Unit tests for ingestEnrichedToPool.
 *
 * Pin the upsert contract so future refactors cannot accidentally:
 *   - skip the quality_tier classification
 *   - mutate the conservative `source` preservation policy
 *   - swallow per-row failures (every error must increment .errors and
 *     resolve, not throw out of the helper)
 */

import {
  ingestEnrichedToPool,
  type IngestCandidate,
} from '../../../../src/skills/plugins/video-discover/v3/pool-ingest';

type UpsertCall = {
  where: { video_id: string };
  create: {
    video_id: string;
    title: string;
    view_count: bigint;
    quality_tier: string;
    source: string;
    language: string;
    is_active: boolean;
  };
  update: { refreshed_at: Date };
};

interface FakePrisma {
  video_pool: {
    upsert: jest.Mock;
  };
}

function fakePrisma(opts?: { throwForVideoId?: string }): {
  prisma: FakePrisma;
  calls: UpsertCall[];
} {
  const calls: UpsertCall[] = [];
  return {
    calls,
    prisma: {
      video_pool: {
        upsert: jest.fn(async (args: UpsertCall) => {
          if (opts?.throwForVideoId && args.where.video_id === opts.throwForVideoId) {
            throw new Error('simulated DB write failure');
          }
          calls.push(args);
          return { video_id: args.where.video_id };
        }),
      },
    },
  };
}

function sample(videoId: string, overrides: Partial<IngestCandidate> = {}): IngestCandidate {
  return {
    videoId,
    title: `title-${videoId}`,
    description: null,
    channelTitle: null,
    channelId: null,
    thumbnail: null,
    viewCount: 50_000,
    likeCount: 200,
    durationSec: 600,
    publishedDate: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ingestEnrichedToPool (CP489 Phase 1)', () => {
  it('returns zero counts on empty input', async () => {
    const { prisma } = fakePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await ingestEnrichedToPool({
      prisma: prisma as any,
      candidates: [],
      language: 'ko',
      source: 'wizard_realtime',
    });
    expect(r).toEqual({ attempted: 0, inserted: 0, errors: 0 });
  });

  it('upserts each candidate and classifies quality_tier correctly', async () => {
    const { prisma, calls } = fakePrisma();
    const r = await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [
        sample('vid-gold', { viewCount: 200_000 }),
        sample('vid-silver', { viewCount: 50_000 }),
        sample('vid-bronze', { viewCount: 500 }),
        sample('vid-null', { viewCount: null }),
      ],
      language: 'ko',
      source: 'wizard_realtime',
    });
    expect(r).toEqual({ attempted: 4, inserted: 4, errors: 0 });
    expect(calls.map((c) => c.create.quality_tier)).toEqual(['gold', 'silver', 'bronze', 'bronze']);
  });

  it('skips entries with empty videoId or empty title (defensive)', async () => {
    const { prisma } = fakePrisma();
    const r = await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [sample(''), sample('vid-1', { title: '' }), sample('vid-2')],
      language: 'ko',
      source: 'wizard_realtime',
    });
    expect(r.attempted).toBe(1);
    expect(r.inserted).toBe(1);
  });

  it('forwards source tag distinguishing wizard vs add-cards', async () => {
    const { prisma, calls } = fakePrisma();
    await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [sample('vid-w')],
      language: 'ko',
      source: 'wizard_realtime',
    });
    await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [sample('vid-a')],
      language: 'en',
      source: 'add_cards_realtime',
    });
    expect(calls.map((c) => c.create.source)).toEqual(['wizard_realtime', 'add_cards_realtime']);
    expect(calls.map((c) => c.create.language)).toEqual(['ko', 'en']);
  });

  it('UPDATE branch is conservative — refreshed_at only (source preserved)', async () => {
    const { prisma, calls } = fakePrisma();
    await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [sample('vid-1')],
      language: 'ko',
      source: 'add_cards_realtime',
    });
    const update = calls[0]!.update;
    expect(Object.keys(update)).toEqual(['refreshed_at']);
    expect(update.refreshed_at).toBeInstanceOf(Date);
  });

  it('records errors and continues on per-row failure (does not throw)', async () => {
    const { prisma } = fakePrisma({ throwForVideoId: 'vid-bad' });
    const r = await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [sample('vid-ok-1'), sample('vid-bad'), sample('vid-ok-2')],
      language: 'ko',
      source: 'wizard_realtime',
    });
    expect(r).toEqual({ attempted: 3, inserted: 2, errors: 1 });
  });

  it('handles null viewCount / likeCount / durationSec / publishedDate without throwing', async () => {
    const { prisma, calls } = fakePrisma();
    const r = await ingestEnrichedToPool({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma: prisma as any,
      candidates: [
        sample('vid-nulls', {
          viewCount: null,
          likeCount: null,
          durationSec: null,
          publishedDate: null,
        }),
      ],
      language: 'ko',
      source: 'wizard_realtime',
    });
    expect(r.inserted).toBe(1);
    expect(calls[0]!.create.view_count).toBe(0n);
  });
});
