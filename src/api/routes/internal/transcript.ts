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
import {
  validateV2Layered,
  validateV2Segments,
  scoreCompleteness,
  V2ValidationError,
} from '@/modules/skills/rich-summary-v2-prompt';
import { bridgeV2ToOntology } from '@/modules/ontology/v2-bridge';
import { Prisma as PrismaCli } from '@prisma/client';
import { logger } from '@/utils/logger';
import { computeV2Quality } from '@/modules/metrics/v2-quality-metrics';
import { recordPipelineEvent } from '@/modules/metrics/pipeline-events';
import { config } from '@/config/index';

/**
 * Round id stamped onto every pipeline_events payload — sourced from the
 * zod-validated `PIPELINE_EVENTS_ROUND` env via `src/config/`. Increment
 * the env value when starting a new measurement batch.
 */
const PIPELINE_EVENTS_ROUND = config.pipelineEvents.round;

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

  /**
   * CC-direct upsert (CP437, 2026-04-29 user directive).
   *
   * Bypasses any LLM call — accepts a pre-built v2 layered JSON authored
   * by Claude Code (the conversation context) reading transcripts. This
   * is the only path that can populate `template_version='v2'` without
   * a service-API call (Hard Rule compliance — no OpenRouter, no
   * Anthropic API).
   *
   *   POST /api/v1/internal/v2-summary/upsert-direct
   *   Body: {
   *     videoId,
   *     core: {...},
   *     analysis: {...},
   *     lora: {...},
   *     segments?: {...},
   *     sourceLanguage?: 'ko' | 'en',
   *     stampTranscriptFetchedAt?: boolean
   *   }
   *
   * Validation: runs `validateV2Layered` + `scoreCompleteness` to refuse
   * malformed payloads (returns 422 on failure). Authoring side (CC)
   * therefore must produce valid JSON that meets the same schema.
   */
  fastify.post<{
    Body: {
      videoId?: string;
      core?: unknown;
      analysis?: unknown;
      lora?: unknown;
      segments?: unknown;
      sourceLanguage?: string;
      stampTranscriptFetchedAt?: boolean;
    };
  }>('/v2-summary/upsert-direct', async (request, reply) => {
    const expected = getInternalBatchToken();
    if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
    const got = request.headers['x-internal-token'];
    if (typeof got !== 'string' || got !== expected) {
      return reply.code(401).send({ error: 'invalid internal token' });
    }
    const body = request.body ?? {};
    const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
    if (!videoId) return reply.code(400).send({ error: 'videoId required' });

    let summary;
    try {
      summary = validateV2Layered({ core: body.core, analysis: body.analysis, lora: body.lora });
      // Strict key whitelist on segments — catches start_sec/end_sec/ts_sec
      // class typos at the API boundary so the bridge never silently stores
      // 0/null (CP437 incident).
      validateV2Segments(body.segments);
    } catch (err) {
      const path = err instanceof V2ValidationError ? err.path : '';
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(422).send({ error: 'validation_failed', path, message: msg });
    }
    const score = scoreCompleteness(summary);
    if (!score.passed) {
      return reply.code(422).send({
        error: 'completeness_below_threshold',
        score: score.score,
        reasons: score.reasons,
      });
    }

    const prisma = getPrismaClient();
    const now = new Date();
    try {
      await prisma.video_rich_summaries.update({
        where: { video_id: videoId },
        data: {
          template_version: 'v2',
          core: summary.core as unknown as PrismaCli.InputJsonValue,
          analysis: summary.analysis as unknown as PrismaCli.InputJsonValue,
          lora: summary.lora as unknown as PrismaCli.InputJsonValue,
          ...(body.segments ? { segments: body.segments as PrismaCli.InputJsonValue } : {}),
          completeness: score.score,
          quality_flag: 'pass',
          model: 'claude-code-direct',
          ...(body.sourceLanguage === 'ko' || body.sourceLanguage === 'en'
            ? { source_language: body.sourceLanguage }
            : {}),
          updated_at: now,
        },
      });
      if (body.stampTranscriptFetchedAt) {
        await prisma.youtube_videos
          .update({
            where: { youtube_video_id: videoId },
            data: { transcript_fetched_at: now },
          })
          .catch((err) =>
            log.warn('transcript_fetched_at stamp failed (non-fatal)', {
              videoId,
              error: err instanceof Error ? err.message : String(err),
            })
          );
      }
      log.info('v2-summary direct upsert', {
        videoId,
        completeness: score.score,
        domain: summary.core.domain,
      });

      // CP437 — auto-bridge to ontology (no LLM, no embedding).
      // Fire-and-forget; failure is non-fatal so the upsert response stays
      // fast and the bridge can be retried out-of-band if needed.
      let bridgeResult: Awaited<ReturnType<typeof bridgeV2ToOntology>> | null = null;
      try {
        bridgeResult = await bridgeV2ToOntology({
          videoId,
          layered: summary,
          segments: (body.segments as never) ?? null,
        });
      } catch (err) {
        log.warn('v2-bridge failed (non-fatal)', {
          videoId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // CP437 — paper §6.2 measurement: per-event quality metrics. Pulls
      // the title from youtube_videos so M1 (title-word recall in atoms)
      // can be computed; falls back to summary.core.one_liner when absent.
      try {
        const segments = body.segments as
          | { atoms?: Array<{ text?: string; timestamp_sec?: number | null }> }
          | undefined;
        const titleRow = await prisma.$queryRaw<{ title: string | null }[]>(Prisma.sql`
          SELECT title FROM youtube_videos WHERE youtube_video_id = ${videoId} LIMIT 1
        `);
        const title = titleRow[0]?.title ?? summary.core.one_liner ?? '';
        const quality = computeV2Quality({ title, atoms: segments?.atoms ?? [] });
        await recordPipelineEvent({
          stage: 'rich_summary_v2',
          videoId,
          payload: {
            M1: quality.M1,
            M3_class: quality.M3_class,
            M3_score: quality.M3_score,
            S: quality.S,
            null_ratio: quality.null_ratio,
            round: PIPELINE_EVENTS_ROUND,
            meta: quality.meta,
          },
        });
      } catch (err) {
        log.warn('pipeline_events emit failed (non-fatal)', {
          videoId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return reply.code(200).send({
        kind: 'pass',
        videoId,
        completeness: score.score,
        domain: summary.core.domain,
        ...(bridgeResult ? { ontology: bridgeResult } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('v2-summary direct upsert failed', { videoId, error: msg });
      if (msg.includes('Record to update not found')) {
        return reply.code(404).send({ error: 'video_rich_summaries row not found', videoId });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  /**
   * Reset specific videos back to template_version='v1' so they can be
   * re-authored with transcript context (CP437 user directive 2026-04-29).
   * Body: { videoIds: string[] }
   */
  fastify.post<{ Body: { videoIds?: string[] } }>(
    '/v2-summary/reset-to-v1',
    async (request, reply) => {
      const expected = getInternalBatchToken();
      if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
      const got = request.headers['x-internal-token'];
      if (typeof got !== 'string' || got !== expected) {
        return reply.code(401).send({ error: 'invalid internal token' });
      }
      const ids = Array.isArray(request.body?.videoIds) ? request.body.videoIds : [];
      if (ids.length === 0) return reply.code(400).send({ error: 'videoIds[] required' });
      const prisma = getPrismaClient();
      const result = await prisma.video_rich_summaries.updateMany({
        where: { video_id: { in: ids }, template_version: 'v2' },
        data: { template_version: 'v1', completeness: null },
      });
      log.info('v2-summary reset-to-v1', { count: result.count, requested: ids.length });
      return reply.code(200).send({ reset: result.count, requested: ids.length });
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
