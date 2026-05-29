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
}

/**
 * Build a minimal mock prisma that captures the raw SQL filter, returns
 * configured rows for user_video_states (=$queryRaw), and empty arrays
 * for the other 3 sources (user_local_cards, deleteSignals, archiveSignals).
 */
function makeMockPrisma(returnedStateRows: StateRow[]): {
  prisma: Parameters<typeof getExcludedVideoIds>[0]['prisma'];
  calls: MockPrismaCalls;
} {
  const calls: MockPrismaCalls = { rawWhere: [] };
  const prisma = {
    user_local_cards: { findMany: async () => [] },
    card_interactions: { findMany: async () => [] },
    $queryRaw: async (sqlTagged: { strings: string[]; values: unknown[] }) => {
      const joined = sqlTagged.strings.join(' ');
      calls.rawWhere.push(joined);
      return returnedStateRows;
    },
  } as unknown as Parameters<typeof getExcludedVideoIds>[0]['prisma'];
  return { prisma, calls };
}

describe('getExcludedVideoIds — Explicit > Inferred policy (CP489+)', () => {
  test('SQL filter includes all 6 engagement clauses + auto_added=FALSE', async () => {
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    expect(sql).toMatch(/is_watched\s*=\s*TRUE/);
    expect(sql).toMatch(/is_in_ideation\s*=\s*TRUE/);
    expect(sql).toMatch(/user_note\s+IS\s+NOT\s+NULL/);
    expect(sql).toMatch(/watch_position_seconds\s*>\s*0/);
    expect(sql).toMatch(/pinned_at\s+IS\s+NOT\s+NULL/);
    expect(sql).toMatch(/auto_added\s*=\s*FALSE/);
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
    // The wizard pre-fill row pattern is:
    //   auto_added=true, is_watched=false, is_in_ideation=false,
    //   user_note=NULL, watch_position_seconds=0, pinned_at=NULL
    // None of the 6 OR clauses match → row falls outside the SELECT.
    // Tested structurally by confirming NONE of the engagement clauses
    // would match such a row (verified by inspecting the SQL — actual
    // DB filtering is exercised by integration tests / prod measurement).
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    const sql = calls.rawWhere.join(' ');
    // The fix is: the SELECT has an AND clause that requires at least one
    // engagement-or-explicit signal. Without that AND, wizard pre-fill is
    // included → dedup bleed. Verify the AND structure.
    expect(sql).toMatch(/AND\s*\(/);
    expect(sql).toMatch(/auto_added\s*=\s*FALSE/);
  });

  test('auto_added=false with all engagement zero IS still excluded (user-created row, intentional)', async () => {
    // user explicitly created the row even without engagement = explicit
    // signal of intent → exclude path remains. Verified by the auto_added
    // = FALSE clause being part of the OR.
    const { prisma, calls } = makeMockPrisma([]);
    await getExcludedVideoIds({
      prisma,
      userId: '00000000-0000-0000-0000-000000000001',
      mandalaId: '00000000-0000-0000-0000-000000000002',
    });
    expect(calls.rawWhere.join(' ')).toContain('auto_added = FALSE');
  });
});
