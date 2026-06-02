/**
 * Exclude-set policy regression guard.
 *
 * CP492 supersedes the CP489/CP490 "release wizard-ghost rows" policy: because
 * user_video_states has a GLOBAL unique([user_id, video_id]) and the like UPSERT
 * never moves mandala_id, ANY owned video is un-addable. Re-surfacing one =
 * silent no-op + card-count loss (measured 20/35 Add Cards recs already owned,
 * 14 in OTHER mandalas). So the user_video_states exclude is now GLOBAL — every
 * owned video, regardless of mandala or engagement signal. recommendation_cache
 * stays mandala-scoped (#826) — different table, no unique conflict, re-addable.
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

describe('getExcludedVideoIds — GLOBAL owned exclusion (CP492)', () => {
  test('user_video_states SQL is GLOBAL: user_id only, no mandala_id, no signal clauses', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).toMatch(/user_id\s*=/);
    // Global → no mandala scoping, no engagement-signal narrowing on the
    // user_video_states query (every owned video is un-addable → excluded).
    expect(sql).not.toMatch(/mandala_id\s*=/);
    expect(sql).not.toMatch(/is_watched/);
    expect(sql).not.toMatch(/pinned_at/);
    expect(sql).not.toMatch(/user_note/);
    expect(sql).not.toMatch(/AND\s*\(/);
  });

  test('SQL does NOT include the long-dropped CP490 clauses either', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).not.toMatch(/is_in_ideation/);
    expect(sql).not.toMatch(/watch_position_seconds/);
    expect(sql).not.toMatch(/auto_added/);
  });

  test('owned videos returned by SQL are added to the exclude set verbatim', async () => {
    const { prisma } = makeMockPrisma([
      { youtube_video_id: 'ownedVid1' },
      { youtube_video_id: 'ownedVid2' },
    ]);
    const excluded = await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(excluded.has('ownedVid1')).toBe(true);
    expect(excluded.has('ownedVid2')).toBe(true);
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
 * Intent guard (documentation-as-tests). CP492 REVERSES the CP489/CP490 ghost
 * policy: an owned video — engaged or not, this mandala or another — is
 * un-addable under the global unique, so it MUST be excluded. A future PR must
 * not silently re-narrow this (it reintroduces the silent-no-op / card-count
 * bug); fix supply via fanout knobs instead.
 */
describe('getExcludedVideoIds — owned rows excluded regardless of signal (CP492)', () => {
  test('an owned video with ZERO engagement is now excluded (global), not released', async () => {
    // The mock returns rows for whatever the (now signal-less) SQL matches.
    // A zero-engagement / auto-added ghost is among the owned set → excluded.
    const { prisma } = makeMockPrisma([{ youtube_video_id: 'ghostVid' }]);
    const excluded = await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(excluded.has('ghostVid')).toBe(true);
  });

  test('SQL no longer carries the engagement-OR block (signal-agnostic)', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).not.toMatch(/is_watched\s*=\s*TRUE/);
    expect(sql).not.toMatch(/user_note\s+IS\s+NOT\s+NULL/);
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
