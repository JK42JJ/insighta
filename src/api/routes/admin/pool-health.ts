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
    richSummary: { total: number; covered: number; missing: number; pct: number };
    embedding: { total: number; covered: number; missing: number; pct: number };
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

function n(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'bigint') return Number(value);
  return fallback;
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
      SELECT
        count(*)::int                                             AS total,
        count(vs.video_id)::int                                   AS covered,
        (count(*) - count(vs.video_id))::int                      AS missing,
        round(100.0 * count(vs.video_id) / nullif(count(*),0), 1) AS pct
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
  ]);

  const tot = normalizeRow(totals[0] ?? {});
  const enrSummary = normalizeRow(enrichSummary[0] ?? {});
  const enrEmbed = normalizeRow(enrichEmbedding[0] ?? {});
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

  const richSummaryPct = n(enrSummary['pct']);
  const embeddingPct = n(enrEmbed['pct']);

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
      ['richSummaryPct', richSummaryPct],
      ['embeddingPct', embeddingPct],
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
      richSummary: {
        total: n(enrSummary['total']),
        covered: n(enrSummary['covered']),
        missing: n(enrSummary['missing']),
        pct: richSummaryPct,
      },
      embedding: {
        total: n(enrEmbed['total']),
        covered: n(enrEmbed['covered']),
        missing: n(enrEmbed['missing']),
        pct: embeddingPct,
      },
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
}

// Test-only export — lets unit tests assert cache behaviour without
// reaching into module-private state.
export function _resetPoolHealthCacheForTest(): void {
  cache = null;
}
