/**
 * Local-only verification for the Phase 2-B daily rollup (chunk ii).
 * Inserts synthetic search_trace + candidate rows into an ISOLATED past-date
 * window (2020-01-01, guaranteed empty), runs the REAL runDailyRollup against
 * the LOCAL docker DB, asserts the computed metrics, then cleans up.
 * No external APIs, no LLM. Run: npx tsx tests/manual/verify-metrics-rollup.ts
 */
import { randomUUID } from 'node:crypto';
import { getPrismaClient } from '@/modules/database';
import { runDailyRollup } from '@/modules/queue/handlers/search-metrics-rollup';

const DAY = new Date('2020-01-01T12:00:00Z'); // inside the isolated window
const NOW = new Date('2020-01-02T06:00:00Z'); // rolls up 2020-01-01
const METRIC_DATE = new Date('2020-01-01T00:00:00Z');
const RECENT = new Date(); // < 6 months old
const OLD = new Date('2019-01-01T00:00:00Z'); // > 6 months old

async function main() {
  const db = getPrismaClient();
  const [t1, t2, t3] = [randomUUID(), randomUUID(), randomUUID()];

  // 3 requests: card counts 10 / 50 / 90 → p50=50, pct_ge_50=66.67; 1 honest_partial.
  await db.search_trace.createMany({
    data: [
      {
        trace_id: t1,
        trigger: 'add_cards',
        created_at: DAY,
        started_at: DAY,
        quota_units: 100,
        outcome: { cards_count: 10, honest_partial: true },
        algorithm_version: 'cell_binning',
      },
      {
        trace_id: t2,
        trigger: 'add_cards',
        created_at: DAY,
        started_at: DAY,
        quota_units: 100,
        outcome: { cards_count: 50 },
      },
      {
        trace_id: t3,
        trigger: 'add_cards',
        created_at: DAY,
        started_at: DAY,
        quota_units: 100,
        outcome: { cards_count: 90 },
      },
    ],
  });
  // Candidates under t1: 3 PLACED (ch1,ch1,ch2 → HHI), 1 off_lang, 1 not_picked.
  await db.search_trace_candidate.createMany({
    data: [
      {
        trace_id: t1,
        video_id: 'c1',
        channel_id: 'ch1',
        source_kind: 'live',
        decision: 'PLACED',
        published_at: RECENT,
        view_count: 5000,
        final_cell_index: 0,
      },
      {
        trace_id: t1,
        video_id: 'c2',
        channel_id: 'ch1',
        source_kind: 'live',
        decision: 'PLACED',
        published_at: RECENT,
        view_count: 500,
      },
      {
        trace_id: t1,
        video_id: 'c3',
        channel_id: 'ch2',
        source_kind: 'live',
        decision: 'PLACED',
        published_at: OLD,
        view_count: 5000,
      },
      {
        trace_id: t1,
        video_id: 'c4',
        source_kind: 'live',
        decision: 'DROPPED',
        drop_reason: 'off_lang',
      },
      {
        trace_id: t1,
        video_id: 'c5',
        source_kind: 'live',
        decision: 'DROPPED',
        drop_reason: 'not_picked',
      },
    ],
  });

  const { metrics } = await runDailyRollup(NOW);

  const round = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
  console.log('== computed metrics ==');
  console.log({
    requests: metrics.requests,
    cards_p10: metrics.cards_p10,
    cards_p50: metrics.cards_p50,
    cards_p90: metrics.cards_p90,
    pct_ge_50: round(metrics.pct_ge_50),
    pct_honest_partial: round(metrics.pct_honest_partial),
    pct_le_6mo: metrics.pct_le_6mo,
    pct_view_lt_1000: metrics.pct_view_lt_1000,
    top_channel_share: metrics.top_channel_share,
    channel_hhi: metrics.channel_hhi,
    off_lang_drops: metrics.off_lang_drops,
    quota_units_total: metrics.quota_units_total,
    funnel: metrics.funnel,
    gc_median: metrics.gc_median, // must stay null (Phase 3)
  });

  // Read the persisted row back too (proves the upsert).
  const row = await db.search_metrics_daily.findUnique({ where: { metric_date: METRIC_DATE } });

  const approx = (v: number | null, target: number) => v != null && Math.abs(v - target) < 0.5;
  const ok =
    !!row &&
    metrics.requests === 3 &&
    metrics.cards_p50 === 50 &&
    approx(metrics.pct_ge_50, 66.67) &&
    approx(metrics.pct_honest_partial, 33.33) &&
    metrics.quota_units_total === 300 &&
    metrics.off_lang_drops === 1 &&
    approx(metrics.pct_le_6mo, 66.67) &&
    approx(metrics.pct_view_lt_1000, 33.33) &&
    approx(metrics.top_channel_share, 66.67) &&
    approx((metrics.channel_hhi ?? 0) * 100, 55.6) &&
    metrics.funnel?.['PLACED'] === 3 &&
    metrics.funnel?.['off_lang'] === 1 &&
    metrics.funnel?.['not_picked'] === 1 &&
    metrics.gc_median == null && // Phase 3 — must NOT be computed live
    (metrics.active_search_keys ?? 0) >= 0;
  console.log(
    `\nRESULT: ${ok ? 'PASS — 5-axis rollup computed + persisted, gc null (Phase 3)' : 'FAIL'}`
  );

  // Cleanup.
  await db.search_trace_candidate.deleteMany({ where: { trace_id: { in: [t1, t2, t3] } } });
  await db.search_trace.deleteMany({ where: { trace_id: { in: [t1, t2, t3] } } });
  await db.search_metrics_daily.deleteMany({ where: { metric_date: METRIC_DATE } });
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
