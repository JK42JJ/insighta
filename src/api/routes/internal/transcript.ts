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
  duration_sec: number | null;
}

/**
 * CP438+1 Q6 (2026-05-03): domain-targeted title-keyword pre-filter.
 * Used by `?domains=social,creative` to bias candidates toward
 * under-represented core.domain buckets. The actual core.domain is
 * decided by the v2 author (Claude) AFTER transcript fetch — this
 * pre-filter only raises the prior of getting a row with the desired
 * domain by matching common Korean keywords in the title. Heuristic.
 */
const DOMAIN_TITLE_KEYWORDS: Record<string, string[]> = {
  // CP438+2 (PR #605, 2026-05-07): expanded for LoRA training-data balance.
  // Original v1 narrow lists were correct heuristics for "stay-on-topic" but
  // exhausted the social/creative pool within the 7-day cooldown window
  // (every matching video became `transcript_attempted_at`-stamped). Added
  // lifestyle/mind/business/health buckets that previously fell back to []
  // (silent miss → 0 candidates returned for those biases). Bucket
  // assignment is heuristic — final core.domain is decided by the v2
  // author. Some keywords (e.g. '인테리어') reasonably belong to multiple
  // buckets; placement is whichever bucket needed the volume more.
  social: [
    '사회',
    '정치',
    '커뮤니티',
    '소통',
    '인간관계',
    '갈등',
    '토론',
    '관계',
    '젠더',
    '세대',
    '시민',
    '연대',
    '친구',
    '연애',
    '결혼',
    '가족',
    '모임',
    '공감',
    '사회생활',
    '대화법',
    '화법',
    '설득',
    '심리학',
    'MBTI',
  ],
  creative: [
    '디자인',
    '작곡',
    '글쓰기',
    '영화',
    '예술',
    '공예',
    '사진',
    '작가',
    '그림',
    '일러스트',
    '색채',
    '음악',
    '편집',
    '영상편집',
    '연출',
    '시나리오',
    '크리에이터',
  ],
  lifestyle: [
    '여행',
    '요리',
    '레시피',
    '취미',
    '패션',
    '뷰티',
    '인테리어',
    '반려',
    '캠핑',
    '홈트',
    '미니멀',
    '루틴',
    '일상',
    '살림',
  ],
  mind: [
    '명상',
    '마음',
    '스트레스',
    '심리',
    '불안',
    '우울',
    '치유',
    '챌린지',
    '동기부여',
    '자존감',
    '마인드',
  ],
  business: [
    '창업',
    '스타트업',
    '경영',
    '마케팅',
    '협상',
    '리더십',
    '조직',
    '매출',
    '퍼널',
    '퍼스널 브랜딩',
  ],
  health: [
    '건강',
    '다이어트',
    '영양',
    '운동',
    '수면',
    '면역',
    '체력',
    '스트레칭',
    '요가',
    '홈트레이닝',
  ],
};

export const internalTranscriptRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { limit?: string; domains?: string } }>(
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

      // Domain-targeted title pre-filter (CP438+1 Q6). When `domains` query
      // param is set (e.g. ?domains=social,creative), only return candidates
      // whose title matches at least one keyword for the requested domains.
      const domainsParam =
        typeof request.query.domains === 'string' ? request.query.domains.trim() : '';
      const domainKeywords = domainsParam
        ? domainsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .flatMap((d) => DOMAIN_TITLE_KEYWORDS[d] ?? [])
        : [];
      const domainTitleFilter =
        domainKeywords.length > 0
          ? Prisma.sql`AND yv.title ILIKE ANY(ARRAY[${Prisma.join(
              domainKeywords.map((k) => `%${k}%`)
            )}]::text[])`
          : Prisma.empty;

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
        yv.has_caption,
        yv.duration_seconds AS duration_sec
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
        ${domainTitleFilter}
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
      /**
       * CP488+ (2026-05-28) — when true, run validation + scoreCompleteness
       * and return the result WITHOUT touching the DB. Used by Mac Mini
       * verify-one.sh as a pre-bulk gate (proxy/fetch/chunker/claude/route
       * all green before kicking off batch-backfill.sh). Side-effect-free:
       * no pipeline_events, no video_pool promote, no transcript_fetched_at.
       */
      dryRun?: boolean;
      /**
       * CP446+ — atom validation telemetry from process-one.sh's
       * validate-atoms.py. Optional; when present the route stamps a
       * `pipeline_events.stage='atom_validation'` row for downstream
       * monitoring. Schema: { atom_dropped_count, drop_reasons: { ... },
       * atoms_in, atoms_out, snapped_count, marker_count }.
       */
      validationMeta?: Record<string, unknown>;
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

    // CP488+ (2026-05-28) — defensive default for cron-driven backfill
    // clients (Mac Mini process-one.sh) whose embedded prompt predates
    // CP462+ (Issue #649) and does not emit `mandala_relevance_pct`.
    // The validator requires it (integer 0-100); inject 0 when missing
    // so the bulk Mac Mini path doesn't bottleneck on a single field
    // the cron context legitimately doesn't know.
    let analysisForValidation: unknown = body.analysis;
    if (
      analysisForValidation &&
      typeof analysisForValidation === 'object' &&
      'mandala_fit' in analysisForValidation
    ) {
      const a = analysisForValidation as Record<string, unknown>;
      const mf = a['mandala_fit'];
      if (mf && typeof mf === 'object' && !('mandala_relevance_pct' in mf)) {
        analysisForValidation = {
          ...a,
          mandala_fit: { ...(mf as Record<string, unknown>), mandala_relevance_pct: 0 },
        };
      }
    }

    let summary;
    try {
      // CP488+ root fix — forward `segments` so summary.segments populates
      // and scoreCompleteness can see sections/atoms. Before this fix the
      // route omitted segments from the validateV2Layered input, so every
      // Mac Mini payload 422'd with `segments.sections empty: 0` even when
      // 2+ sections were present in body. Strict key whitelist (start_sec/
      // end_sec/ts_sec typos) runs inside validateV2Layered → no separate
      // validateV2Segments call needed here.
      summary = validateV2Layered({
        core: body.core,
        analysis: analysisForValidation,
        lora: body.lora,
        segments: body.segments,
      });
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

    // CP488+ — dryRun pre-bulk gate. After validation + scoreCompleteness pass,
    // short-circuit before any DB write so verify-one.sh can confirm the full
    // route contract works without altering production state.
    if (body.dryRun === true) {
      return reply.code(200).send({
        kind: 'dry-run-pass',
        videoId,
        completeness: score.score,
        domain: summary.core.domain,
        sectionsCount: summary.segments?.sections?.length ?? 0,
        atomsCount: summary.segments?.atoms?.length ?? 0,
        enrichmentRich: score.enrichmentRich,
        enrichmentReasons: score.enrichmentReasons,
      });
    }

    const prisma = getPrismaClient();
    const now = new Date();

    // CP438+1: clamp atom timestamp_sec / section from_sec/to_sec to video
    // duration. Even with the new prompt rule + transcript [mm:ss] markers,
    // the LLM occasionally still emits values past the duration. Silent
    // clamp + log keeps the row useful (text + type stay) instead of 422
    // rejecting the whole row.
    let clampedAtomCount = 0;
    let clampedSectionCount = 0;
    let durationSec: number | null = null;
    let mutatedSegments: unknown = body.segments;
    try {
      const yvRow = await prisma.$queryRawUnsafe<{ duration_seconds: number | null }[]>(
        'SELECT duration_seconds FROM youtube_videos WHERE youtube_video_id = $1 LIMIT 1',
        videoId
      );
      durationSec = yvRow[0]?.duration_seconds ?? null;
    } catch {
      // duration unknown — skip clamp; fall back to legacy behavior
      durationSec = null;
    }
    if (
      typeof durationSec === 'number' &&
      durationSec > 0 &&
      body.segments &&
      typeof body.segments === 'object'
    ) {
      const cap = Math.max(0, durationSec - 1);
      const segCopy = JSON.parse(JSON.stringify(body.segments)) as {
        atoms?: Array<{ timestamp_sec?: number | null }>;
        sections?: Array<{ from_sec?: number | null; to_sec?: number | null }>;
      };
      if (Array.isArray(segCopy.atoms)) {
        for (const a of segCopy.atoms) {
          if (typeof a.timestamp_sec === 'number' && a.timestamp_sec > cap) {
            a.timestamp_sec = cap;
            clampedAtomCount++;
          }
        }
      }
      if (Array.isArray(segCopy.sections)) {
        for (const s of segCopy.sections) {
          if (typeof s.from_sec === 'number' && s.from_sec > cap) {
            s.from_sec = cap;
            clampedSectionCount++;
          }
          if (typeof s.to_sec === 'number' && s.to_sec > cap) {
            s.to_sec = cap;
            clampedSectionCount++;
          }
        }
      }
      mutatedSegments = segCopy;
      if (clampedAtomCount > 0 || clampedSectionCount > 0) {
        log.warn('v2 timestamp clamp', {
          videoId,
          duration_seconds: durationSec,
          clamped_atoms: clampedAtomCount,
          clamped_sections: clampedSectionCount,
        });
      }
    }
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
          ...(mutatedSegments ? { segments: mutatedSegments as PrismaCli.InputJsonValue } : {}),
          completeness: score.score,
          quality_flag: score.enrichmentRich ? 'pass' : 'enrichment_low',
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
          ...(mutatedSegments ? { segments: mutatedSegments as PrismaCli.InputJsonValue } : {}),
          completeness: score.score,
          quality_flag: score.enrichmentRich ? 'pass' : 'enrichment_low',
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

      // CP446+ — atom validation telemetry. process-one.sh's validate-atoms.py
      // ships drop counts + reasons in body.validationMeta; persist them in
      // pipeline_events for monitoring (drop-rate trend, marker-drift drift).
      // Non-fatal; recordPipelineEvent already swallows errors.
      if (body.validationMeta && typeof body.validationMeta === 'object') {
        await recordPipelineEvent({
          stage: 'atom_validation',
          videoId,
          payload: body.validationMeta,
        });
      }

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
