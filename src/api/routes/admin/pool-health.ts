/**
 * Admin Pool Health dashboard data source.
 *
 * `GET /api/v1/admin/pool-health` — returns the 5-section health snapshot
 * computed from 7 raw SQL aggregations against prod tables (video_pool,
 * youtube_videos, recommendation_cache, video_summaries,
 * video_pool_embeddings, user_video_states). No writes, no DDL.
 *
 * Caching:
 *   - 5-minute in-memory cache (process-local).
 *   - Materialized snapshot on disk so a DB blip or process restart still
 *     serves the last good payload (`stale: true` flag set).
 *   - `?refresh=1` bypasses the in-memory cache for one call.
 *
 * Health bands and known-issues banner live in `src/config/pool-health.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import {
  POOL_HEALTH_THRESHOLDS,
  POOL_HEALTH_KNOWN_ISSUES,
  POOL_HEALTH_CACHE_TTL_MS,
  evaluateHealth,
  getPoolHealthSnapshotPath,
  type HealthStatus,
  type PoolHealthMetricKey,
} from '@/config/pool-health';

const log = logger.child({ module: 'api/admin/pool-health' });

interface DailyRow {
  day: string;
  n: number;
}

interface TopReuseRow {
  video_id: string;
  mandalas: number;
  users: number;
  recs: number;
}

interface SourceRow {
  source: string;
  n: number;
}

interface MetricStatus {
  key: PoolHealthMetricKey;
  label: string;
  value: number;
  unit: string;
  status: HealthStatus;
  threshold: { ok: number; warn: number; direction: string };
}

export interface PoolHealthSnapshot {
  generatedAt: string;
  fromCache: boolean;
  stale: boolean;
  metrics: MetricStatus[];
  volume: {
    totals: {
      video_pool: number;
      youtube_videos: number;
      recommendation_cache: number;
    };
    daily30d: {
      video_pool: DailyRow[];
      youtube_videos: DailyRow[];
      recommendation_cache: DailyRow[];
    };
    derived: {
      videoPoolAvgDaily30d: number;
      videoPoolBlankDays30d: number;
    };
  };
  enrich: {
    /** V1 video_summaries (legacy, mostly metadata-enriched fallback). */
    richSummaryV1: {
      total: number;
      covered: number;
      missing: number;
      pct: number;
      llmCovered: number;
      llmPct: number;
      fallbackCovered: number;
      fallbackPct: number;
    };
    /** V2 video_rich_summaries pass-quality coverage — the real enrich gauge. */
    richSummaryV2: {
      total: number;
      covered: number;
      missing: number;
      pct: number;
      modelBreakdown: Array<{ model: string; n: number }>;
    };
    embedding: { total: number; covered: number; missing: number; pct: number };
  };
  /** Mac Mini CC bulk pipeline health (proxy via DB). */
  captionPipeline: {
    attemptedTotal: number;
    attempted7d: number;
    pass7d: number;
    fail7d: number;
    failRate7d: number;
    lastAttemptedAt: string | null;
    hoursSinceLastFire: number;
  };
  source: {
    youtube_videos: SourceRow[];
    video_pool: SourceRow[];
    derived: { userInflowPct: number; nullSourcePct: number };
  };
  reuse: {
    totalRecs30d: number;
    uniqueVideos30d: number;
    avgReusePerVideo: number;
    videosIn2PlusMandalas: number;
    videosIn2PlusUsers: number;
    reuse2PlusMandalaPct: number;
    top15: TopReuseRow[];
  };
  promote: {
    statusBreakdown: Array<{ status: string; n: number }>;
    surfacedAtPresent: number;
    surfacedAtPct: number;
    mandalasWithRecs: number;
    totalDistinctRecs: number;
    totalAutoOwned: number;
    promotePct: number;
  };
  knownIssues: ReadonlyArray<{ id: string; text: string }>;
}

let cache: { data: PoolHealthSnapshot; ts: number } | null = null;

function ensureSnapshotDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      log.warn('snapshot dir create failed', {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function writeSnapshot(data: PoolHealthSnapshot): void {
  const filePath = getPoolHealthSnapshotPath();
  ensureSnapshotDir(filePath);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    log.warn('snapshot write failed', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readSnapshot(): PoolHealthSnapshot | null {
  const filePath = getPoolHealthSnapshotPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const txt = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(txt) as PoolHealthSnapshot;
  } catch (err) {
    log.warn('snapshot read failed', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function normalizeRow(r: unknown): Record<string, unknown> {
  // Prisma returns bigints for COUNT(*); convert to Number for JSON safety.
  // Caller knows the expected shape and re-asserts via the `n(...)` helper.
  if (r === null || typeof r !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

// Exported for unit testing — accepts every numeric shape Prisma's
// raw-query path actually returns: JS number, string, bigint, or
// Prisma.Decimal (a class instance with `valueOf` / `toString`).
//
// `Number(v)` delegates to `valueOf` for Decimal, parses strings, and
// widens bigints — single funnel for every shape. The first ship only
// branched on number/string/bigint, so Decimal fell to fallback 0
// silently, zeroing every rounded pct in the payload
// (richSummary / embedding / avgReuse / promote).
export function n(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value as never);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function compute(): Promise<PoolHealthSnapshot> {
  const prisma = getPrismaClient();

  // $queryRawUnsafe returns unknown[] under our tsconfig; cast at the
  // boundary and re-assert numeric fields via the `n(...)` helper.
  const queryRows = async <T>(sql: string): Promise<T[]> => await prisma.$queryRawUnsafe(sql);

  const [
    totals,
    daily30dVp,
    daily30dYv,
    daily30dRc,
    enrichSummary,
    enrichEmbedding,
    sourceYv,
    sourceVp,
    reuseSummary,
    reuseTop,
    statusBreakdown,
    surfacedRow,
    promoteRow,
    enrichV2,
    v2ModelBreakdown,
    captionPipeline,
  ] = await Promise.all([
    queryRows<Record<string, unknown>>(`
      SELECT
        (SELECT count(*) FROM video_pool)::bigint           AS video_pool_total,
        (SELECT count(*) FROM youtube_videos)::bigint       AS youtube_videos_total,
        (SELECT count(*) FROM recommendation_cache)::bigint AS recommendation_cache_total
    `),
    queryRows<DailyRow>(`
      SELECT date_trunc('day', cached_at)::date::text AS day, count(*)::int AS n
      FROM video_pool
      WHERE cached_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC
    `),
    queryRows<DailyRow>(`
      SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n
      FROM youtube_videos
      WHERE created_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC
    `),
    queryRows<DailyRow>(`
      SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n
      FROM recommendation_cache
      WHERE created_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY 1 DESC
    `),
    queryRows<Record<string, unknown>>(`
      -- V1 video_summaries — split LLM-authored vs metadata-enriched fallback.
      -- 2026-05-30 prod baseline: 4,289 total, 4,235 metadata-enriched
      -- (98.7% of covered = LLM never ran). The flat coverage number alone
      -- was structurally misleading — surface the split.
      SELECT
        count(*)::int                                                                              AS total,
        count(vs.video_id)::int                                                                    AS covered,
        (count(*) - count(vs.video_id))::int                                                       AS missing,
        round(100.0 * count(vs.video_id) / nullif(count(*),0), 1)                                  AS pct,
        count(*) FILTER (WHERE vs.model IS NOT NULL
                          AND vs.model <> 'metadata-enriched'
                          AND vs.model <> 'no-caption')::int                                       AS llm_covered,
        round(100.0 * count(*) FILTER (WHERE vs.model IS NOT NULL
                          AND vs.model <> 'metadata-enriched'
                          AND vs.model <> 'no-caption') / nullif(count(*),0), 1)                   AS llm_pct,
        count(*) FILTER (WHERE vs.model = 'metadata-enriched')::int                                AS fallback_covered,
        round(100.0 * count(*) FILTER (WHERE vs.model = 'metadata-enriched') / nullif(count(*),0), 1) AS fallback_pct
      FROM youtube_videos yv
      LEFT JOIN video_summaries vs ON vs.video_id = yv.youtube_video_id
    `),
    queryRows<Record<string, unknown>>(`
      SELECT
        count(*)::int                                              AS total,
        count(vpe.video_id)::int                                   AS covered,
        (count(*) - count(vpe.video_id))::int                      AS missing,
        round(100.0 * count(vpe.video_id) / nullif(count(*),0), 1) AS pct
      FROM video_pool vp
      LEFT JOIN (SELECT DISTINCT video_id FROM video_pool_embeddings) vpe
        ON vpe.video_id = vp.video_id
    `),
    queryRows<SourceRow>(`
      SELECT coalesce(source, '(null/legacy)') AS source, count(*)::int AS n
      FROM youtube_videos
      WHERE created_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY n DESC
    `),
    queryRows<SourceRow>(`
      SELECT source, count(*)::int AS n
      FROM video_pool
      WHERE cached_at >= now() - interval '30 days'
      GROUP BY 1 ORDER BY n DESC
    `),
    queryRows<Record<string, unknown>>(`
      WITH last30 AS (
        SELECT video_id, user_id, mandala_id
        FROM recommendation_cache
        WHERE created_at >= now() - interval '30 days'
      )
      SELECT
        count(*)::int                                                       AS total_recs,
        count(DISTINCT video_id)::int                                       AS unique_videos,
        round(1.0 * count(*) / nullif(count(DISTINCT video_id), 0), 2)      AS avg_reuse,
        (SELECT count(*) FROM (
           SELECT video_id FROM last30 GROUP BY video_id HAVING count(DISTINCT mandala_id) > 1
        ) t)::int                                                           AS videos_in_2plus_mandalas,
        (SELECT count(*) FROM (
           SELECT video_id FROM last30 GROUP BY video_id HAVING count(DISTINCT user_id) > 1
        ) t)::int                                                           AS videos_in_2plus_users
      FROM last30
    `),
    queryRows<TopReuseRow>(`
      SELECT video_id,
             count(DISTINCT mandala_id)::int AS mandalas,
             count(DISTINCT user_id)::int    AS users,
             count(*)::int                   AS recs
      FROM recommendation_cache
      WHERE created_at >= now() - interval '30 days'
      GROUP BY video_id
      ORDER BY mandalas DESC, recs DESC
      LIMIT 15
    `),
    queryRows<{ status: string; n: number }>(`
      SELECT status, count(*)::int AS n
      FROM recommendation_cache
      WHERE created_at >= now() - interval '30 days'
      GROUP BY status ORDER BY n DESC
    `),
    queryRows<Record<string, unknown>>(`
      SELECT
        count(*)::int                                                                          AS total,
        (count(*) FILTER (WHERE surfaced_at IS NOT NULL))::int                                 AS surfaced,
        round(100.0 * count(*) FILTER (WHERE surfaced_at IS NOT NULL) / nullif(count(*),0), 1) AS pct
      FROM recommendation_cache
      WHERE created_at >= now() - interval '30 days'
    `),
    queryRows<Record<string, unknown>>(`
      WITH rec_30d AS (
        SELECT user_id, mandala_id, count(DISTINCT video_id) AS recs
        FROM recommendation_cache
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1, 2
      ),
      auto_30d AS (
        SELECT user_id, mandala_id, count(*) AS auto_owned
        FROM user_video_states
        WHERE auto_added = true AND created_at >= now() - interval '30 days'
        GROUP BY 1, 2
      )
      SELECT
        count(*)::int                                                            AS mandalas_with_recs,
        coalesce(sum(r.recs), 0)::int                                            AS total_distinct_recs,
        coalesce(sum(coalesce(a.auto_owned, 0)), 0)::int                         AS total_auto_owned,
        round(100.0 * coalesce(sum(coalesce(a.auto_owned, 0)), 0) /
              nullif(coalesce(sum(r.recs), 0), 0), 1)                            AS pct
      FROM rec_30d r
      LEFT JOIN auto_30d a USING (user_id, mandala_id)
    `),
    queryRows<Record<string, unknown>>(`
      -- V2 video_rich_summaries pass-quality coverage. This is the real
      -- enrich gauge — V1 above is largely metadata-fallback noise.
      SELECT
        count(*)::int                                                                AS total,
        count(*) FILTER (WHERE vrs.video_id IS NOT NULL
                          AND vrs.quality_flag = 'pass')::int                        AS covered,
        (count(*) - count(*) FILTER (WHERE vrs.video_id IS NOT NULL
                                       AND vrs.quality_flag = 'pass'))::int          AS missing,
        round(100.0 * count(*) FILTER (WHERE vrs.video_id IS NOT NULL
                                        AND vrs.quality_flag = 'pass')
              / nullif(count(*),0), 1)                                               AS pct
      FROM youtube_videos yv
      LEFT JOIN video_rich_summaries vrs ON vrs.video_id = yv.youtube_video_id
    `),
    queryRows<{ model: string; n: number }>(`
      -- V2 model breakdown — surfaces the CC-direct vs Sonnet vs Qwen split.
      -- 2026-05-30 baseline: cc-direct 1,676 / qwen 2,551 / sonnet 43 / null 3.
      SELECT coalesce(model, '(null)') AS model, count(*)::int AS n
      FROM video_rich_summaries
      GROUP BY 1 ORDER BY n DESC
    `),
    queryRows<Record<string, unknown>>(`
      -- Caption-pipeline pulse (Mac Mini bulk path proxy).
      -- attempted_total = lifetime stamps; 7d window measures recent
      -- pulse + fail rate. last_attempted_at = the freshest stamp from any
      -- process-one.sh exit path, used as the launchd-fire proxy.
      SELECT
        count(*) FILTER (WHERE yv.transcript_attempted_at IS NOT NULL)::int                                       AS attempted_total,
        count(*) FILTER (WHERE yv.transcript_attempted_at > now() - interval '7 days')::int                       AS attempted_7d,
        count(*) FILTER (WHERE yv.transcript_attempted_at > now() - interval '7 days'
                          AND EXISTS (
                            SELECT 1 FROM video_rich_summaries vrs
                            WHERE vrs.video_id = yv.youtube_video_id
                              AND vrs.quality_flag = 'pass'
                          ))::int                                                                                 AS pass_7d,
        count(*) FILTER (WHERE yv.transcript_attempted_at > now() - interval '7 days'
                          AND NOT EXISTS (
                            SELECT 1 FROM video_rich_summaries vrs
                            WHERE vrs.video_id = yv.youtube_video_id
                              AND vrs.quality_flag = 'pass'
                          ))::int                                                                                 AS fail_7d,
        round(
          100.0 * count(*) FILTER (WHERE yv.transcript_attempted_at > now() - interval '7 days'
                                     AND NOT EXISTS (
                                       SELECT 1 FROM video_rich_summaries vrs
                                       WHERE vrs.video_id = yv.youtube_video_id
                                         AND vrs.quality_flag = 'pass'
                                     ))
          / nullif(count(*) FILTER (WHERE yv.transcript_attempted_at > now() - interval '7 days'), 0)
        , 1)                                                                                                      AS fail_rate_7d,
        max(yv.transcript_attempted_at)::text                                                                     AS last_attempted_at,
        extract(epoch FROM (now() - max(yv.transcript_attempted_at))) / 3600.0                                    AS hours_since
      FROM youtube_videos yv
    `),
  ]);

  const tot = normalizeRow(totals[0] ?? {});
  const enrSummary = normalizeRow(enrichSummary[0] ?? {});
  const enrEmbed = normalizeRow(enrichEmbedding[0] ?? {});
  const enrV2 = normalizeRow(enrichV2[0] ?? {});
  const cap = normalizeRow(captionPipeline[0] ?? {});
  const reuse = normalizeRow(reuseSummary[0] ?? {});
  const surfaced = normalizeRow(surfacedRow[0] ?? {});
  const promote = normalizeRow(promoteRow[0] ?? {});

  // Daily-inflow rows are ::int already — no bigint normalize needed.
  const vpDaily30 = daily30dVp;
  const yvDaily30 = daily30dYv;
  const rcDaily30 = daily30dRc;

  const videoPoolAvgDaily30d =
    vpDaily30.length > 0 ? Math.round(vpDaily30.reduce((acc, r) => acc + n(r.n), 0) / 30) : 0;
  const videoPoolBlankDays30d = Math.max(0, 30 - vpDaily30.length);

  const richSummaryV1Pct = n(enrSummary['pct']);
  const richSummaryV1LlmPct = n(enrSummary['llm_pct']);
  const richSummaryV2Pct = n(enrV2['pct']);
  const embeddingPct = n(enrEmbed['pct']);
  const captionFailRate7d = n(cap['fail_rate_7d']);
  const lastBulkFireHours = n(cap['hours_since']);

  const vpSourceRows = sourceVp;
  const vpSourceTotal = vpSourceRows.reduce((acc, r) => acc + n(r.n), 0);
  const userInflowRows = vpSourceRows.filter(
    (r) => r.source === 'user_curated' || r.source === 'user_playlist' || r.source === 'user_add'
  );
  const userInflowPct =
    vpSourceTotal > 0
      ? Math.round((1000 * userInflowRows.reduce((acc, r) => acc + n(r.n), 0)) / vpSourceTotal) / 10
      : 0;

  const yvSourceRows = sourceYv;
  const yvSourceTotal = yvSourceRows.reduce((acc, r) => acc + n(r.n), 0);
  const nullSourceRow = yvSourceRows.find((r) => r.source === '(null/legacy)');
  const nullSourcePct =
    yvSourceTotal > 0 && nullSourceRow
      ? Math.round((1000 * n(nullSourceRow.n)) / yvSourceTotal) / 10
      : 0;

  const avgReusePerVideo = n(reuse['avg_reuse']);
  const videosIn2PlusMandalas = n(reuse['videos_in_2plus_mandalas']);
  const uniqueVideos30d = n(reuse['unique_videos']);
  const reuse2PlusMandalaPct =
    uniqueVideos30d > 0 ? Math.round((1000 * videosIn2PlusMandalas) / uniqueVideos30d) / 10 : 0;

  const promotePct = n(promote['pct']);

  const metrics: MetricStatus[] = (
    [
      ['volumeDailyAvg30d', videoPoolAvgDaily30d],
      ['blankDays30d', videoPoolBlankDays30d],
      ['richSummaryV1Pct', richSummaryV1Pct],
      ['richSummaryV1LlmPct', richSummaryV1LlmPct],
      ['richSummaryV2Pct', richSummaryV2Pct],
      ['embeddingPct', embeddingPct],
      ['captionFailRate7d', captionFailRate7d],
      ['lastBulkFireHours', lastBulkFireHours],
      ['userInflowPct', userInflowPct],
      ['nullSourcePct', nullSourcePct],
      ['avgReusePerVideo', avgReusePerVideo],
      ['reuse2PlusMandalaPct', reuse2PlusMandalaPct],
      ['promotePct', promotePct],
    ] as ReadonlyArray<[PoolHealthMetricKey, number]>
  ).map(([key, value]) => {
    const band = POOL_HEALTH_THRESHOLDS[key];
    return {
      key,
      label: band.label,
      value,
      unit: band.unit,
      status: evaluateHealth(value, band),
      threshold: { ok: band.ok, warn: band.warn, direction: band.direction },
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    fromCache: false,
    stale: false,
    metrics,
    volume: {
      totals: {
        video_pool: n(tot['video_pool_total']),
        youtube_videos: n(tot['youtube_videos_total']),
        recommendation_cache: n(tot['recommendation_cache_total']),
      },
      daily30d: {
        video_pool: vpDaily30,
        youtube_videos: yvDaily30,
        recommendation_cache: rcDaily30,
      },
      derived: { videoPoolAvgDaily30d, videoPoolBlankDays30d },
    },
    enrich: {
      richSummaryV1: {
        total: n(enrSummary['total']),
        covered: n(enrSummary['covered']),
        missing: n(enrSummary['missing']),
        pct: richSummaryV1Pct,
        llmCovered: n(enrSummary['llm_covered']),
        llmPct: richSummaryV1LlmPct,
        fallbackCovered: n(enrSummary['fallback_covered']),
        fallbackPct: n(enrSummary['fallback_pct']),
      },
      richSummaryV2: {
        total: n(enrV2['total']),
        covered: n(enrV2['covered']),
        missing: n(enrV2['missing']),
        pct: richSummaryV2Pct,
        modelBreakdown: v2ModelBreakdown,
      },
      embedding: {
        total: n(enrEmbed['total']),
        covered: n(enrEmbed['covered']),
        missing: n(enrEmbed['missing']),
        pct: embeddingPct,
      },
    },
    captionPipeline: {
      attemptedTotal: n(cap['attempted_total']),
      attempted7d: n(cap['attempted_7d']),
      pass7d: n(cap['pass_7d']),
      fail7d: n(cap['fail_7d']),
      failRate7d: captionFailRate7d,
      lastAttemptedAt: (cap['last_attempted_at'] as string | null) ?? null,
      hoursSinceLastFire: lastBulkFireHours,
    },
    source: {
      youtube_videos: yvSourceRows,
      video_pool: vpSourceRows,
      derived: { userInflowPct, nullSourcePct },
    },
    reuse: {
      totalRecs30d: n(reuse['total_recs']),
      uniqueVideos30d,
      avgReusePerVideo,
      videosIn2PlusMandalas,
      videosIn2PlusUsers: n(reuse['videos_in_2plus_users']),
      reuse2PlusMandalaPct,
      top15: reuseTop,
    },
    promote: {
      statusBreakdown: statusBreakdown,
      surfacedAtPresent: n(surfaced['surfaced']),
      surfacedAtPct: n(surfaced['pct']),
      mandalasWithRecs: n(promote['mandalas_with_recs']),
      totalDistinctRecs: n(promote['total_distinct_recs']),
      totalAutoOwned: n(promote['total_auto_owned']),
      promotePct,
    },
    knownIssues: POOL_HEALTH_KNOWN_ISSUES,
  };
}

// ── Drill-down details ────────────────────────────────────────────────
// Lazy-loaded per metric — keeps the main /pool-health payload light.
// Each detail SQL is targeted at the specific question a metric raises:
// "what are the actual rows behind this number?"

export type PoolHealthDetailKey =
  | 'richSummaryV1Pct'
  | 'richSummaryV1LlmPct'
  | 'richSummaryV2Pct'
  | 'captionFailRate7d'
  | 'lastBulkFireHours'
  | 'nullSourcePct';

export interface PoolHealthDetail {
  metric: PoolHealthDetailKey;
  generatedAt: string;
  rows: Array<Record<string, unknown>>;
  series?: Array<{ bucket: string; n: number }>;
  notes?: string;
}

const DETAIL_SAMPLE_LIMIT = 25;

async function fetchDetail(metric: PoolHealthDetailKey): Promise<PoolHealthDetail> {
  const prisma = getPrismaClient();
  const queryRows = async <T>(sql: string): Promise<T[]> => await prisma.$queryRawUnsafe(sql);

  const base: PoolHealthDetail = {
    metric,
    generatedAt: new Date().toISOString(),
    rows: [],
  };

  switch (metric) {
    case 'richSummaryV1Pct': {
      // Split breakdown by model — surfaces the metadata-fallback share.
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT coalesce(model, '(null)') AS model, count(*)::int AS n,
               min(created_at)::text AS first_at,
               max(created_at)::text AS last_at
        FROM video_summaries
        GROUP BY 1 ORDER BY n DESC
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        notes: 'V1 video_summaries by model. metadata-enriched = LLM never ran (description-only).',
      };
    }
    case 'richSummaryV1LlmPct': {
      // The actual LLM-authored V1 rows (small set, list each).
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT vs.video_id, vs.model, vs.created_at::text AS created_at,
               yv.title, yv.channel_title, yv.duration_seconds
        FROM video_summaries vs
        LEFT JOIN youtube_videos yv ON yv.youtube_video_id = vs.video_id
        WHERE vs.model IS NOT NULL
          AND vs.model <> 'metadata-enriched'
          AND vs.model <> 'no-caption'
        ORDER BY vs.created_at DESC
        LIMIT ${DETAIL_SAMPLE_LIMIT}
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        notes:
          'Every V1 row whose model field is NOT the metadata fallback or no-caption placeholder.',
      };
    }
    case 'richSummaryV2Pct': {
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT coalesce(model, '(null)') AS model,
               quality_flag,
               count(*)::int AS n,
               max(updated_at)::text AS last_updated_at
        FROM video_rich_summaries
        GROUP BY 1, 2 ORDER BY n DESC
      `);
      const series = await queryRows<{ bucket: string; n: number }>(`
        SELECT date_trunc('day', updated_at)::date::text AS bucket, count(*)::int AS n
        FROM video_rich_summaries
        WHERE updated_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        series,
        notes:
          'V2 rows by (model, quality_flag) + 30d daily updated_at series. quick path (Haiku) writes model=null; full path (Sonnet) overwrites.',
      };
    }
    case 'captionFailRate7d': {
      // Sample failures + per-day pass/fail series for the 7d window.
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT yv.youtube_video_id, yv.title, yv.channel_title,
               yv.default_language, yv.duration_seconds,
               yv.transcript_attempted_at::text AS attempted_at,
               yv.source
        FROM youtube_videos yv
        WHERE yv.transcript_attempted_at > now() - interval '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM video_rich_summaries vrs
            WHERE vrs.video_id = yv.youtube_video_id
              AND vrs.quality_flag = 'pass'
          )
        ORDER BY yv.transcript_attempted_at DESC
        LIMIT ${DETAIL_SAMPLE_LIMIT}
      `);
      const series = await queryRows<{ bucket: string; n: number }>(`
        SELECT date_trunc('day', yv.transcript_attempted_at)::date::text AS bucket,
               count(*)::int AS n
        FROM youtube_videos yv
        WHERE yv.transcript_attempted_at > now() - interval '14 days'
          AND NOT EXISTS (
            SELECT 1 FROM video_rich_summaries vrs
            WHERE vrs.video_id = yv.youtube_video_id
              AND vrs.quality_flag = 'pass'
          )
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        series,
        notes:
          'Recent fails = attempted but no v2 pass. Cause split (awk vs WebShare proxy) requires Mac Mini log shipping.',
      };
    }
    case 'lastBulkFireHours': {
      // 24h hourly distribution of transcript_attempted_at stamps.
      const series = await queryRows<{ bucket: string; n: number }>(`
        SELECT date_trunc('hour', transcript_attempted_at)::text AS bucket,
               count(*)::int AS n
        FROM youtube_videos
        WHERE transcript_attempted_at > now() - interval '48 hours'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT youtube_video_id, title, channel_title,
               transcript_attempted_at::text AS attempted_at,
               source
        FROM youtube_videos
        WHERE transcript_attempted_at IS NOT NULL
        ORDER BY transcript_attempted_at DESC
        LIMIT ${DETAIL_SAMPLE_LIMIT}
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        series,
        notes:
          'transcript_attempted_at proxies the Mac Mini bulk pipeline pulse — each process-one.sh exit stamps it.',
      };
    }
    case 'nullSourcePct': {
      // Sample of NULL-source rows + 30d cohort breakdown.
      const rows = await queryRows<Record<string, unknown>>(`
        SELECT youtube_video_id, title, channel_title,
               created_at::text AS created_at, view_count::text AS view_count
        FROM youtube_videos
        WHERE source IS NULL
          AND created_at >= now() - interval '30 days'
        ORDER BY created_at DESC
        LIMIT ${DETAIL_SAMPLE_LIMIT}
      `);
      const series = await queryRows<{ bucket: string; n: number }>(`
        SELECT date_trunc('day', created_at)::date::text AS bucket,
               count(*) FILTER (WHERE source IS NULL)::int AS n
        FROM youtube_videos
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1 ASC
      `);
      return {
        ...base,
        rows: rows.map(normalizeRow),
        series,
        notes:
          'Pre-CP438 (2026-04-29) rows are unconditionally NULL. New rows with NULL = collector path missed the source stamp.',
      };
    }
    default: {
      const exhaustive: never = metric;
      throw new Error(`unknown metric: ${exhaustive as string}`);
    }
  }
}

export async function adminPoolHealthRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  fastify.get<{ Querystring: { refresh?: string } }>(
    '/',
    adminAuth,
    async (request: FastifyRequest<{ Querystring: { refresh?: string } }>, reply: FastifyReply) => {
      const wantRefresh = request.query?.refresh === '1';
      const now = Date.now();

      if (!wantRefresh && cache && now - cache.ts < POOL_HEALTH_CACHE_TTL_MS) {
        return reply.send({ ...cache.data, fromCache: true });
      }

      try {
        const data = await compute();
        cache = { data, ts: now };
        writeSnapshot(data);
        return reply.send(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('pool-health compute failed', { error: message });

        const snap = readSnapshot();
        if (snap) {
          return reply.send({ ...snap, stale: true, fromCache: false });
        }
        return reply.code(503).send({
          status: 'error',
          code: 'POOL_HEALTH_UNAVAILABLE',
          message,
        });
      }
    }
  );

  // Drill-down per-metric detail. Lazy-loaded so the main /pool-health
  // payload stays light; each click on a dashboard card fetches the
  // detail for that one metric.
  const DETAIL_KEYS: ReadonlySet<PoolHealthDetailKey> = new Set([
    'richSummaryV1Pct',
    'richSummaryV1LlmPct',
    'richSummaryV2Pct',
    'captionFailRate7d',
    'lastBulkFireHours',
    'nullSourcePct',
  ]);

  fastify.get<{ Params: { metric: string } }>(
    '/details/:metric',
    adminAuth,
    async (request: FastifyRequest<{ Params: { metric: string } }>, reply: FastifyReply) => {
      const metric = request.params.metric as PoolHealthDetailKey;
      if (!DETAIL_KEYS.has(metric)) {
        return reply.code(400).send({
          status: 'error',
          code: 'UNKNOWN_DETAIL_METRIC',
          message: `Unknown detail metric: ${metric}`,
        });
      }
      try {
        const detail = await fetchDetail(metric);
        return reply.send(detail);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('pool-health detail failed', { metric, error: message });
        return reply.code(503).send({
          status: 'error',
          code: 'POOL_HEALTH_DETAIL_UNAVAILABLE',
          message,
        });
      }
    }
  );
}

// Test-only export — lets unit tests assert cache behaviour without
// reaching into module-private state.
export function _resetPoolHealthCacheForTest(): void {
  cache = null;
}
