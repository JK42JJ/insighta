/**
 * archived-videos.ts — SSOT for the DISPLAY archive gate (CP504).
 *
 * `card_interactions.signal='archive'` is recorded on archive but was never a
 * display gate — only the recommendation-candidate path (excluded-videos.ts) and
 * a per-device localStorage filter (CardList.tsx) ever consumed it, so archived
 * cards leaked into the video-mode index, ideaspot, grid, note book, and cell
 * counts (measured: 26 archive signals, 11 leaking into the video mode + 4 into
 * the note book). This helper centralises the archive lookup so EVERY display
 * path applies the IDENTICAL exclusion and it cannot silently go missing
 * per-path again.
 *
 * MANDALA-SCOPED: a video archived in mandala A is hidden ONLY in A, not in B
 * (the same video may be relevant elsewhere). The `mandala_id` column already
 * carries this scope; no DDL is required for the gate (the shared UNIQUE
 * `(user_id, video_id, signal)` overwrite is a separate write-path concern with
 * zero current cross-mandala collisions).
 *
 * Distinct from getExcludedVideoIds (excluded-videos.ts): that excludes ALL
 * owned/delete/surfaced videos for *recommendation* candidate generation — the
 * opposite of what display wants. This is archive-only.
 */

import { getPrismaClient } from '@/modules/database/client';

/**
 * Returns the set of youtube_video_id strings the user has archived IN this
 * mandala. These must be excluded from every display + book + count path.
 * Read-only.
 */
export async function getArchivedVideoIds(
  prisma: ReturnType<typeof getPrismaClient>,
  userId: string,
  mandalaId: string
): Promise<Set<string>> {
  const rows = await prisma.card_interactions.findMany({
    where: { user_id: userId, signal: 'archive', mandala_id: mandalaId },
    select: { video_id: true },
  });
  return new Set(rows.map((r) => r.video_id));
}
