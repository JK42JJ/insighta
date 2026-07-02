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
import { config } from '../../config';
import { shortGateFields } from '@/modules/video-pool/is-short';

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
    Body: {
      mandalaId?: string;
      title?: string;
      description?: string;
      cellIndex?: number;
      // CP467 — Add Cards panel sends Tier 2 fresh-from-YouTube
      // candidate metadata here. youtube_videos has no row for these
      // yet, so without a hint the like path would skip user_video_states
      // INSERT and the picked card would never reach the mandala grid.
      videoCacheHint?: {
        title?: string | null;
        description?: string | null;
        channelTitle?: string | null;
        thumbnailUrl?: string | null;
        durationSec?: number | null;
        viewCount?: number | null;
        publishedAt?: string | null;
      };
    };
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

    // CP504 — archive re-add guard. If the user archived this video in THIS
    // mandala, do NOT silently re-add it: the display gate would then hide the
    // freshly-added card ("added but invisible" stuck state). Hold the add and
    // tell the FE to show a "이미 보관함에 있는 영상입니다" toast + [복구] action.
    // The user — not the system — restores (archive was their explicit intent).
    if (body.mandalaId) {
      const archived = await prisma.card_interactions.findFirst({
        where: {
          user_id: userId,
          video_id: videoId,
          signal: 'archive',
          mandala_id: body.mandalaId,
        },
        select: { id: true },
      });
      if (archived) {
        return reply.code(409).send({
          status: 'error',
          code: 'ALREADY_ARCHIVED',
          message: 'video is archived in this mandala',
          videoId,
          mandalaId: body.mandalaId,
        });
      }
    }

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

      // 2. Auto-eviction guard + Add Cards surfacing mark + INSERT
      //    path for fresh picks (CP466 amendment 10).
      //
      //    A) UPDATE user_local_cards.pinned_at (where exists).
      //    B) UPSERT user_video_states — INSERT when the row is new
      //       (panel pick of a candidate that wasn't in the mandala
      //       yet) so the card auto-appears in the mandala grid +
      //       its assigned cell. UPDATE pinned_at + surfaced_at when
      //       the row exists. yt lookup mirrors the Pin stream-
      //       branch pattern (cards.ts:161-171).
      const pinnedAt = new Date();
      const localCardsUpdated = await prisma.$executeRaw`
        UPDATE public.user_local_cards
           SET pinned_at = ${pinnedAt}
         WHERE user_id = ${userId}::uuid AND video_id = ${videoId}
      `;
      let videoStatesUpdated = 0;
      let yt = await prisma.youtube_videos.findFirst({
        where: { youtube_video_id: videoId },
        select: { id: true },
      });
      // CP467 — yt row missing + caller supplied a cache hint (Add Cards
      // Pick of a Tier 2 fresh-from-YouTube candidate). Best-effort
      // INSERT so the downstream user_video_states INSERT path can run.
      // skipDuplicates handles the race when two parallel picks arrive
      // for the same video.
      if (!yt && body.mandalaId && body.videoCacheHint) {
        const hint = body.videoCacheHint;
        try {
          await prisma.youtube_videos.create({
            data: {
              youtube_video_id: videoId,
              title: hint.title ?? body.title ?? 'Untitled',
              description: hint.description ?? body.description ?? null,
              channel_title: hint.channelTitle ?? '',
              thumbnail_url: hint.thumbnailUrl ?? null,
              duration_seconds: hint.durationSec ?? null,
              view_count:
                typeof hint.viewCount === 'number' && Number.isFinite(hint.viewCount)
                  ? BigInt(Math.max(0, Math.trunc(hint.viewCount)))
                  : null,
              published_at: hint.publishedAt ? new Date(hint.publishedAt) : null,
            },
          });
        } catch (err) {
          // Concurrent insert race or other constraint — re-read.
          log.warn(
            `like: youtube_videos cache-hint INSERT failed (will re-read): ${err instanceof Error ? err.message : String(err)}`
          );
        }
        yt = await prisma.youtube_videos.findFirst({
          where: { youtube_video_id: videoId },
          select: { id: true },
        });
      }
      if (yt && body.mandalaId) {
        const cellIndex =
          typeof body.cellIndex === 'number' && Number.isFinite(body.cellIndex)
            ? body.cellIndex
            : -1;
        videoStatesUpdated = await prisma.$executeRaw(Prisma.sql`
          INSERT INTO public.user_video_states (
            user_id, video_id, is_in_ideation, watch_position_seconds,
            is_watched, cell_index, level_id, mandala_id, sort_order,
            auto_added, added_to_ideation_at, created_at, updated_at,
            pinned_at, surfaced_at
          )
          VALUES (
            ${userId}::uuid,
            ${yt.id}::uuid,
            false,
            0,
            false,
            ${cellIndex},
            'root',
            ${body.mandalaId}::uuid,
            NULL,
            false,
            now(),
            now(),
            now(),
            ${pinnedAt},
            ${pinnedAt}
          )
          ON CONFLICT (user_id, video_id) DO UPDATE
            SET pinned_at  = ${pinnedAt},
                surfaced_at = ${pinnedAt},
                auto_added = false,
                -- A like is "pin this video". cell_index is intentionally
                -- absent from the SET clause: moving cells is a different
                -- intent that must go through /move-cell. mandala_id stays
                -- so users can re-pin a video into a different mandala
                -- (Q1 design — one video belongs to one mandala).
                mandala_id = EXCLUDED.mandala_id
        `);
      } else {
        // No yt row → fall back to UPDATE-only path. Card stays in
        // panel-history sense (signal recorded) but won't appear in
        // mandala grid until a yt row exists. Follow-up: cache
        // populate via YouTube Data API at this point.
        videoStatesUpdated = await prisma.$executeRaw`
          UPDATE public.user_video_states uvs
             SET pinned_at = ${pinnedAt},
                 surfaced_at = ${pinnedAt},
                 auto_added = false
            FROM public.youtube_videos yv
           WHERE uvs.user_id = ${userId}::uuid
             AND uvs.video_id = yv.id
             AND yv.youtube_video_id = ${videoId}
        `;
        if (!yt) {
          log.warn(
            `like: youtube_videos row missing for videoId=${videoId} userId=${userId} — INSERT path skipped`
          );
        }
      }

      // 3. Enrichment job — only when the caller supplied a mandalaId so
      //    the v2 generator can resolve a center_goal. Title/description
      //    are best-effort hints; rich-summary falls back to youtube_videos
      //    metadata when omitted (downstream lookup in enrichRichSummary).
      let jobId: string | null = null;
      if (body.mandalaId) {
        try {
          jobId = await enqueueEnrichRichSummary({
            videoId,
            userId,
            mandalaId: body.mandalaId,
            title: body.title ?? '',
            description: body.description ?? undefined,
          });
        } catch (enqueueErr) {
          const enqueueMsg = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
          log.warn(
            `like: enrich enqueue failed (continuing without v2 enrich): videoId=${videoId} err=${enqueueMsg}`
          );
        }
      }

      // CP488 Phase 1c — user_curated → video_pool 유입 (fire-and-forget).
      // 사용자 Heart 는 강한 explicit signal: 이 영상은 학습 가치가 있다.
      // video_pool 에 'user_curated' source 로 영구 적재 → 다음 검색에서
      // 같은 사용자의 다른 만다라 + (V3_TIER1_SOURCES=v2_promoted,user_curated
      // 로 확장 시) 다른 사용자 추천에도 활용. embedding 도 함께 fire-and-forget.
      // Heart API latency 에는 영향 0.
      // FLAG: algorithm `enableUserCuratedIngest` (default true). mandala-
      //       level override 우선 → global active → env default. flag off
      //       시 pre-CP488 동작 (Heart 만 record, pool 미반영).
      void (async () => {
        try {
          const { resolveAlgorithm } = await import('../../modules/search/algorithm-resolver');
          const algo = await resolveAlgorithm({
            userId,
            mandalaId: body.mandalaId ?? null,
          });
          if (!algo.parameters.enableUserCuratedIngest) {
            log.info(`like → video_pool ingest DISABLED via algorithm flag (algo=${algo.id})`);
            return;
          }
          // 위에서 resolve된 `yt` row 가 있으면 그걸 쓰고, 없으면 한 번 더
          // 조회 (videoCacheHint 미수신 path).
          const ytFull = yt
            ? await prisma.youtube_videos.findFirst({
                where: { youtube_video_id: videoId },
                select: {
                  title: true,
                  description: true,
                  channel_title: true,
                  channel_id: true,
                  view_count: true,
                  like_count: true,
                  duration_seconds: true,
                  published_at: true,
                  thumbnail_url: true,
                },
              })
            : null;
          if (!ytFull) return; // youtube_videos row 자체가 없으면 skip
          const v = ytFull.view_count != null ? Number(ytFull.view_count) : 0;
          const quality = v >= 100_000 ? 'gold' : v >= 10_000 ? 'silver' : 'bronze';
          // P0 trust containment (scam-inflow, 2026-07-03): the Heart stays an
          // explicit user signal (never rejected from the USER's own mandala),
          // but a blocklisted title must not enter the shared pool where a
          // future source expansion could serve it to other users.
          const { titleHitsBlocklist } = await import(
            '@/skills/plugins/video-discover/v2/youtube-client'
          );
          if (ytFull.title && titleHitsBlocklist(ytFull.title)) {
            log.info(
              `like → video_pool ingest SKIPPED (blocklisted title): videoId=${videoId}`
            );
            return;
          }
          const lang = ytFull.title && /[가-힣]/.test(ytFull.title) ? 'ko' : 'en';
          // CP491 step 4 — short gate (demote Shorts at promote).
          const shortGate = await shortGateFields(videoId, ytFull.duration_seconds);
          await prisma.video_pool.upsert({
            where: { video_id: videoId },
            create: {
              ...shortGate,
              video_id: videoId,
              title: ytFull.title ?? '',
              description: ytFull.description ?? null,
              channel_name: ytFull.channel_title ?? null,
              channel_id: ytFull.channel_id ?? null,
              view_count: ytFull.view_count ?? 0n,
              like_count: ytFull.like_count ?? 0n,
              duration_seconds: ytFull.duration_seconds,
              published_at: ytFull.published_at,
              thumbnail_url: ytFull.thumbnail_url,
              language: lang,
              quality_tier: quality,
              source: 'user_curated',
              is_active: true,
            },
            update: {
              // 같은 영상이 이미 다른 source (v2_promoted, batch_trend, …) 로
              // 풀에 있을 수 있음. source 는 더 신뢰성 높은 기존 값을 보존
              // 하고 refreshed_at 만 갱신 (UPSERT idempotent).
              refreshed_at: new Date(),
            },
          });
        } catch (err) {
          log.warn(
            `like → video_pool upsert failed (non-fatal): videoId=${videoId} err=${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();

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
  fastify.post<{
    Params: { videoId: string };
    Body: { mandalaId?: string; removeFromMandala?: boolean };
  }>('/:videoId/unlike', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { videoId } = request.params;
    const body = request.body ?? {};
    const removeFromMandala = Boolean(body.removeFromMandala && body.mandalaId);

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
      if (removeFromMandala) {
        await prisma.$executeRaw`
            DELETE FROM public.user_video_states uvs
             USING public.youtube_videos yv
             WHERE uvs.user_id = ${userId}::uuid
               AND uvs.mandala_id = ${body.mandalaId}::uuid
               AND uvs.video_id = yv.id
               AND yv.youtube_video_id = ${videoId}
          `;
      } else {
        await prisma.$executeRaw`
            UPDATE public.user_video_states uvs
               SET pinned_at = NULL,
                   auto_added = false
              FROM public.youtube_videos yv
             WHERE uvs.user_id = ${userId}::uuid
               AND uvs.video_id = yv.id
               AND yv.youtube_video_id = ${videoId}
          `;
      }
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
  });

  /**
   * POST /api/v1/cards/:videoId/enrich-bg — idempotent background enrich
   * trigger (CP475+, 2026-05-20).
   *
   * The Learning Page mounts this when the side panel opens and the v2
   * row is missing its `segments` block (full path expired / not yet
   * generated). Heart-click also enqueues via `/like`; this endpoint
   * exists separately so we can fire it without changing pinned state.
   *
   * Body: { mandalaId: string }
   *
   * Returns 202 with one of:
   *   { jobId: string, reason: 'enqueued' }       → fresh job started
   *   { jobId: null,   reason: 'in_progress' }    → existing job still running
   *   { jobId: null,   reason: 'already_complete' } → row already has atoms
   *
   * Subscribe to GET /:videoId/enrich-stream for SSE phase updates.
   */
  fastify.post<{
    Params: { videoId: string };
    Body: { mandalaId: string };
  }>('/:videoId/enrich-bg', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    if (!request.user || !('userId' in request.user)) {
      return reply
        .code(401)
        .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const userId = request.user.userId;
    const { videoId } = request.params;
    const { mandalaId } = request.body ?? { mandalaId: '' };

    if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_VIDEO_ID',
        message: `videoId must be a YouTube 11-char id; got ${videoId.slice(0, VIDEO_ID_LOG_TRIM)}`,
      });
    }
    if (!mandalaId || typeof mandalaId !== 'string') {
      return reply.code(400).send({
        status: 'error',
        code: 'INVALID_MANDALA_ID',
        message: 'mandalaId is required',
      });
    }

    const prisma = getPrismaClient();
    try {
      // 1. Skip if the row already has segments — full path landed.
      const rs = await prisma.$queryRaw<Array<{ atom_count: number; quality_flag: string | null }>>`
        SELECT
          COALESCE(jsonb_array_length(NULLIF(segments->'atoms', 'null'::jsonb)), 0)::int AS atom_count,
          quality_flag
        FROM video_rich_summaries
        WHERE video_id = ${videoId}
          AND template_version = 'v2'
        LIMIT 1
      `;
      const row = rs[0];
      if (row && row.atom_count > 0) {
        return reply
          .code(202)
          .send({ status: 'ok', data: { jobId: null, reason: 'already_complete' } });
      }
      // 2. Skip if a recent job is still in-flight (created/active/retry).
      const inflight = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM pgboss.job
        WHERE name = 'enrich-rich-summary'
          AND data->>'videoId' = ${videoId}
          AND data->>'userId' = ${userId}
          AND state IN ('created', 'active', 'retry')
        ORDER BY createdon DESC
        LIMIT 1
      `;
      if (inflight.length > 0) {
        return reply
          .code(202)
          .send({ status: 'ok', data: { jobId: inflight[0]!.id, reason: 'in_progress' } });
      }
      // 3. Enqueue a fresh job.
      const jobId = await enqueueEnrichRichSummary({
        videoId,
        userId,
        mandalaId,
        title: '',
      });
      return reply.code(202).send({
        status: 'ok',
        data: { jobId, reason: 'enqueued' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`enrich-bg failed: videoId=${videoId} userId=${userId} err=${msg}`);
      return reply.code(500).send({
        status: 'error',
        code: 'ENRICH_BG_FAILED',
        message: msg.slice(0, 200),
      });
    }
  });

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
   * GET /api/v1/cards/v2-summaries?videoIds=a,b,c — batch lookup of the
   * v2 rich-summary "card-display" fields for a set of YouTube videos.
   *
   * Used by the FE card grid to render the Heart-only quality badge
   * (`mandala_relevance_pct`) and the footer one-liner. Both surface
   * only for videos the user has heart-clicked; for non-Heart'd cards
   * `mandala_relevance_pct` is NULL and the FE hides the badge per
   * decision #8.
   *
   * Schema-level caveat (documented for future PR): the v2 row is keyed
   * by video_id alone, so `mandala_relevance_pct` reflects the FIRST
   * user / mandala that triggered v2 generation. A second user heart-
   * clicking the same video reuses that score. Per-user scoring would
   * require a `user_video_relevance` table — out of scope for #649 Phase 2.
   *
   * Auth: required (user scope is implicit; the response itself contains
   *       no user-identifying data beyond what the card list already shows).
   *
   * Query string:
   *   videoIds — comma-separated list of YouTube 11-char ids
   *              (max 100; over-length lists are 400 to keep response time bounded)
   *
   * Returns 200 { items: [{videoId, oneLiner, mandalaRelevancePct, qualityFlag, templateVersion}] }
   */
  fastify.get<{ Querystring: { videoIds?: string } }>(
    '/v2-summaries',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      if (!request.user || !('userId' in request.user)) {
        return reply
          .code(401)
          .send({ status: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      const raw = request.query.videoIds ?? '';
      const ids = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (ids.length === 0) {
        return reply.code(200).send({ status: 'ok', data: { items: [] } });
      }
      if (ids.length > V2_SUMMARIES_MAX_IDS) {
        return reply.code(400).send({
          status: 'error',
          code: 'TOO_MANY_IDS',
          message: `videoIds count ${ids.length} exceeds max ${V2_SUMMARIES_MAX_IDS}`,
        });
      }
      for (const id of ids) {
        if (!YOUTUBE_VIDEO_ID_RE.test(id)) {
          return reply.code(400).send({
            status: 'error',
            code: 'INVALID_VIDEO_ID',
            message: `videoIds contains non-YouTube id: ${id.slice(0, VIDEO_ID_LOG_TRIM)}`,
          });
        }
      }

      const prisma = getPrismaClient();
      try {
        const [rows, summaryRows] = await Promise.all([
          prisma.video_rich_summaries.findMany({
            where: { video_id: { in: ids } },
            select: {
              video_id: true,
              one_liner: true,
              // CP476+ — `core` for jsonb `one_liner` priority (v2 path).
              // The legacy `one_liner` column was authored by the v1
              // pipeline and frequently exceeds the sidebar's 20-char
              // budget (one 44-char sentence observed in prod). The v2
              // jsonb path is trimOneLinerLabel-validated, so we prefer
              // it when present.
              core: true,
              analysis: true,
              // CP475+ — `segments` for v2FullLanded detection (atoms count).
              // FE promotes v2 essence over v1 description only when atoms > 0.
              segments: true,
              mandala_relevance_pct: true,
              quality_flag: true,
              template_version: true,
            },
          }),
          // Fallback keyword source for videos that have no v2 row yet —
          // sidebar book-index can render video_summaries.tags so a card is
          // not invisible while v2 is still being generated.
          prisma.video_summaries.findMany({
            where: { video_id: { in: ids } },
            select: { video_id: true, tags: true },
          }),
        ]);
        const tagsByVideo = new Map<string, string[]>();
        for (const s of summaryRows) {
          tagsByVideo.set(
            s.video_id,
            (s.tags ?? []).filter((t) => typeof t === 'string' && t.length > 0)
          );
        }
        const v2RowByVid = new Map(rows.map((r) => [r.video_id, r] as const));
        return reply.code(200).send({
          status: 'ok',
          data: {
            // Iterate over the full id list so videos without a v2 row still
            // receive a fallbackTags payload — sidebar can render those.
            items: ids.map((vid) => {
              const r = v2RowByVid.get(vid);
              const analysis = (r?.analysis ?? null) as {
                core_argument?: unknown;
                key_concepts?: unknown;
              } | null;
              const coreArgument =
                analysis && typeof analysis.core_argument === 'string'
                  ? analysis.core_argument
                  : null;
              const keyConcepts: string[] =
                analysis && Array.isArray(analysis.key_concepts)
                  ? (analysis.key_concepts as Array<{ term?: unknown }>)
                      .map((kc) => (kc && typeof kc.term === 'string' ? kc.term.trim() : ''))
                      .filter((t): t is string => t.length > 0)
                      .slice(0, 3)
                  : [];
              const fallbackTags = (tagsByVideo.get(vid) ?? []).slice(0, 3);
              const segments = (r?.segments ?? null) as { atoms?: unknown } | null;
              const v2FullLanded =
                segments != null &&
                Array.isArray(segments.atoms) &&
                (segments.atoms as unknown[]).length > 0;
              // CP476+ revised — oneLiner = jsonb `core.one_liner` ONLY.
              //
              // The PR #715 fallback path (column `one_liner` ran through
              // `trimOneLinerLabel`) produced mid-word slice-20 cuts on
              // legacy v1 rows where the column is a full sentence — the
              // sidebar rendered fragments like "왕초보도 쿠팡 위탁을 통해 쉽게 온라"
              // ("온라" mid-word) or "직장인도 부업으로 온라인 쇼핑몰을 0".
              //
              // CP473 directive (recorded 2026-04-29): sidebar entry text =
              // v2 `core.one_liner` only, no fallback. Cards without a
              // populated v2 row are intentionally hidden in the sidebar;
              // the next v2 quick / cron tick fills them in within seconds
              // (heart click) or 12 hours (legacy backfill). Honouring the
              // directive removes the mid-word artefact entirely.
              //
              // v1-only rows therefore render `oneLiner: null` here. The
              // sidebar code (`SidebarLearningSection.indexedEntries`)
              // already filters those out. A separate operator action
              // re-enqueues these rows for v2 backfill (see runbook
              // docs/runbook/v2-summary-user-audit-cleansing.md §7).
              const core = (r?.core ?? null) as { one_liner?: unknown; toc_label?: unknown } | null;
              const oneLinerOut =
                core && typeof core.one_liner === 'string' && core.one_liner.length > 0
                  ? core.one_liner
                  : null;
              // CP504 — short TOC label; FE falls back to oneLiner when absent.
              const tocLabelOut =
                core && typeof core.toc_label === 'string' && core.toc_label.length > 0
                  ? core.toc_label
                  : null;
              return {
                videoId: vid,
                oneLiner: oneLinerOut,
                tocLabel: tocLabelOut,
                coreArgument,
                keyConcepts,
                fallbackTags,
                mandalaRelevancePct: r?.mandala_relevance_pct ?? null,
                qualityFlag: r?.quality_flag ?? null,
                templateVersion: r?.template_version ?? '',
                v2FullLanded,
              };
            }),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`v2-summaries lookup failed: count=${ids.length} err=${msg}`);
        return reply.code(500).send({
          status: 'error',
          code: 'V2_SUMMARIES_FAILED',
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

      // SSE handshake — mirror the proven pattern in mandalas.ts:808.
      // `reply.hijack()` MUST come first so Fastify stops trying to
      // finalize the response on its own; without it the connection
      // closes immediately after our write and the FE EventSource sees
      // an `error` event ⇒ phase flips to 'failed' as soon as the
      // Heart click lands. Manual CORS headers because hijack() bypasses
      // the @fastify/cors plugin.
      void reply.hijack();
      const raw = reply.raw;
      const reqOrigin = request.headers.origin;
      // Reuse the central CORS allowlist via the config module (CP463
      // — fixed to satisfy CLAUDE.md "Hard Rule sub-bullet on env access
      // through config zod schema" + hardcode-audit baseline).
      const allowed = config.cors.allowedOrigins;
      if (reqOrigin && (allowed.includes('*') || allowed.includes(reqOrigin))) {
        raw.setHeader('Access-Control-Allow-Origin', reqOrigin);
        raw.setHeader('Access-Control-Allow-Credentials', 'true');
        raw.setHeader('Vary', 'Origin');
      }
      raw.setHeader('Content-Type', 'text/event-stream');
      raw.setHeader('Cache-Control', 'no-cache');
      raw.setHeader('Connection', 'keep-alive');
      raw.setHeader('X-Accel-Buffering', 'no');
      raw.statusCode = 200;
      raw.write('retry: 5000\n\n');
      raw.write(`: connected videoId=${videoId}\n\n`);

      const prisma = getPrismaClient();
      let lastPhase: string | null = null;
      const startedAt = Date.now();
      let closed = false;

      const sendPhase = (phase: string, extra?: Record<string, unknown>): void => {
        if (closed || raw.destroyed) return;
        const payload = JSON.stringify({ phase, videoId, ...extra });
        raw.write(`event: phase\ndata: ${payload}\n\n`);
      };

      const closeStream = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try {
          raw.end();
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
        // CP475+ — quick path completes long before the full job moves
        // to 'completed'. Without this check the dashboard spinner
        // stayed in 'analyzing' for the full Sonnet duration even
        // though `core.one_liner` + `mandala_relevance_pct` (the only
        // fields the grid card needs) were already in the DB. We
        // surface 'scored' as soon as the row carries the quick
        // payload and close the stream — full path keeps running in
        // the background; the Learning Page subscribes separately
        // (`PanelAISummary` + `/enrich-bg`).
        const quickRows = await prisma.$queryRaw<Array<{ has_quick: boolean }>>`
          SELECT (
            template_version = 'v2'
            AND core IS NOT NULL
            AND (core->>'one_liner') IS NOT NULL
            AND mandala_relevance_pct IS NOT NULL
          ) AS has_quick
          FROM video_rich_summaries
          WHERE video_id = ${videoId}
          LIMIT 1
        `;
        if (quickRows[0]?.has_quick && lastPhase !== 'scored') {
          sendPhase('scored', { trigger: 'quick' });
          lastPhase = 'scored';
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

// CP463 flicker-fix — was 1s. 2s halves the FE re-render rate during
// `analyzing` phase without delaying the user-visible 'scored' chip
// noticeably (LLM call takes 5-15s anyway, so 2s polling still emits
// the transition within one cycle of the actual state change).
const ENRICH_STREAM_POLL_MS = 2000;
// CP475+ — match RICH_SUMMARY_RETRY_OPTIONS.expireInMinutes (10min). The
// previous 5min cap fired 'timeout' before the BE job could complete,
// stranding the FE spinner without a final phase.
const ENRICH_STREAM_MAX_MS = 10 * 60 * 1000;
/**
 * v2-summaries batch cap — bounds response time + pg query cost. A typical
 * mandala renders 64 cards (V3_TARGET_TOTAL); doubling that absorbs heavy
 * pages without inviting massive single-query fetches.
 */
const V2_SUMMARIES_MAX_IDS = 128;

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
