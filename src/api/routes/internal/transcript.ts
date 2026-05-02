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
import { promoteV2ToVideoPool } from '@/modules/video-pool/promote-from-v2';

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

      // Candidate selector (CP438+1 Q5 — v2-author batch driver):
      //   LEFT JOIN video_rich_summaries — include yv rows w/ no summary at
      //     all (newly collected by Mac Mini collect-trending.ts since
      //     CP438; in prod 5,462 / 7,009 rows on 2026-04-30). INNER JOIN
      //     was the original CP437 bug — only 1,503 v1 rows surfaced as
      //     candidates while 5,462 fresh videos were silently invisible.
      //   vrs.video_id IS NULL    — fresh yv with no summary → author v2 fresh
      //   vrs.template_version='v1' — existing v1 row → upgrade to v2
      //   duration_seconds NOT NULL AND > 180 — CP438+1 Q5: NULL duration
      //     is the LIVE-stream signal (한국경제TV LIVE / 매일경제TV LIVE
      //     surfaced as top candidates with NULL duration + extreme view
      //     count). Drop NULL to block LIVE. The > 180 cutoff drops
      //     shorts / music clips. Trade-off: a few collector batches that
      //     didn't capture duration drop too — acceptable as LIVE
      //     poisoning was 100% of NULL-duration top-pool.
      //   transcript_attempted_at IS NULL OR < NOW()-7days — CP438+1:
      //     skip videos already attempted in past 7 days. Eliminates the
      //     stale no_caption resurfacing loop (runbook §4).
      //   transcript_fetched_at: NOT a filter (CP437/CP438 both dropped it).
      //   has_caption: NOT a filter (column always NULL — YT-API backfill OFF).
      //   ORDER BY view_count ASC — CP438+1 Q5: ASC (low view first)
      //     inverts the music/MV skew. Top of the pool with view_count
      //     DESC was 90% Korean music videos / LIVE streams (KATSEYE /
      //     BOL4 / Tayna / 가호 OST) which all lacked transcribable auto-
      //     captions. After 4 consecutive 0-pass batches under DESC,
      //     switching to ASC surfaces lecture / tutorial / interview
      //     content (historic 30-40% pass rate). Bookmark presence still
      //     wins (user signal > view sort).
      const prisma = getPrismaClient();
      const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT
        yv.youtube_video_id,
        yv.default_language,
        yv.has_caption
      FROM youtube_videos yv
      LEFT JOIN video_rich_summaries vrs ON vrs.video_id = yv.youtube_video_id
      LEFT JOIN (
        SELECT yv2.youtube_video_id, COUNT(*) AS bookmark_count
        FROM user_video_states uvs
        JOIN youtube_videos yv2 ON yv2.id = uvs.video_id
        GROUP BY yv2.youtube_video_id
      ) book ON book.youtube_video_id = yv.youtube_video_id
      WHERE (vrs.video_id IS NULL OR vrs.template_version = 'v1')
        AND yv.duration_seconds IS NOT NULL
        AND yv.duration_seconds > 180
        AND (yv.transcript_attempted_at IS NULL
             OR yv.transcript_attempted_at < NOW() - INTERVAL '7 days')
      ORDER BY
        (COALESCE(book.bookmark_count, 0) > 0) DESC,
        yv.view_count ASC NULLS LAST
      LIMIT ${Prisma.raw(String(limit))}
    `);
      return reply.code(200).send({ videos: rows });
    }
  );

  /**
   * CP438+1 (2026-05-03): mark a video as transcript-attempted so the
   * candidates selector excludes it for the 7-day cooldown window. Called
   * by mac-mini/v2-author/process-one.sh on every no_caption /
   * claude_invalid_json exit path. Fire-and-forget from the worker side.
   */
  fastify.post<{ Body: { videoId?: string } }>(
    '/transcript/mark-attempted',
    async (request, reply) => {
      const expected = getInternalBatchToken();
      if (!expected) return reply.code(503).send({ error: 'internal trigger not configured' });
      const got = request.headers['x-internal-token'];
      if (typeof got !== 'string' || got !== expected) {
        return reply.code(401).send({ error: 'invalid internal token' });
      }
      const videoId = typeof request.body?.videoId === 'string' ? request.body.videoId.trim() : '';
      if (!videoId) return reply.code(400).send({ error: 'videoId required' });
      const prisma = getPrismaClient();
      try {
        const result = await prisma.youtube_videos.updateMany({
          where: { youtube_video_id: videoId },
          data: { transcript_attempted_at: new Date() },
        });
        return reply.code(200).send({ ok: true, updated: result.count });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('mark-attempted failed', { videoId, error: msg });
        return reply.code(500).send({ error: msg });
      }
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
      // upsert (not update) — selector (LEFT JOIN, vrs.video_id IS NULL)
      // surfaces newly-collected yv rows that have no summary yet, so this
      // path must INSERT as well as UPDATE.
      await prisma.video_rich_summaries.upsert({
        where: { video_id: videoId },
        update: {
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
        create: {
          video_id: videoId,
          tier_required: 'free',
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
          created_at: now,
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

      // CP438 — auto-promote this v2 row into video_pool so the recommender
      // can surface it. Non-blocking: any error here is logged + recorded
      // to pipeline_events (`stage='promote_from_v2'`) but never breaks
      // the upsert response. Limit=1 so a single upsert triggers a single
      // promotion (subsequent v2 backlog is drained by the cron path).
      setImmediate(() => {
        promoteV2ToVideoPool({ limit: 1, dryRun: false })
          .then((result) => {
            log.info('post-upsert promote done', {
              videoId,
              ...result,
              errors: result.errors.length,
            });
          })
          .catch(async (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn('post-upsert promote failed (non-fatal)', { videoId, error: msg });
            await recordPipelineEvent({
              stage: 'promote_from_v2',
              videoId,
              payload: { error: msg.slice(0, 500), round: PIPELINE_EVENTS_ROUND },
            }).catch(() => {});
          });
      });

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
