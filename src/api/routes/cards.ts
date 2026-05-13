/**
 * Card Pin / Bookmark Routes (CP457+)
 *
 * REST API endpoints for toggling pin state on grid view cards.
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
 * Pin = UX bookmark (save for later) + behavioural signal for ranking.
 * NULL = unpinned, TIMESTAMPTZ = pinned moment. See:
 *   prisma/migrations/pin/001_add_pinned_at.sql (DDL)
 *   prisma/schema.prisma (model fields + partial indexes)
 */

import { FastifyPluginCallback } from 'fastify';
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';

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

  done();
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}
