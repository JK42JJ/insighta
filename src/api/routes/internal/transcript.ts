/**
 * Internal transcript pipeline endpoints (CP437, 2026-04-29).
 *
 * Protected by `INTERNAL_BATCH_TOKEN` (same shared header pattern as the
 * other internal routes). The Mac Mini transcript collector polls these
 * endpoints — never accessing the prod DB directly (Bot 절대 규칙).
 *
 *   GET  /api/v1/internal/transcript/candidates?limit=50
 *     → { videos: [{ youtube_video_id, default_language, has_caption }] }
 *
 *   POST /api/v1/internal/transcript/summarize
 *     Body: { videoId, transcript, language }
 *     → calls generateRichSummaryV2 with the supplied transcript,
 *       stamps `youtube_videos.transcript_fetched_at` on success.
 *
 * Legal directive (2026-04-29): the transcript text is NEVER persisted.
 * It lives in the request body for the duration of the LLM call only.
 */

import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';

import { getInternalBatchToken } from '@/config/internal-auth';
import { getPrismaClient } from '@/modules/database/client';
import { generateRichSummaryV2 } from '@/modules/skills/rich-summary-v2-generator';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'api/internal/transcript' });

const DEFAULT_CANDIDATE_LIMIT = 50;
const MAX_CANDIDATE_LIMIT = 200;

interface CandidateRow {
  youtube_video_id: string;
  default_language: string | null;
  has_caption: boolean | null;
}

export const internalTranscriptRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { limit?: string } }>(
    '/transcript/candidates',
    async (request, reply) => {
      const expected = getInternalBatchToken();
      if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
      const got = request.headers['x-internal-token'];
      if (typeof got !== 'string' || got !== expected) {
        return reply.code(401).send({ error: 'invalid internal token' });
      }
      const limitRaw = Number(request.query.limit ?? DEFAULT_CANDIDATE_LIMIT);
      const limit = Math.min(
        Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_CANDIDATE_LIMIT, 1),
        MAX_CANDIDATE_LIMIT
      );

      // Candidate selector:
      //   has_caption = true (YouTube reports captions exist)
      //   transcript_fetched_at IS NULL
      //   ordered by user_video_states presence (priority) then view_count
      const prisma = getPrismaClient();
      const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        yv.youtube_video_id,
        yv.default_language,
        yv.has_caption
      FROM youtube_videos yv
      LEFT JOIN (
        SELECT yv2.youtube_video_id, COUNT(*) AS bookmark_count
        FROM user_video_states uvs
        JOIN youtube_videos yv2 ON yv2.id = uvs.video_id
        GROUP BY yv2.youtube_video_id
      ) book ON book.youtube_video_id = yv.youtube_video_id
      WHERE yv.has_caption = true
        AND yv.transcript_fetched_at IS NULL
      ORDER BY
        (COALESCE(book.bookmark_count, 0) > 0) DESC,
        yv.view_count DESC NULLS LAST
      LIMIT ${Prisma.raw(String(limit))}
    `);
      return reply.code(200).send({ videos: rows });
    }
  );

  fastify.post<{
    Body: { videoId?: string; transcript?: string; language?: string };
  }>('/transcript/summarize', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }
    const body = request.body ?? {};
    const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
    const transcript = typeof body.transcript === 'string' ? body.transcript : '';
    if (!videoId) {
      return reply.code(400).send({ error: 'videoId required' });
    }
    if (transcript.length === 0) {
      return reply.code(400).send({ error: 'transcript must be non-empty' });
    }
    try {
      const outcome = await generateRichSummaryV2({
        videoId,
        transcript,
        stampTranscriptFetchedAt: true,
      });
      log.info('transcript summarize completed', {
        videoId,
        outcome: outcome.kind,
        transcriptLen: transcript.length,
      });
      return reply.code(outcome.kind === 'pass' ? 200 : 422).send(outcome);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('transcript summarize failed', { videoId, error: msg });
      return reply.code(500).send({ error: msg });
    }
  });
};
