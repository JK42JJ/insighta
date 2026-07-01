/**
 * Observability Phase 2-B — daily 5-axis rollup (§4 of the design SSOT).
 *
 * Once a day, aggregate YESTERDAY's Phase 1 trail log (search_trace +
 * search_trace_candidate) + video_pool + the live key pool into one
 * search_metrics_daily row (upsert by metric_date). Read-only over the trace
 * tables; no serving path touched.
 *
 * gc_median / gc_pct_below_65 / coverage are left NULL — relevance + coverage
 * come from the Phase 3 golden-cohort OFFLINE harness, never from live requests
 * (no LLM scorer on the serve path). Any axis is NULL when nothing was measured
 * that day (e.g. SEARCH_TRACE_ENABLED was OFF ⇒ zero trace rows) — "not measured",
 * which the daily report (chunk iii) labels distinctly from an actual 0.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { resolveSearchApiKeys } from '@/skills/plugins/video-discover/v2/youtube-client';
import { getJobQueue } from '../manager';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';

const log = logger.child({ module: 'search-metrics-rollup' });

const n = (v: unknown): number | null =>
  v == null ? null : typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v);

/** UTC [start, end) window for the day being rolled up + its metric_date. */
export function rollupWindow(now: Date): { start: Date; end: Date; metricDate: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 86_400_000);
  return { start, end, metricDate: start };
}

export interface DailyMetrics {
  requests: number | null;
  cards_p10: number | null;
  cards_p50: number | null;
  cards_p90: number | null;
  pct_ge_50: number | null;
  pct_honest_partial: number | null;
  pct_le_6mo: number | null;
  freshness: Record<string, unknown> | null;
  top_channel_share: number | null;
  channel_hhi: number | null;
  pct_view_lt_1000: number | null;
  off_lang_drops: number | null;
  pool_active: number | null;
  pool_embedded: number | null;
  pool_ttl_expired_pct: number | null;
  quota_units_total: number | null;
  active_search_keys: number | null;
  funnel: Record<string, number> | null;
  algorithm_version: string | null;
  flags_snapshot: Record<string, unknown>;
}

/** Compute all live-derivable metrics for [start, end). Read-only. */
export async function computeDailyMetrics(start: Date, end: Date): Promise<DailyMetrics> {
  const db = getPrismaClient();

  // ── request-level (search_trace) — sufficiency percentiles + quota ──
  const [req] = await db.$queryRaw<
    {
      requests: bigint;
      p10: number | null;
      p50: number | null;
      p90: number | null;
      pct_ge_50: number | null;
      pct_honest_partial: number | null;
      quota_units_total: bigint | null;
    }[]
  >`
    SELECT count(*)                                                              AS requests,
           percentile_cont(0.1) WITHIN GROUP (ORDER BY (outcome->>'cards_count')::numeric) AS p10,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (outcome->>'cards_count')::numeric) AS p50,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY (outcome->>'cards_count')::numeric) AS p90,
           100.0 * avg(CASE WHEN (outcome->>'cards_count')::numeric >= 50 THEN 1 ELSE 0 END) AS pct_ge_50,
           100.0 * avg(CASE WHEN (outcome->>'honest_partial')::boolean THEN 1 ELSE 0 END)    AS pct_honest_partial,
           sum(quota_units)                                                     AS quota_units_total
    FROM public.search_trace
    WHERE created_at >= ${start} AND created_at < ${end}`;

  const requests = n(req?.requests) ?? 0;
  const ri = (v: unknown): number | null => (n(v) == null ? null : Math.round(n(v)!)); // Int-safe

  // ── candidate-level — integrity + freshness overall ──
  const [cand] = await db.$queryRaw<
    {
      placed: bigint;
      off_lang_drops: bigint;
      placed_recent: bigint;
      placed_view_lt_1000: bigint;
      placed_with_views: bigint;
    }[]
  >`
    SELECT count(*) FILTER (WHERE c.decision = 'PLACED')                                       AS placed,
           count(*) FILTER (WHERE c.drop_reason = 'off_lang')                                  AS off_lang_drops,
           count(*) FILTER (WHERE c.decision = 'PLACED'
                            AND c.published_at >= now() - interval '6 months')                 AS placed_recent,
           count(*) FILTER (WHERE c.decision = 'PLACED' AND c.view_count < 1000)               AS placed_view_lt_1000,
           count(*) FILTER (WHERE c.decision = 'PLACED' AND c.view_count IS NOT NULL)          AS placed_with_views
    FROM public.search_trace_candidate c
    JOIN public.search_trace t USING (trace_id)
    WHERE t.created_at >= ${start} AND t.created_at < ${end}`;

  const placed = n(cand?.placed) ?? 0;
  const placedWithViews = n(cand?.placed_with_views) ?? 0;
  // percentage (0–100) rounded to 2 decimals; null when nothing to divide.
  const pct = (num: number, den: number): number | null =>
    den > 0 ? Math.round((10000 * num) / den) / 100 : null;

  // ── funnel — decision / drop_reason stage counts ──
  const funnelRows = await db.$queryRaw<{ k: string; c: bigint }[]>`
    SELECT COALESCE(c.drop_reason, c.decision) AS k, count(*) AS c
    FROM public.search_trace_candidate c
    JOIN public.search_trace t USING (trace_id)
    WHERE t.created_at >= ${start} AND t.created_at < ${end}
    GROUP BY 1`;
  const funnel = funnelRows.length
    ? Object.fromEntries(funnelRows.map((r) => [r.k, n(r.c) ?? 0]))
    : null;

  // ── diversity — channel HHI over PLACED ──
  const [div] = await db.$queryRaw<
    { total: bigint | null; top: bigint | null; hhi: number | null }[]
  >`
    WITH ch AS (
      SELECT c.channel_id, count(*) AS cnt
      FROM public.search_trace_candidate c
      JOIN public.search_trace t USING (trace_id)
      WHERE t.created_at >= ${start} AND t.created_at < ${end}
        AND c.decision = 'PLACED' AND c.channel_id IS NOT NULL
      GROUP BY c.channel_id
    )
    SELECT (SELECT sum(cnt) FROM ch) AS total,
           (SELECT max(cnt) FROM ch) AS top,
           (SELECT sum((cnt::numeric / NULLIF((SELECT sum(cnt) FROM ch), 0)) ^ 2) FROM ch) AS hhi`;
  const chTotal = n(div?.total) ?? 0;
  const chTop = n(div?.top) ?? 0;

  // ── freshness split by mandala volatility ──
  const freshRows = await db.$queryRaw<{ vol: string | null; placed: bigint; recent: bigint }[]>`
    SELECT um.volatility AS vol,
           count(*) FILTER (WHERE c.decision = 'PLACED')                                   AS placed,
           count(*) FILTER (WHERE c.decision = 'PLACED'
                            AND c.published_at >= now() - interval '6 months')             AS recent
    FROM public.search_trace_candidate c
    JOIN public.search_trace t USING (trace_id)
    LEFT JOIN public.user_mandalas um ON um.id = t.mandala_id
    WHERE t.created_at >= ${start} AND t.created_at < ${end}
    GROUP BY um.volatility`;
  const freshness = freshRows.length
    ? Object.fromEntries(
        freshRows.map((r) => {
          const p = n(r.placed) ?? 0;
          const rec = n(r.recent) ?? 0;
          return [r.vol ?? 'unknown', { placed: p, recent: rec, pct_le_6mo: pct(rec, p) }];
        })
      )
    : null;

  // ── pool health (video_pool + embeddings) ──
  const [pool] = await db.$queryRaw<{ pool_active: bigint; total: bigint; ttl_expired: bigint }[]>`
    SELECT count(*) FILTER (WHERE is_active) AS pool_active,
           count(*)                          AS total,
           count(*) FILTER (WHERE expires_at < now()) AS ttl_expired
    FROM public.video_pool`;
  const [emb] = await db.$queryRaw<{ embedded: bigint }[]>`
    SELECT count(*) AS embedded
    FROM public.video_pool v
    JOIN public.video_pool_embeddings e ON e.video_id = v.video_id
    WHERE v.is_active`;
  const poolTotal = n(pool?.total) ?? 0;

  // ── version tagging ──
  const [algo] = await db.$queryRaw<{ algorithm_version: string | null }[]>`
    SELECT algorithm_version
    FROM public.search_trace
    WHERE created_at >= ${start} AND created_at < ${end} AND algorithm_version IS NOT NULL
    GROUP BY algorithm_version ORDER BY count(*) DESC LIMIT 1`;

  return {
    requests,
    cards_p10: ri(req?.p10),
    cards_p50: ri(req?.p50),
    cards_p90: ri(req?.p90),
    pct_ge_50: n(req?.pct_ge_50),
    pct_honest_partial: n(req?.pct_honest_partial),
    pct_le_6mo: pct(n(cand?.placed_recent) ?? 0, placed),
    freshness,
    top_channel_share: pct(chTop, chTotal),
    channel_hhi: div?.hhi != null ? Math.round(Number(div.hhi) * 1000) / 1000 : null,
    pct_view_lt_1000: pct(n(cand?.placed_view_lt_1000) ?? 0, placedWithViews),
    off_lang_drops: n(cand?.off_lang_drops),
    pool_active: n(pool?.pool_active),
    pool_embedded: n(emb?.embedded),
    pool_ttl_expired_pct: pct(n(pool?.ttl_expired) ?? 0, poolTotal),
    quota_units_total: n(req?.quota_units_total),
    active_search_keys: resolveSearchApiKeys(process.env).length,
    funnel,
    algorithm_version: algo?.algorithm_version ?? null,
    flags_snapshot: { search_trace_enabled: config.searchTrace.enabled },
  };
}

/** Compute yesterday's metrics and upsert the search_metrics_daily row. */
export async function runDailyRollup(
  now: Date
): Promise<{ metricDate: Date; metrics: DailyMetrics }> {
  const { start, end, metricDate } = rollupWindow(now);
  const metrics = await computeDailyMetrics(start, end);
  const db = getPrismaClient();
  // Prisma Json columns want InputJsonValue / JsonNull, not Record | null.
  const j = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
    v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
  const data = {
    ...metrics,
    freshness: j(metrics.freshness),
    funnel: j(metrics.funnel),
    flags_snapshot: j(metrics.flags_snapshot),
  };
  await db.search_metrics_daily.upsert({
    where: { metric_date: metricDate },
    create: { metric_date: metricDate, ...data },
    update: data,
  });
  log.info(
    `metrics rollup ${metricDate.toISOString().slice(0, 10)}: requests=${metrics.requests} ` +
      `p50=${metrics.cards_p50} pct_ge_50=${metrics.pct_ge_50} keys=${metrics.active_search_keys} ` +
      `pool_active=${metrics.pool_active} quota=${metrics.quota_units_total}`
  );
  return { metricDate, metrics };
}

async function handleSearchMetricsRollup(): Promise<void> {
  try {
    await runDailyRollup(new Date());
  } catch (err) {
    log.warn(
      `metrics rollup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Register the rollup worker + daily schedule. Call after JobQueue.start(). */
export async function registerSearchMetricsRollupWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work(JOB_NAMES.SEARCH_METRICS_ROLLUP, handleSearchMetricsRollup);
  await boss.schedule(JOB_NAMES.SEARCH_METRICS_ROLLUP, QUEUE_CONFIG.SEARCH_METRICS_ROLLUP_CRON);
  log.info(
    `search-metrics-rollup worker registered + scheduled (cron=${QUEUE_CONFIG.SEARCH_METRICS_ROLLUP_CRON})`
  );
}
