/**
 * Shared exclude-set helper for card retrieval paths (CP489+ dedup-bleed fix).
 *
 * SSOT for the `excluded video_ids` query used by Add Cards (add-cards.ts) +
 * v3 video-discover executor. Both must apply the IDENTICAL policy so the
 * same set of videos is filtered everywhere.
 *
 * Policy — Explicit > Inferred (v0 decision #2 applied to exclude semantics):
 *   user_video_states is INCLUDED only when at least one engagement signal
 *   is non-zero. Wizard-pre-fill rows (auto_added=true with all engagement
 *   fields zero) are NOT excluded — they are inferred candidates, not
 *   explicit rejections.
 *
 *   Engagement signals (any one = explicit engagement):
 *     - is_watched = true
 *     - is_in_ideation = true
 *     - user_note IS NOT NULL
 *     - watch_position_seconds > 0
 *     - pinned_at IS NOT NULL
 *
 *   Explicit signals always excluded:
 *     - user_local_cards.video_id (user explicitly added)
 *     - card_interactions.signal = 'delete' (explicit "do not recommend")
 *     - card_interactions.signal = 'archive' (explicit hide for mandala)
 *
 * Root cause being fixed (prod data 2026-05-30):
 *   Mandala 3f8a8dab: 58 user_video_states rows, 54 of which (93%) are
 *   auto_added=true with zero engagement — wizard pre-fill ghost. Old policy
 *   permanently excluded all 58, causing Add Cards to return 0-7 cards
 *   instead of the configured Tier 2 cap of ~40. After this fix the 54
 *   ghost rows fall out of the exclude set and the wide candidate pool is
 *   restored to the next retrieval call.
 *
 * Backlog (separate scope, do not include here):
 *   - Whether wizard should write to user_video_states at all
 *   - Cleanup of the 98+ existing auto_added=true zero-engagement rows
 *     (query fix alone makes them inert; physical DELETE optional)
 *   - card_interactions.signal='surfaced' (PR #788) does not block exclude
 *     — by design (boost, not block)
 */

import { Prisma } from '@prisma/client';

import { getPrismaClient } from '@/modules/database/client';

export interface ExcludeSetOpts {
  prisma: ReturnType<typeof getPrismaClient>;
  userId: string;
  mandalaId: string;
  requestExcludeIds?: string[];
}

/**
 * Returns the set of youtube_video_id strings that must be filtered out
 * of any candidate list for `userId` in this `mandalaId`. Read-only.
 */
export async function getExcludedVideoIds(opts: ExcludeSetOpts): Promise<Set<string>> {
  const { prisma, userId, mandalaId, requestExcludeIds = [] } = opts;
  const [ownLocal, ownStates, deleteSignals, archiveSignals] = await Promise.all([
    prisma.user_local_cards.findMany({
      where: { user_id: userId },
      select: { video_id: true },
    }),
    prisma.$queryRaw<Array<{ youtube_video_id: string }>>(Prisma.sql`
      SELECT yv.youtube_video_id
        FROM public.user_video_states uvs
        JOIN public.youtube_videos yv ON yv.id = uvs.video_id
       WHERE uvs.user_id = ${userId}::uuid
         AND uvs.mandala_id = ${mandalaId}::uuid
         AND (
           uvs.is_watched = TRUE
           OR uvs.is_in_ideation = TRUE
           OR uvs.user_note IS NOT NULL
           OR uvs.watch_position_seconds > 0
           OR uvs.pinned_at IS NOT NULL
           OR uvs.auto_added = FALSE
         )
    `),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'delete' },
      select: { video_id: true },
    }),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'archive', mandala_id: mandalaId },
      select: { video_id: true },
    }),
  ]);
  const excludeSet = new Set<string>();
  for (const id of requestExcludeIds) excludeSet.add(id);
  for (const r of ownLocal) if (r.video_id) excludeSet.add(r.video_id);
  for (const r of ownStates) excludeSet.add(r.youtube_video_id);
  for (const r of deleteSignals) excludeSet.add(r.video_id);
  for (const r of archiveSignals) excludeSet.add(r.video_id);
  return excludeSet;
}
