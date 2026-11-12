/**
 * Internal videos bulk-upsert endpoint (CP438, 2026-04-29).
 *
 * Mac Mini new-collector posts batches of YouTube video metadata here. The
 * endpoint applies a server-side quality gate, dedupes against existing
 * youtube_videos rows via `ON CONFLICT (youtube_video_id) DO NOTHING`,
 * and reports per-batch counts.
 *
 *   POST /api/v1/internal/videos/bulk-upsert
 *   Body: { videos: VideoMeta[] } — max 500 per call
 *   Auth: x-internal-token header (same pattern as transcript routes).
 *
 * Hard Rule (CP438 spec):
 *   - No LLM API call from this path.
 *   - No yt-dlp execution server-side (Mac Mini is the truth source).
 *     The Mac Mini collector MUST route yt-dlp traffic through the
 *     WebShare rotating proxy pool — direct YouTube hits bot-gate within
 *     minutes (CP401/CP411 LEVEL-2 pattern). The endpoint cannot enforce
 *     this server-side; it is a collector-side contract.
 *   - Mandala-derived collection is permanently excluded — Mac Mini
 *     collector enforces source taxonomy; the endpoint is source-agnostic
 *     and trusts the caller's pipeline.
 */

import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';

import { getInternalBatchToken } from '@/config/internal-auth';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import { applyQualityGate, type VideoMeta } from '@/modules/video-pool/ingest-quality-gate';

const log = logger.child({ module: 'api/internal/videos-bulk-upsert' });

const MAX_BATCH = 500;

interface BulkUpsertBody {
  videos?: VideoMeta[];
}

export const internalVideosBulkUpsertRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: BulkUpsertBody }>('/videos/bulk-upsert', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) {
      return reply.code(503).send({ error: 'internal trigger not configured' });
    }
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }
    const videos = Array.isArray(request.body?.videos) ? request.body.videos : [];
    if (videos.length === 0) {
      return reply.code(400).send({ error: 'videos[] required' });
    }
    if (videos.length > MAX_BATCH) {
      return reply.code(400).send({
        error: `batch too large (max ${MAX_BATCH}, got ${videos.length})`,
      });
    }

    const { pass, filtered } = applyQualityGate(videos);

    let inserted = 0;
    let skippedDuplicate = 0;
    const dbErrors: { id: string; error: string }[] = [];

    if (pass.length > 0) {
      const prisma = getPrismaClient();
      // ON CONFLICT (youtube_video_id) DO UPDATE — CP438 introduced
      // `source` and we want re-submits to update that attribution
      // (a video re-discovered via a different pipeline path keeps the
      // most-recent source). Everything else stays read-only on
      // conflict so a stale collector dump can't overwrite freshly
      // fetched metadata from another path. RETURNING (xmax = 0) AS
      // inserted distinguishes a fresh INSERT (xmax=0) from an UPDATE
      // (xmax!=0) in a single round-trip per video.
      for (const v of pass) {
        try {
          const result = await prisma.$queryRaw<{ inserted: boolean }[]>(Prisma.sql`
              INSERT INTO youtube_videos (
                youtube_video_id,
                title,
                description,
                channel_id,
                channel_title,
                duration_seconds,
                view_count,
                like_count,
                thumbnail_url,
                published_at,
                default_language,
                source
              )
              VALUES (
                ${v.youtube_video_id},
                ${v.title},
                ${v.description ?? null},
                ${v.channel_id ?? null},
                ${v.channel_title ?? null},
                ${v.duration_seconds ?? null},
                ${v.view_count ?? null},
                ${v.like_count ?? null},
                ${v.thumbnail_url ?? null},
                ${v.published_at ? new Date(v.published_at) : null},
                ${v.default_language ?? null},
                ${v.source ?? null}
              )
              ON CONFLICT (youtube_video_id) DO UPDATE
                SET source = COALESCE(EXCLUDED.source, youtube_videos.source),
                    -- CP494 ② — backfill description/channel_id when a re-submit
                    -- carries them and the existing row is NULL (prefer existing
                    -- non-null so a stale dump can't blank a populated row).
                    description = COALESCE(youtube_videos.description, EXCLUDED.description),
                    channel_id = COALESCE(youtube_videos.channel_id, EXCLUDED.channel_id)
              RETURNING (xmax = 0) AS inserted
            `);
          if (result.length > 0 && result[0]!.inserted) {
            inserted += 1;
          } else {
            skippedDuplicate += 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dbErrors.push({ id: v.youtube_video_id!, error: msg.slice(0, 200) });
        }
      }
    }

    log.info('videos bulk-upsert done', {
      received: videos.length,
      passed_filter: pass.length,
      inserted,
      skipped_duplicate: skippedDuplicate,
      skipped_filter: filtered.length,
      db_errors: dbErrors.length,
    });

    return reply.code(200).send({
      received: videos.length,
      inserted,
      skipped_duplicate: skippedDuplicate,
      skipped_filter: filtered.length,
      db_errors: dbErrors.length,
      ...(filtered.length > 0 ? { filter_breakdown: aggregateReasons(filtered) } : {}),
      ...(dbErrors.length > 0 ? { db_errors_sample: dbErrors.slice(0, 5) } : {}),
    });
  });
};

function aggregateReasons(items: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    out[it.reason] = (out[it.reason] ?? 0) + 1;
  }
  return out;
}
