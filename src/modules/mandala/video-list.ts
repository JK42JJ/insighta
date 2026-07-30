/**
 * Video-mode list helpers (V0 of the dial video tab redesign, 2026-07-30).
 *
 * Pure functions only — the route in `src/api/routes/mandalas.ts` composes
 * them. Kept separate so the sort/merge/coverage rules are unit-testable
 * without Fastify or Prisma.
 *
 * The sort is a server-side mirror of the FE dashboard comparator
 * (`frontend/src/widgets/card-list-view/ui/CardListView.tsx`
 * `relevanceSortValue`): a real 0-100 A-stage score wins outright; an
 * unscored (NULL) card falls back to a recency proxy capped BELOW the
 * recommended(70)/core(80) tiers so fresh-but-unscored cards interleave mid-tier
 * instead of sinking — same constants, same 90d linear fade.
 */

import { MS_PER_DAY } from '@/utils/time-constants';

export const NULL_RECENCY_CAP = 60;
export const NULL_RECENCY_WINDOW_MS = 90 * MS_PER_DAY; // 90d linear fade to 0

export const VIDEO_LIST_DEFAULT_LIMIT = 50;
export const VIDEO_LIST_MAX_LIMIT = 200;

export interface VideoListEntry {
  videoId: string; // 11-char YouTube id
  title: string;
  channel: string | null;
  thumbnail: string | null;
  durationSec: number | null;
  views: number | null;
  relevancePct: number | null;
  pinnedAt: string | null; // ISO
  createdAtMs: number; // placement row creation — recency proxy input
  source: 'uvs' | 'ulc';
}

export const videoListSortValue = (
  relevancePct: number | null,
  createdAtMs: number,
  nowMs: number
): number => {
  if (relevancePct != null) return relevancePct;
  const frac = Math.max(0, 1 - (nowMs - createdAtMs) / NULL_RECENCY_WINDOW_MS);
  return frac * NULL_RECENCY_CAP;
};

/** DESC by sort value; stable videoId tiebreak so pages don't reshuffle. */
export const makeVideoListComparator =
  (nowMs: number) =>
  (a: VideoListEntry, b: VideoListEntry): number => {
    const d =
      videoListSortValue(b.relevancePct, b.createdAtMs, nowMs) -
      videoListSortValue(a.relevancePct, a.createdAtMs, nowMs);
    return d !== 0 ? d : a.videoId.localeCompare(b.videoId);
  };

/**
 * Same video can be placed in both uvs and ulc. Keep one row per videoId:
 * a scored row beats an unscored one (the score is what we sort by);
 * on equal scoredness uvs wins (primary placement table, CP498).
 */
export const dedupeByVideoId = (entries: VideoListEntry[]): VideoListEntry[] => {
  const byId = new Map<string, VideoListEntry>();
  for (const e of entries) {
    const prev = byId.get(e.videoId);
    if (!prev) {
      byId.set(e.videoId, e);
      continue;
    }
    const prevScored = prev.relevancePct != null;
    const curScored = e.relevancePct != null;
    if (curScored && !prevScored) byId.set(e.videoId, e);
    else if (curScored === prevScored && prev.source === 'ulc' && e.source === 'uvs')
      byId.set(e.videoId, e);
  }
  return Array.from(byId.values());
};

/**
 * Coverage of the v2 section timeline over the actual video duration.
 * Mirrors the PC gate (PlayerChrome hides the relevance strip < 0.9) and
 * the #1078 long-video truncation caveat: the mound and core-only mode must
 * not pretend the whole video was analysed when only the head was.
 * Returns null when it cannot be computed (no sections / no duration).
 */
export const segCoverage = (
  sections: Array<{ to_sec?: unknown }> | null | undefined,
  durationSec: number | null
): number | null => {
  if (!sections || sections.length === 0 || !durationSec || durationSec <= 0) return null;
  const last = sections[sections.length - 1];
  const to = typeof last?.to_sec === 'number' ? last.to_sec : null;
  if (to == null || to <= 0) return null;
  return Math.min(1, to / durationSec);
};
