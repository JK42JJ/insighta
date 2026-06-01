/**
 * Dedup bleed fix — exclude-set policy regression guard (CP489+).
 *
 * Per addendum acceptance gate: the new filter MUST release wizard
 * pre-fill ghost rows AND continue to exclude every real engagement
 * signal. Without this guard, future schema/query refactors could
 * silently revert to "exclude everything" (the dedup bleed).
 *
 * Test scope: query semantics through mocked prisma — no DB required.
 */

import { getExcludedVideoIds } from '@/modules/exclude/excluded-videos';

interface StateRow {
  // dummy shape used by the SQL filter — these aren't returned, only the
  // youtube_video_id row from the raw query is.
  youtube_video_id: string;
}

interface MockPrismaCalls {
  rawWhere: string[];
  /** Captured `where` args from recommendation_cache.findMany (CP492 live-feed exclude). */
  recCacheWhere: Array<Record<string, unknown>>;
}

/**
 * Build a minimal mock prisma that captures the raw SQL filter, returns
 * configured rows for user_video_states (=$queryRaw) + recommendation_cache,
 * and empty arrays for the other sources (user_local_cards, delete/archive).
 */
function makeMockPrisma(
  returnedStateRows: StateRow[],
  recCacheRows: Array<{ video_id: string }> = []
): {
  prisma: Parameters<typeof getExcludedVideoIds>[0]['prisma'];
  calls: MockPrismaCalls;
} {
  const calls: MockPrismaCalls = { rawWhere: [], recCacheWhere: [] };
  const prisma = {
    user_local_cards: { findMany: async () => [] },
    card_interactions: { findMany: async () => [] },
    recommendation_cache: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.recCacheWhere.push(args.where);
        return recCacheRows;
      },
    },
    $queryRaw: async (sqlTagged: { strings: string[]; values: unknown[] }) => {
      const joined = sqlTagged.strings.join(' ');
      calls.rawWhere.push(joined);
      return returnedStateRows;
    },
  } as unknown as Parameters<typeof getExcludedVideoIds>[0]['prisma'];
  return { prisma, calls };
}

describe('getExcludedVideoIds — Explicit > Inferred policy (CP489+)', () => {
  test('SQL filter includes the 3 explicit engagement clauses (CP490+)', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).toMatch(/is_watched\s*=\s*TRUE/);
    expect(sql).toMatch(/pinned_at\s+IS\s+NOT\s+NULL/);
    expect(sql).toMatch(/user_note\s+IS\s+NOT\s+NULL/);
  });

  test('SQL filter does NOT include the dropped CP490 clauses', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).not.toMatch(/is_in_ideation/);
    expect(sql).not.toMatch(/watch_position_seconds/);
    expect(sql).not.toMatch(/auto_added\s*=\s*FALSE/);
  });

  test('rows returned by SQL filter are added to the exclude set verbatim', async () => {
    const { prisma } = makeMockPrisma([
      { youtube_video_id: 'engagedVid1' },
      { youtube_video_id: 'engagedVid2' },
    ]);
    const excluded = await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(excluded.has('engagedVid1')).toBe(true);
    expect(excluded.has('engagedVid2')).toBe(true);
  });

  test('requestExcludeIds always pass through to the result set', async () => {
    const { prisma } = makeMockPrisma([]);
    const excluded = await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
      requestExcludeIds: ['clientSideVid1', 'clientSideVid2'],
    });
    expect(excluded.has('clientSideVid1')).toBe(true);
    expect(excluded.has('clientSideVid2')).toBe(true);
  });
});

/**
 * Policy intent checks — these aren't SQL-execution tests; they are
 * documentation-as-tests that pin the design decision so a future PR
 * cannot silently reverse it without updating the spec here too.
 *
 * For each documented row class the test asserts whether the SQL clause
 * structure CONTAINS the predicate that handles it.
 */
describe('getExcludedVideoIds — documented row classes (intent guard)', () => {
  test('is_watched=true row is still excluded (real engagement)', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(calls.rawWhere.join(' ')).toContain('is_watched = TRUE');
  });

  test('user_note IS NOT NULL row is still excluded (user took notes)', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(calls.rawWhere.join(' ')).toContain('user_note IS NOT NULL');
  });

  test('pinned_at IS NOT NULL row is still excluded (user bookmarked)', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(calls.rawWhere.join(' ')).toContain('pinned_at IS NOT NULL');
  });

  test('auto_added=true with all engagement zero is NO LONGER excluded (wizard pre-fill ghost)', async () => {
    // Wizard pre-fill row = auto_added=true + 0 engagement → none of the
    // 3 CP490+ OR clauses match → row stays in pool for LLM re-evaluation.
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).toMatch(/AND\s*\(/);
  });

  test('auto_added=false zero-engagement is NO LONGER excluded (CP490+ relaxation)', async () => {
    // CP490 directive: user_local_cards + delete/archive signals are the
    // only explicit-add exclude sources; user_video_states row without one
    // of the 3 engagement signals is re-surfaceable.
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(calls.rawWhere.join(' ')).not.toContain('auto_added = FALSE');
  });
});

/**
 * CP492 — live-feed dedup. Add Cards re-surfaced the wizard's own cards
 * (85-93% overlap measured) because the exclude set never included the
 * mandala's current recommendation_cache. The fix adds it MANDALA-SCOPED +
 * non-expired only, distinct from the CP489 user_video_states ghost policy.
 */
describe('getExcludedVideoIds — live-feed dedup (CP492)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const mandalaId = '00000000-0000-0000-0000-000000000002';

  test('recommendation_cache video_ids for this mandala are excluded', async () => {
    const { prisma } = makeMockPrisma([], [{ video_id: 'wizardVid1' }, { video_id: 'wizardVid2' }]);
    const excluded = await getExcludedVideoIds({ prisma, userId, mandalaId });
    expect(excluded.has('wizardVid1')).toBe(true);
    expect(excluded.has('wizardVid2')).toBe(true);
  });

  test('rec_cache query is MANDALA-SCOPED (no cross-mandala bleed)', async () => {
    const { prisma, calls } = makeMockPrisma([], []);
    await getExcludedVideoIds({ prisma, userId, mandalaId });
    expect(calls.recCacheWhere).toHaveLength(1);
    expect(calls.recCacheWhere[0]).toMatchObject({ user_id: userId, mandala_id: mandalaId });
  });

  test('rec_cache query filters expires_at > now (expired cards re-surfaceable, not permanent)', async () => {
    const { prisma, calls } = makeMockPrisma([], []);
    await getExcludedVideoIds({ prisma, userId, mandalaId });
    const where = calls.recCacheWhere[0] as { expires_at?: { gt?: Date } };
    expect(where.expires_at?.gt).toBeInstanceOf(Date);
  });

  test('empty rec_cache (fresh mandala) adds nothing — no starvation source', async () => {
    const { prisma } = makeMockPrisma([], []);
    const excluded = await getExcludedVideoIds({ prisma, userId, mandalaId });
    expect(excluded.size).toBe(0);
  });
});
