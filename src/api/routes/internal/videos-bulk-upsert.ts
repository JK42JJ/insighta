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

const log = logger.child({ module: 'api/internal/videos-bulk-upsert' });

const MAX_BATCH = 500;

/** Quality gate constants (CP438 spec §2 품질 게이트). */
const DURATION_MIN_SEC = 180;
const DURATION_MAX_SEC = 3600;
const TITLE_MIN_LEN = 5;

/**
 * Title blocklist — drop entries whose title contains any of these
 * substrings (case-insensitive). Per CP438 spec: 광고/PPL/협찬/sponsored
 * /드라마/팬편집. Kept as a single set so future tuning lives in one place.
 */
const BLOCKLIST_TOKENS: readonly string[] = [
  '광고',
  'ppl',
  '협찬',
  'sponsored',
  '드라마',
  '팬편집',
];

interface VideoMeta {
  youtube_video_id?: string;
  title?: string;
  channel_title?: string | null;
  duration_seconds?: number | null;
  view_count?: number | null;
  like_count?: number | null;
  thumbnail_url?: string | null;
  published_at?: string | null;
  default_language?: string | null;
}

interface BulkUpsertBody {
  videos?: VideoMeta[];
}

interface FilterResult {
  pass: VideoMeta[];
  filtered: { id: string; reason: string }[];
}

function applyQualityGate(videos: VideoMeta[]): FilterResult {
  const pass: VideoMeta[] = [];
  const filtered: { id: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const v of videos) {
    const id = typeof v.youtube_video_id === 'string' ? v.youtube_video_id.trim() : '';
    const title = typeof v.title === 'string' ? v.title.trim() : '';

    if (!id) {
      filtered.push({ id: '<missing>', reason: 'no_video_id' });
      continue;
    }
    if (seen.has(id)) {
      filtered.push({ id, reason: 'duplicate_in_batch' });
      continue;
    }
    seen.add(id);

    if (title.length < TITLE_MIN_LEN) {
      filtered.push({ id, reason: 'title_too_short' });
      continue;
    }
    const titleLower = title.toLowerCase();
    const blocked = BLOCKLIST_TOKENS.find((t) => titleLower.includes(t));
    if (blocked) {
      filtered.push({ id, reason: `blocklist:${blocked}` });
      continue;
    }
    if (typeof v.duration_seconds === 'number') {
      if (v.duration_seconds < DURATION_MIN_SEC) {
        filtered.push({ id, reason: 'too_short' });
        continue;
      }
      if (v.duration_seconds > DURATION_MAX_SEC) {
        filtered.push({ id, reason: 'too_long' });
        continue;
      }
    }
    pass.push({ ...v, youtube_video_id: id, title });
  }
  return { pass, filtered };
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
      // ON CONFLICT (youtube_video_id) DO NOTHING — the table has the
      // unique constraint already. RETURNING xmax = 0 distinguishes
      // freshly-inserted vs no-op rows so we can report inserted vs
      // skipped accurately in a single round-trip per video.
      for (const v of pass) {
        try {
          const result = await prisma.$queryRaw<{ inserted: boolean }[]>(Prisma.sql`
              INSERT INTO youtube_videos (
                youtube_video_id,
                title,
                channel_title,
                duration_seconds,
                view_count,
                like_count,
                thumbnail_url,
                published_at,
                default_language
              )
              VALUES (
                ${v.youtube_video_id},
                ${v.title},
                ${v.channel_title ?? null},
                ${v.duration_seconds ?? null},
                ${v.view_count ?? null},
                ${v.like_count ?? null},
                ${v.thumbnail_url ?? null},
                ${v.published_at ? new Date(v.published_at) : null},
                ${v.default_language ?? null}
              )
              ON CONFLICT (youtube_video_id) DO NOTHING
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
