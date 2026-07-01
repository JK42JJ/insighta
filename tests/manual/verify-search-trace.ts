/**
 * Local-only verification for the Observability Phase 1 writer (STEP 3).
 * Exercises the REAL writeSearchTrace against the LOCAL docker DB (127.0.0.1),
 * then reads both tables back to confirm the Card Journey reconstructs.
 * No external APIs, no LLM. Run: SEARCH_TRACE_ENABLED=true npx tsx tests/manual/verify-search-trace.ts
 */
import { randomUUID } from 'node:crypto';
import { writeSearchTrace, type SearchTraceCandidateInput } from '@/modules/search-trace';
import { getPrismaClient } from '@/modules/database';

async function main() {
  const traceId = randomUUID();
  const journey: SearchTraceCandidateInput[] = [
    {
      videoId: 'plc1',
      channelId: 'ch1',
      channelTitle: 'Chan 1',
      sourceKind: 'live',
      sourceCellIndex: 0,
      sourceQueryText: 'q-cell-0',
      stageReached: 'placed',
      decision: 'PLACED',
      llmPickScore: 0.82,
      llmPickReason: 'directly on-goal',
      viewCount: 123456,
      durationSec: 640,
      publishedAt: '2026-01-02T00:00:00Z',
      finalCellIndex: 0,
    },
    {
      videoId: 'np1',
      channelId: 'ch2',
      channelTitle: 'Chan 2',
      sourceKind: 'live',
      sourceCellIndex: 1,
      decision: 'DROPPED',
      dropReason: 'not_picked',
      stageReached: 'picker',
    },
    {
      videoId: 'ol1',
      sourceKind: 'live',
      sourceCellIndex: 2,
      sourceQueryText: 'q-cell-2',
      decision: 'DROPPED',
      dropReason: 'off_lang',
      stageReached: 'fanout',
    },
    {
      videoId: 'srs1',
      sourceKind: 'live',
      sourceCellIndex: 0,
      decision: 'DROPPED',
      dropReason: 'series_dedup',
      stageReached: 'diversity',
    },
    {
      videoId: 'fmv1',
      sourceKind: 'live',
      sourceCellIndex: 3,
      decision: 'DROPPED',
      dropReason: 'filter_min_views',
      stageReached: 'display_filter',
      viewCount: 8,
    },
  ];

  writeSearchTrace(
    {
      traceId,
      mandalaId: null,
      userId: null,
      trigger: 'add_cards',
      queriesGenerated: [
        { cell_index: 0, query_text: 'q-cell-0', source: 'rule' },
        { cell_index: -1, query_text: 'center goal query', source: 'center' },
      ],
      quotaUnits: 800,
      queriesAttempted: 8,
      queriesSucceeded: 8,
      queriesFailed: 0,
      counts: { raw: 320, after_exclude: 200, placed: 1, dropped: 4 },
      outcome: { cards_count: 1, empty_cells: 7, honest_partial: true },
      algorithmVersion: 'cell_binning',
    },
    journey
  );

  // Fire-and-forget → give the async write time to land.
  await new Promise((r) => setTimeout(r, 1500));

  const p = getPrismaClient();
  const st = await p.search_trace.findFirst({ where: { trace_id: traceId } });
  const cands = await p.search_trace_candidate.findMany({ where: { trace_id: traceId } });

  console.log('== search_trace ==');
  console.log(
    st
      ? {
          trigger: st.trigger,
          quota_units: st.quota_units,
          queries_attempted: st.queries_attempted,
          queries_failed: st.queries_failed,
          algorithm_version: st.algorithm_version,
          outcome: st.outcome,
        }
      : 'MISSING'
  );
  console.log(`\n== search_trace_candidate (${cands.length}) ==`);
  for (const c of cands.sort((a, b) => a.video_id.localeCompare(b.video_id))) {
    console.log(
      `  ${c.video_id}: ${c.decision}/${c.drop_reason ?? '-'} cell=${c.final_cell_index ?? c.source_cell_index} gc=${c.relevance_gc ?? 'null'} cos=${c.cosine ?? 'null'} ts=${c.ts_rank ?? 'null'} pick=${c.llm_pick_score ?? '-'} views=${c.view_count ?? '-'}`
    );
  }

  // Assertions
  const byId = Object.fromEntries(cands.map((c) => [c.video_id, c]));
  const ok =
    !!st &&
    st.quota_units === 800 &&
    cands.length === 5 &&
    byId['plc1']?.decision === 'PLACED' &&
    byId['plc1']?.relevance_gc == null &&
    byId['plc1']?.cosine == null &&
    byId['np1']?.drop_reason === 'not_picked' &&
    byId['ol1']?.drop_reason === 'off_lang' &&
    byId['srs1']?.drop_reason === 'series_dedup' &&
    byId['fmv1']?.drop_reason === 'filter_min_views';
  console.log(
    `\nRESULT add_cards: ${ok ? 'PASS — journey reconstructed, live sync gc/cosine null' : 'FAIL'}`
  );

  // ── pool_serve case — unlike the null-scored live sync path, pool-serve
  //    FILLS gc / ts_rank / source_tier. Proves those columns (Int / real /
  //    varchar) round-trip populated + live-fallback quota_units.
  const poolTraceId = randomUUID();
  writeSearchTrace(
    {
      traceId: poolTraceId,
      mandalaId: null,
      userId: null,
      trigger: 'pool_serve',
      quotaUnits: 101, // 100 search.list + 1 videos.list (live fallback)
      counts: { recruited: 12, scored: 5, pool_passed: 2, inserted: 2 },
      outcome: { cards_count: 2 },
    },
    [
      {
        videoId: 'pool1',
        sourceKind: 'pool',
        sourceTier: 'v2_promoted',
        sourceCellIndex: 3,
        decision: 'PLACED',
        stageReached: 'pool_gate',
        relevanceGc: 78,
        tsRank: 0.4213,
        finalCellIndex: 3,
      },
      {
        videoId: 'pool2',
        sourceKind: 'pool',
        sourceTier: 'v2_promoted',
        sourceCellIndex: 3,
        decision: 'DROPPED',
        dropReason: 'below_relevance_min',
        stageReached: 'pool_gate',
        relevanceGc: 41,
        tsRank: 0.2011,
      },
    ]
  );
  await new Promise((r) => setTimeout(r, 1500));
  const poolSt = await p.search_trace.findFirst({ where: { trace_id: poolTraceId } });
  const poolCands = await p.search_trace_candidate.findMany({ where: { trace_id: poolTraceId } });
  const poolById = Object.fromEntries(poolCands.map((c) => [c.video_id, c]));
  console.log(
    `\n== pool_serve candidates (${poolCands.length}), quota_units=${poolSt?.quota_units} ==`
  );
  for (const c of poolCands.sort((a, b) => a.video_id.localeCompare(b.video_id))) {
    console.log(
      `  ${c.video_id}: ${c.decision}/${c.drop_reason ?? '-'} tier=${c.source_tier ?? '-'} gc=${c.relevance_gc ?? 'null'} ts=${c.ts_rank ?? 'null'}`
    );
  }
  const poolOk =
    !!poolSt &&
    poolSt.quota_units === 101 &&
    poolCands.length === 2 &&
    poolById['pool1']?.decision === 'PLACED' &&
    poolById['pool1']?.relevance_gc === 78 &&
    poolById['pool1']?.ts_rank != null && // real column — no exact float compare
    poolById['pool1']?.source_tier === 'v2_promoted' &&
    poolById['pool2']?.drop_reason === 'below_relevance_min' &&
    poolById['pool2']?.relevance_gc === 41;
  console.log(`RESULT pool_serve: ${poolOk ? 'PASS — gc/ts_rank/source_tier populated' : 'FAIL'}`);

  // Cleanup (throwaway verification rows).
  const ids = [traceId, poolTraceId];
  await p.search_trace_candidate.deleteMany({ where: { trace_id: { in: ids } } });
  await p.search_trace.deleteMany({ where: { trace_id: { in: ids } } });
  await p.$disconnect();
  process.exit(ok && poolOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
