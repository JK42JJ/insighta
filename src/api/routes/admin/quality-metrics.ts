/**
 * Admin Quality Metrics Routes
 *
 * POST /api/v1/admin/quality-metrics/recompute — batch-recompute M1+M3 for existing rows
 * GET  /api/v1/admin/quality-metrics/summary   — aggregate stats across all rows
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '@/modules/database/client';
import { createSuccessResponse } from '../../schemas/common.schema';
import { computeSpecificity } from '@/modules/quality-metrics';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'AdminQualityMetrics' });

const DEFAULT_RECOMPUTE_LIMIT = 1000;

// ============================================================================
// Schemas
// ============================================================================

const RecomputeBodySchema = z.object({
  qualityFlag: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().min(1).max(5000).default(DEFAULT_RECOMPUTE_LIMIT),
});

// ============================================================================
// Helpers
// ============================================================================

interface RichSummaryRow {
  video_id: string;
  structured: unknown;
  title: string | null;
}

// ============================================================================
// Routes
// ============================================================================

export async function adminQualityMetricsRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * POST /api/v1/admin/quality-metrics/recompute
   * Fetch matching rows, compute M1+M3 metrics, update each row.
   */
  fastify.post('/recompute', adminAuth, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = RecomputeBodySchema.parse(request.body);

    const conditions: string[] = ['vrs.structured IS NOT NULL'];
    const params: unknown[] = [];
    let idx = 1;

    if (body.qualityFlag) {
      conditions.push(`vrs.quality_flag = $${idx}`);
      params.push(body.qualityFlag);
      idx++;
    }
    if (body.dateFrom) {
      conditions.push(`vrs.updated_at >= $${idx}::timestamptz`);
      params.push(body.dateFrom);
      idx++;
    }
    if (body.dateTo) {
      conditions.push(`vrs.updated_at <= $${idx}::timestamptz`);
      params.push(body.dateTo);
      idx++;
    }

    params.push(body.limit);
    const whereClause = conditions.join(' AND ');

    const rows = await db.$queryRawUnsafe<RichSummaryRow[]>(
      `SELECT
           vrs.video_id,
           vrs.structured,
           yv.title
         FROM public.video_rich_summaries vrs
         LEFT JOIN public.youtube_videos yv ON yv.youtube_video_id = vrs.video_id
         WHERE ${whereClause}
         LIMIT $${idx}`,
      ...params
    );

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const title = row.title ?? row.video_id;
      const structured = row.structured as Record<string, unknown> | null;
      const metrics = computeSpecificity(title, structured);

      if (!metrics) {
        skipped++;
        continue;
      }

      try {
        await db.video_rich_summaries.update({
          where: { video_id: row.video_id },
          data: {
            m1_title_overlap: metrics.m1TitleOverlap,
            m3_timestamp_null_ratio: metrics.m3TimestampNullRatio,
            m3_timestamp_pattern: metrics.m3TimestampPattern,
            specificity_score: metrics.specificityScore,
          },
        });
        updated++;
      } catch (err) {
        log.error('Failed to update metrics for video', {
          videoId: row.video_id,
          error: err instanceof Error ? err.message : String(err),
        });
        skipped++;
      }
    }

    log.info('Quality metrics recompute completed', { updated, skipped, total: rows.length });

    return reply.send(createSuccessResponse({ total: rows.length, updated, skipped }));
  });

  /**
   * GET /api/v1/admin/quality-metrics/summary
   * Aggregate stats: by quality_flag, by schema version, daily averages, outliers.
   */
  fastify.get('/summary', adminAuth, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Total count
    const [totalRow] = await db.$queryRaw<Array<{ total: bigint }>>`
        SELECT COUNT(*) AS total FROM public.video_rich_summaries
      `;
    const total = Number(totalRow?.total ?? 0);

    // By quality_flag: count + avg/p25/p50/p75 specificity
    const byFlagRows = await db.$queryRaw<
      Array<{
        quality_flag: string | null;
        cnt: bigint;
        avg_specificity: number | null;
        p25: number | null;
        p50: number | null;
        p75: number | null;
      }>
    >`
        SELECT
          quality_flag,
          COUNT(*)                                                  AS cnt,
          AVG(specificity_score)                                    AS avg_specificity,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY specificity_score) AS p25,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY specificity_score) AS p50,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY specificity_score) AS p75
        FROM public.video_rich_summaries
        GROUP BY quality_flag
      `;

    const byQualityFlag: Record<
      string,
      {
        count: number;
        avg_specificity: number | null;
        p25: number | null;
        p50: number | null;
        p75: number | null;
      }
    > = {};
    for (const r of byFlagRows) {
      const key = r.quality_flag ?? 'null';
      byQualityFlag[key] = {
        count: Number(r.cnt),
        avg_specificity: r.avg_specificity != null ? Number(r.avg_specificity) : null,
        p25: r.p25 != null ? Number(r.p25) : null,
        p50: r.p50 != null ? Number(r.p50) : null,
        p75: r.p75 != null ? Number(r.p75) : null,
      };
    }

    // By schema version (V2 = has atoms array, V1 = no atoms)
    const bySchemaRows = await db.$queryRaw<
      Array<{
        schema_version: string;
        cnt: bigint;
        avg_m1: number | null;
        avg_m3_null_ratio: number | null;
      }>
    >`
        SELECT
          CASE
            WHEN structured->'atoms' IS NOT NULL THEN 'v2'
            ELSE 'v1'
          END                         AS schema_version,
          COUNT(*)                    AS cnt,
          AVG(m1_title_overlap)       AS avg_m1,
          AVG(m3_timestamp_null_ratio) AS avg_m3_null_ratio
        FROM public.video_rich_summaries
        WHERE structured IS NOT NULL
        GROUP BY schema_version
      `;

    const bySchema: Record<
      string,
      { count: number; avg_m1: number | null; avg_m3_null_ratio: number | null | 'N/A' }
    > = {};
    for (const r of bySchemaRows) {
      bySchema[r.schema_version] = {
        count: Number(r.cnt),
        avg_m1: r.avg_m1 != null ? Number(r.avg_m1) : null,
        avg_m3_null_ratio:
          r.schema_version === 'v1'
            ? 'N/A'
            : r.avg_m3_null_ratio != null
              ? Number(r.avg_m3_null_ratio)
              : null,
      };
    }

    // Daily average specificity (last 30 days)
    const dailyRows = await db.$queryRaw<
      Array<{ date: string; avg_specificity: number | null; cnt: bigint }>
    >`
        SELECT
          DATE(updated_at AT TIME ZONE 'UTC') AS date,
          AVG(specificity_score)              AS avg_specificity,
          COUNT(*)                            AS cnt
        FROM public.video_rich_summaries
        WHERE updated_at >= NOW() - INTERVAL '30 days'
          AND specificity_score IS NOT NULL
        GROUP BY DATE(updated_at AT TIME ZONE 'UTC')
        ORDER BY date DESC
      `;

    const dailyAvg = dailyRows.map((r) => ({
      date: r.date,
      avg_specificity: r.avg_specificity != null ? Number(r.avg_specificity) : null,
      count: Number(r.cnt),
    }));

    // Top 10 and bottom 10 by specificity_score
    const top10 = await db.$queryRaw<Array<{ video_id: string; specificity_score: number }>>`
        SELECT video_id, specificity_score
        FROM public.video_rich_summaries
        WHERE specificity_score IS NOT NULL
        ORDER BY specificity_score DESC
        LIMIT 10
      `;

    const bottom10 = await db.$queryRaw<Array<{ video_id: string; specificity_score: number }>>`
        SELECT video_id, specificity_score
        FROM public.video_rich_summaries
        WHERE specificity_score IS NOT NULL
        ORDER BY specificity_score ASC
        LIMIT 10
      `;

    return reply.send(
      createSuccessResponse({
        total,
        by_quality_flag: byQualityFlag,
        by_schema: bySchema,
        daily_avg: dailyAvg,
        outliers: {
          top_10: top10.map((r) => ({
            video_id: r.video_id,
            specificity_score: Number(r.specificity_score),
          })),
          bottom_10: bottom10.map((r) => ({
            video_id: r.video_id,
            specificity_score: Number(r.specificity_score),
          })),
        },
      })
    );
  });
}
