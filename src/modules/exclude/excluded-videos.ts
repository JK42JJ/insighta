/**
 * Shared exclude-set helper for card retrieval paths (CP489+ dedup-bleed fix).
 *
 * SSOT for the `excluded video_ids` query used by Add Cards (add-cards.ts) +
 * v3 video-discover executor. Both must apply the IDENTICAL policy so the
 * same set of videos is filtered everywhere.
 *
 * Policy — Explicit > Inferred (v0 decision #2 applied to exclude semantics):
 *   Only 3 signals from user_video_states are treated as "user really
 *   engaged" — everything else (in-ideation, partial watch, ghost rows)
 *   is left in the candidate pool for the LLM picker to re-evaluate.
 *
 *   user_video_states engagement signals (CP490+ shrink from 6 → 3):
 *     - is_watched = TRUE       (definitely consumed)
 *     - pinned_at IS NOT NULL   (definitely bookmarked)
 *     - user_note IS NOT NULL   (definitely annotated)
 *
 *   Dropped (CP490 directive): is_in_ideation, watch_position_seconds > 0,
 *   auto_added = FALSE. These rows are now re-surfaceable by the LLM
 *   picker.
 *
 *   Explicit signals always excluded:
 *     - user_local_cards.video_id (user explicitly added to a mandala)
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
  const [ownLocal, ownStates, deleteSignals, archiveSignals, liveFeed] = await Promise.all([
    prisma.user_local_cards.findMany({
      where: { user_id: userId },
      select: { video_id: true },
    }),
    // CP492 — GLOBAL owned-video exclusion. user_video_states has a GLOBAL
    // unique([user_id, video_id]); a video the user owns in ANY mandala cannot
    // be re-added (the /cards/:id/like UPSERT only touches pinned_at, never
    // moves mandala_id — cards.ts:202). Recommending such a video = silent
    // no-op ("no reaction" + card-count loss: measured 20/35 Add Cards recs
    // already owned, 14 of them in OTHER mandalas). So exclude EVERY owned
    // video, regardless of mandala or engagement signal.
    //
    // Replaces the prior mandala+signal-scoped exclusion, whose "let other
    // mandalas' cards surface" intent was incompatible with the global unique
    // (they surfaced as un-addable). recommendation_cache exclusion below stays
    // mandala-scoped (#826) — different table, no unique conflict, re-addable.
    //
    // CP489 note: do NOT narrow this back to dodge starvation. Owned videos are
    // un-addable; if net-new candidates run low, that is a SUPPLY signal — fix
    // via fanout (V5_SEARCH_MAX_RESULTS / V5_TARGET_PICKS), not by re-surfacing
    // un-addable dupes. Watch exclude_set_size in the add_cards.end trace.
    prisma.$queryRaw<Array<{ youtube_video_id: string }>>(Prisma.sql`
      SELECT yv.youtube_video_id
        FROM public.user_video_states uvs
        JOIN public.youtube_videos yv ON yv.id = uvs.video_id
       WHERE uvs.user_id = ${userId}::uuid
    `),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'delete' },
      select: { video_id: true },
    }),
    prisma.card_interactions.findMany({
      where: { user_id: userId, signal: 'archive', mandala_id: mandalaId },
      select: { video_id: true },
    }),
    // CP492 — cards currently in THIS mandala's feed (wizard pre-fill + already
    // added). Without this, Add Cards re-surfaces the wizard's own cards (85-93%
    // overlap measured). MANDALA-SCOPED + non-expired only — distinct from the
    // CP489 user_video_states ghost policy (different source), so it does NOT
    // re-introduce CP489's starvation (that was 58 static ghost rows; this is
    // ~30 cards out of a fresh ~120-candidate Tier 2 fanout) and causes NO
    // cross-mandala bleed (other mandalas' cards still surface). Expired rows
    // are left re-surfaceable (not a permanent exclude).
    prisma.recommendation_cache.findMany({
      where: { user_id: userId, mandala_id: mandalaId, expires_at: { gt: new Date() } },
      select: { video_id: true },
    }),
  ]);
  const excludeSet = new Set<string>();
  for (const id of requestExcludeIds) excludeSet.add(id);
  for (const r of ownLocal) if (r.video_id) excludeSet.add(r.video_id);
  for (const r of ownStates) excludeSet.add(r.youtube_video_id);
  for (const r of deleteSignals) excludeSet.add(r.video_id);
  for (const r of archiveSignals) excludeSet.add(r.video_id);
  for (const r of liveFeed) if (r.video_id) excludeSet.add(r.video_id);
  return excludeSet;
}
