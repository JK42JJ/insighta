/**
 * Card Pin / Bookmark + Interactions Routes
 *
 * REST API endpoints for the grid view cards. Two separate concerns share
 * this file because both ultimately write to the same source tables
 * (user_local_cards / user_video_states):
 *
 *   1. Pin / bookmark (CP457+) — PATCH /:id/pin
 *      Pin = UX bookmark (save for later) + behavioural signal for ranking.
 *      NULL = unpinned, TIMESTAMPTZ = pinned moment.
 *      See: prisma/migrations/pin/001_add_pinned_at.sql (DDL)
 *
 *   2. Preference interactions (CP462+, Issue #649) — POST /:videoId/{like,unlike,archive,unarchive}
 *      Records explicit user signals (like / archive) on a video.
 *      The "delete" signal is captured by hooking into the existing card
 *      delete handler (step 5, separate edit) and never has a public
 *      endpoint here.
 *
 *      like  → card_interactions UPSERT signal='like'
 *            + auto-eviction protection on the source rows (sets
 *              pinned_at=now() on both user_video_states and
 *              user_local_cards that match user_id+video_id)
 *            + enqueueEnrichRichSummary pg-boss job (Heart on-demand v2
 *              with mandala_relevance_pct).
 *      archive → card_interactions UPSERT signal='archive'+mandala_id.
 *              The DB UNIQUE constraint is mandala-agnostic
 *              (user_id+video_id+signal), so the row stores the most
 *              recent archive mandala. Multi-mandala archive scoping is
 *              deferred to a future schema iteration.
 *      unlike / unarchive → card_interactions DELETE the matching signal.
 *
 * Cards in Insighta come from three FE-visible sources:
 *   - `user_local_cards`  — user-added / scratchpad / promoted cards.
 *   - `user_video_states` — videos already in ideation / auto-added recs.
 *   - `recommendation_cache` — fresh recs not yet promoted to user_video_states.
 *
 * The FE InsightCard discriminator only knows two sources (the first two);
 * recommendation cards carry a `stream-<rec_cache_id>` id with sourceTable=
 * 'user_video_states' (per recommendationToInsightCard.ts:29-42). When the
 * pin button hits a `stream-` prefixed id we look up the rec_cache row, find
 * the underlying youtube_videos.id, and UPSERT a user_video_states row with
 * pinned_at — promoting the recommendation to a persistent saved video so
 * the pin outlives the rec_cache's 7-day TTL.
 *
 * See:
 *   prisma/schema.prisma (model fields + partial indexes)
 *   prisma/migrations/card-interactions/001_create_table.sql
 *   docs/runbook/cp462-card-interactions-phase2-handoff.md
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { enqueueEnrichRichSummary } from '@/modules/queue';

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_ID_LOG_TRIM = 60;

const log = logger.child({ module: 'cards-routes' });

type CardSource = 'user_local_cards' | 'user_video_states';

const ALLOWED_SOURCES: ReadonlySet<CardSource> = new Set(['user_local_cards', 'user_video_states']);

const STREAM_ID_PREFIX = 'stream-';

export const cardsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * PATCH /api/v1/cards/:id/pin — toggle pin state.
   *
   * Body:
   *   { pinned: boolean, source: 'user_local_cards' | 'user_video_states' }
   *
   * Auth: required. All writes scoped by user_id so a user cannot pin
   *       someone else's card even with a valid id.
   *
   * Behaviour:
   *   - id starts with `stream-` → recommendation card. Resolve rec_cache →
   *     youtube_videos → UPSERT user_video_states(user_id, video_id) with
   *     pinned_at. Side-effect: creates a user_video_states row if missing
   *     with is_in_ideation=false + auto_added=false (pin-only intent;
   *     auto-add pipeline owns the ideation promotion).
   *   - else → direct UPDATE on the named source table. Raw SQL so the
   *     Prisma @updatedAt auto-touch on user_video_states does NOT fire
   *     (would re-shuffle the grid by updated_at desc consumers).
   *
   * Returns:
   *   200 { status: 'ok', data: { id, pinned, pinnedAt, source } }
   *   400 INVALID_SOURCE / MISSING_PINNED — body shape
   *   404 NOT_FOUND — id+user_id rows absent (or rec_cache not owned)
   *   500 PIN_UPDATE_FAILED — DB error
   */
  fastify.patch<{
    Params: { id: string };
    Body: { pinned: boolean; source: CardSource };
  }>('/:id/pin', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { id } = request.params;
    const { pinned, source } =
      request.body ?? ({} as Partial<{ pinned: boolean; source: CardSource }>);

    if (typeof pinned !== 'boolean') {
      return reply.code(400).send({
        status: 'error',
        code: 'MISSING_PINNED',
        message: 'body.pinned must be boolean',
      });
    }
    if (!source || !ALLOWED_SOURCES.has(source)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_SOURCE',
        message: `body.source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
      });
    }

    const pinnedAt = pinned ? new Date() : null;
    const prisma = getPrismaClient();

    try {
      // ── Branch 1: stream- prefixed → recommendation card ───────────
      if (id.startsWith(STREAM_ID_PREFIX)) {
        const recId = id.slice(STREAM_ID_PREFIX.length);
        if (!isUuid(recId)) {
          return reply.code(400).send({
            status: 'error',
            code: 'INVALID_REC_ID',
            message: `stream- id must be followed by a uuid; got ${recId.slice(0, 40)}`,
          });
        }

        // Look up the rec_cache row (user_id ownership check) to grab the
        // youtube video id string + mandala_id + cell_index, which we'll
        // copy into the user_video_states upsert.
        const rec = await prisma.recommendation_cache.findFirst({
          where: { id: recId, user_id: userId },
          select: {
            id: true,
            video_id: true,
            mandala_id: true,
            cell_index: true,
          },
        });
        if (!rec) {
          return reply.code(404).send({
            status: 'error',
            code: 'REC_NOT_FOUND',
            message: `Recommendation ${recId} not found for this user`,
          });
        }

        // rec.video_id is the YouTube string id; user_video_states.video_id
        // is a uuid foreign key into youtube_videos.id. Resolve.
        const yt = await prisma.youtube_videos.findFirst({
          where: { youtube_video_id: rec.video_id },
          select: { id: true },
        });
        if (!yt) {
          return reply.code(404).send({
            status: 'error',
            code: 'YT_VIDEO_NOT_FOUND',
            message: `Underlying youtube_videos row missing for ${rec.video_id}`,
          });
        }

        // Raw UPSERT to set pinned_at without touching Prisma's @updatedAt.
        // ON CONFLICT (user_id, video_id) — the table's unique constraint.
        // INSERT path: minimal-impact defaults (is_in_ideation=false so the
        // card is NOT promoted to the ideation palette; auto_added=false so
        // the auto-add eviction sweep treats it as user-owned).
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.user_video_states (
            user_id, video_id, is_in_ideation, watch_position_seconds,
            is_watched, cell_index, level_id, mandala_id, sort_order,
            auto_added, added_to_ideation_at, created_at, updated_at,
            pinned_at
          )
          VALUES (
            ${userId}::uuid,
            ${yt.id}::uuid,
            false,
            0,
            false,
            ${rec.cell_index ?? -1},
            'scratchpad',
            ${rec.mandala_id}::uuid,
            NULL,
            false,
            now(),
            now(),
            now(),
            ${pinnedAt}
          )
          ON CONFLICT (user_id, video_id) DO UPDATE
            SET pinned_at = EXCLUDED.pinned_at
        `);

        return reply.code(200).send({
          status: 'ok',
          data: {
            id,
            pinned,
            pinnedAt: pinnedAt?.toISOString() ?? null,
            source: 'user_video_states',
            promotedFromRecommendation: true,
          },
        });
      }

      // ── Branch 2: direct id → UPDATE named source ─────────────────
      let updatedCount = 0;
      if (source === 'user_local_cards') {
        updatedCount = await prisma.$executeRaw`
          UPDATE public.user_local_cards
             SET pinned_at = ${pinnedAt}
           WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        `;
      } else {
        updatedCount = await prisma.$executeRaw`
          UPDATE public.user_video_states
             SET pinned_at = ${pinnedAt}
           WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        `;
      }

      if (updatedCount === 0) {
        return reply.code(404).send({
          status: 'error',
          code: 'NOT_FOUND',
          message: `Card ${id} not found in ${source} for this user`,
        });
      }

      return reply.code(200).send({
        status: 'ok',
        data: { id, pinned, pinnedAt: pinnedAt?.toISOString() ?? null, source },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`pin update failed: id=${id} source=${source} pinned=${pinned} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'PIN_UPDATE_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // CP462+ Issue #649 — Card preference signal endpoints
  // ─────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/cards/:videoId/like — record a heart click.
   *
   * Body: { mandalaId?: string }  (mandala context for the signal row)
   *
   * Side effects:
   *   - card_interactions UPSERT signal='like' (UNIQUE on user+video+signal
   *     → repeated clicks bump created_at but do not duplicate rows)
   *   - pinned_at=now() on every matching user_video_states /
   *     user_local_cards row (user_id+video_id) — auto-eviction guard
   *     so the recommendation refresh does not evict a liked card
   *   - enqueueEnrichRichSummary pg-boss job (v1 bootstrap → v2 upgrade
   *     with mandala_relevance_pct). Skipped when mandalaId is missing
   *     because the v2 generator needs a mandala center goal to score.
   *
   * Returns 202 { signalRecorded, jobId, pinnedRows }
   */
  fastify.post<{
    Params: { videoId: string };
    Body: { mandalaId?: string; title?: string; description?: string };
  }>('/:videoId/like', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { videoId } = request.params;
    const body = request.body ?? {};

    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_VIDEO_ID',
        message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
      });
    }

    const prisma = getPrismaClient();
    try {
      // 1. Signal UPSERT
      await prisma.card_interactions.upsert({
        where: {
          user_id_video_id_signal: { user_id: userId, video_id: videoId, signal: 'like' },
        },
        update: { created_at: new Date(), mandala_id: body.mandalaId ?? null },
        create: {
          user_id: userId,
          video_id: videoId,
          signal: 'like',
          mandala_id: body.mandalaId ?? null,
        },
      });

      // 2. Auto-eviction guard: set pinned_at=now() on every matching
      //    source row. Both tables hold pinned_at; user_video_states is
      //    keyed by uuid video_id (FK to youtube_videos.id); user_local_cards
      //    stores the youtube string id directly in `video_id VARCHAR(11)`.
      const pinnedAt = new Date();
      const localCardsUpdated = await prisma.$executeRaw`
        UPDATE public.user_local_cards
           SET pinned_at = ${pinnedAt}
         WHERE user_id = ${userId}::uuid AND video_id = ${videoId}
      `;
      const videoStatesUpdated = await prisma.$executeRaw`
        UPDATE public.user_video_states uvs
           SET pinned_at = ${pinnedAt}
          FROM public.youtube_videos yv
         WHERE uvs.user_id = ${userId}::uuid
           AND uvs.video_id = yv.id
           AND yv.youtube_video_id = ${videoId}
      `;

      // 3. Enrichment job — only when the caller supplied a mandalaId so
      //    the v2 generator can resolve a center_goal. Title/description
      //    are best-effort hints; rich-summary falls back to youtube_videos
      //    metadata when omitted (downstream lookup in enrichRichSummary).
      let jobId: string | null = null;
      if (body.mandalaId) {
        jobId = await enqueueEnrichRichSummary({
          videoId,
          userId,
          mandalaId: body.mandalaId,
          title: body.title ?? '',
          description: body.description ?? undefined,
        });
      }

      return reply.code(202).send({
        status: 'ok',
        data: {
          signalRecorded: true,
          jobId,
          pinnedRows: {
            user_local_cards: localCardsUpdated,
            user_video_states: videoStatesUpdated,
          },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`like failed: videoId=${videoId} userId=${userId} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'LIKE_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  /**
   * POST /api/v1/cards/:videoId/unlike — remove the like signal.
   *
   * Side effects:
   *   - card_interactions DELETE signal='like'
   *   - pinned_at=null on every matching source row (revert auto-eviction
   *     guard so the recommendation refresh may evict the card again)
   *
   * Returns 204.
   */
  fastify.post<{ Params: { videoId: string } }>(
    '/:videoId/unlike',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      const userId = request.user.userId;
      const { videoId } = request.params;

      if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
        return reply.code(400).send({
          status: 'error',
          code: 'INVALID_VIDEO_ID',
          message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
        });
      }

      const prisma = getPrismaClient();
      try {
        await prisma.card_interactions.deleteMany({
          where: { user_id: userId, video_id: videoId, signal: 'like' },
        });
        await prisma.$executeRaw`
          UPDATE public.user_local_cards
             SET pinned_at = NULL
           WHERE user_id = ${userId}::uuid AND video_id = ${videoId}
        `;
        await prisma.$executeRaw`
          UPDATE public.user_video_states uvs
             SET pinned_at = NULL
            FROM public.youtube_videos yv
           WHERE uvs.user_id = ${userId}::uuid
             AND uvs.video_id = yv.id
             AND yv.youtube_video_id = ${videoId}
        `;
        return reply.code(204).send();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`unlike failed: videoId=${videoId} userId=${userId} err=${msg}`);
        return reply.code(500).send({
          status: 'error',
          code: 'UNLIKE_FAILED',
          message: msg.slice(0, 200),
        });
      }
    }
  );

  /**
   * POST /api/v1/cards/:videoId/archive — soft-hide the video within a
   * mandala (Phase 3 FE provides the visible undo affordance).
   *
   * Body: { mandalaId: string }  (required — archive is mandala-scoped)
   *
   * Side effects:
   *   - card_interactions UPSERT signal='archive', mandala_id stored
   *
   * Schema note: UNIQUE is (user_id, video_id, signal) — mandala-agnostic,
   * so re-archiving the same video in a different mandala overwrites the
   * mandala_id rather than producing a per-mandala row. Multi-mandala
   * archive scoping is deferred to a future schema iteration (would
   * require a partial unique index restricted to signal IN ('like',
   * 'delete')).
   *
   * Returns 204.
   */
  fastify.post<{
    Params: { videoId: string };
    Body: { mandalaId: string };
  }>('/:videoId/archive', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { videoId } = request.params;
    const body = request.body ?? ({} as { mandalaId?: string });

    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_VIDEO_ID',
        message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
      });
    }
    if (!body.mandalaId || !isUuid(body.mandalaId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_MANDALA_ID',
        message: 'body.mandalaId must be a uuid',
      });
    }

    const prisma = getPrismaClient();
    try {
      await prisma.card_interactions.upsert({
        where: {
          user_id_video_id_signal: { user_id: userId, video_id: videoId, signal: 'archive' },
        },
        update: { created_at: new Date(), mandala_id: body.mandalaId },
        create: {
          user_id: userId,
          video_id: videoId,
          signal: 'archive',
          mandala_id: body.mandalaId,
        },
      });
      return reply.code(204).send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `archive failed: videoId=${videoId} userId=${userId} mandalaId=${body.mandalaId} err=${msg}`
      );
      return reply.code(500).send({
        status: 'error',
        code: 'ARCHIVE_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

  /**
   * POST /api/v1/cards/:videoId/unarchive — remove the archive signal.
   *
   * Per the mandala-agnostic UNIQUE constraint there is at most one
   * archive row per (user, video); this endpoint deletes it regardless of
   * which mandala originally archived.
   *
   * Returns 204.
   */
  fastify.post<{ Params: { videoId: string } }>(
    '/:videoId/unarchive',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      const userId = request.user.userId;
      const { videoId } = request.params;

      if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
        return reply.code(400).send({
          status: 'error',
          code: 'INVALID_VIDEO_ID',
          message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
        });
      }

      const prisma = getPrismaClient();
      try {
        await prisma.card_interactions.deleteMany({
          where: { user_id: userId, video_id: videoId, signal: 'archive' },
        });
        return reply.code(204).send();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`unarchive failed: videoId=${videoId} userId=${userId} err=${msg}`);
        return reply.code(500).send({
          status: 'error',
          code: 'UNARCHIVE_FAILED',
          message: msg.slice(0, 200),
        });
      }
    }
  );

  /**
   * GET /api/v1/cards/:videoId/enrich-stream — Server-Sent Events stream
   * of the Heart-click v2 enrichment progress for the calling user.
   *
   * The FE Heart UI subscribes after firing POST /:videoId/like and shows
   * the 3-phase animation (수집 중 → 분석 중 → 평가 완료) per CP462
   * Phase 2 step 3 spec. The stream polls `pgboss.job` for the most
   * recent enrich-rich-summary job matching (user, video) and emits a
   * phase event when the pg-boss state transitions.
   *
   * Phase mapping:
   *   created / retry    → 'fetching'   (수집 중)
   *   active             → 'analyzing'  (분석 중)
   *   completed          → 'scored'     (평가 완료, stream closes)
   *   failed / cancelled / expired → 'failed' (stream closes)
   *
   * Hard caps so the stream cannot leak server resources:
   *   - 5-minute max duration (matches RICH_SUMMARY_RETRY_OPTIONS expireInMinutes)
   *   - polling interval 1 second
   *   - close on client disconnect
   */
  fastify.get<{ Params: { videoId: string } }>(
    '/:videoId/enrich-stream',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      const userId = request.user.userId;
      const { videoId } = request.params;

      if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
        return reply.code(400).send({
          status: 'error',
          code: 'INVALID_VIDEO_ID',
          message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
        });
      }

      // SSE handshake — disable any intermediate buffering (Nginx adds
      // `X-Accel-Buffering: no` to ensure each write reaches the browser
      // immediately).
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const prisma = getPrismaClient();
      let lastPhase: string | null = null;
      const startedAt = Date.now();
      let closed = false;

      const sendPhase = (phase: string, extra?: Record<string, unknown>): void => {
        if (closed) return;
        const payload = JSON.stringify({ phase, videoId, ...extra });
        reply.raw.write(`event: phase\ndata: ${payload}\n\n`);
      };

      const closeStream = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          reply.raw.end();
        } catch {
          /* swallow — connection may already be closed */
        }
      };

      const pollOnce = async (): Promise<void> => {
        if (Date.now() - startedAt > ENRICH_STREAM_MAX_MS) {
          sendPhase('timeout');
          closeStream();
          return;
        }
        const rows = await prisma.$queryRaw<Array<{ state: string }>>`
          SELECT state
            FROM pgboss.job
           WHERE name = 'enrich-rich-summary'
             AND data->>'videoId' = ${videoId}
             AND data->>'userId' = ${userId}
           ORDER BY createdon DESC
           LIMIT 1
        `;
        const job = rows[0];
        if (!job) {
          // No job row yet — SSE auto-reconnect handles transient
          // network loss, so heartbeats are unnecessary; just wait for
          // the next poll cycle.
          return;
        }
        const phase = mapJobStateToPhase(job.state);
        if (phase !== lastPhase) {
          sendPhase(phase, { jobState: job.state });
          lastPhase = phase;
          if (phase === 'scored' || phase === 'failed') {
            closeStream();
          }
        }
      };

      // Emit `fetching` immediately so the FE has something to render
      // before the first poll cycle resolves.
      sendPhase('fetching');
      lastPhase = 'fetching';

      const interval = setInterval(() => {
        // setInterval expects a void-returning callback; wrap the async
        // pollOnce so the floating promise is caught here.
        pollOnce().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`enrich-stream poll failed: videoId=${videoId} err=${msg}`);
          // Single poll failure is not fatal — keep trying until the cap.
        });
      }, ENRICH_STREAM_POLL_MS);

      // Cleanup if the client navigates away or aborts the request.
      request.raw.on('close', closeStream);
    }
  );

  done();
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

const ENRICH_STREAM_POLL_MS = 1000;
const ENRICH_STREAM_MAX_MS = 5 * 60 * 1000;

/**
 * Translate pg-boss job state into the 3-phase FE vocabulary
 * (수집 중 / 분석 중 / 평가 완료 + failed). Unknown states fall back
 * to 'fetching' so the FE never sees an empty event.
 */
function mapJobStateToPhase(state: string): 'fetching' | 'analyzing' | 'scored' | 'failed' {
  switch (state) {
    case 'created':
    case 'retry':
      return 'fetching';
    case 'active':
      return 'analyzing';
    case 'completed':
      return 'scored';
    case 'failed':
    case 'cancelled':
    case 'expired':
      return 'failed';
    default:
      return 'fetching';
  }
}
