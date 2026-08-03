/**
 * Curation personalization constants (Growth Hub, 2026-07-20).
 * Design: docs/design/growth-hub-curation-personalized-2026-07-20.md (§4).
 *
 * Initial values are DOCUMENTED ASSUMPTIONS, not tuned. P1 exposes these via
 * admin/URL for measured tuning (no-hardcoding hard rule: named consts, single
 * source, flag-off = current behavior). Do NOT sprinkle these literals across
 * modules — import from here.
 */

import { MS_PER_DAY } from '@/utils/time-constants';

/** Interest-signal weights (§4). Saved playlist videos = explicit intent → outrank subs. */
export const INTEREST_WEIGHTS = Object.freeze({
  /** subscribed channel = passive interest */
  sub: 0.4,
  /** playlist-saved video = explicit intent (higher) */
  save: 0.6,
});

/** Account-collection page caps (§2) — bound quota for power users. */
export const COLLECT_CAPS = Object.freeze({
  /** max subscription pages fetched (50 items/page) */
  subscriptionPages: 4,
  /** max playlist pages fetched */
  playlistPages: 2,
  /** max playlists whose items are read */
  playlists: 15,
  /** max item pages per playlist */
  playlistItemPages: 1,
  /** max saved videos whose titles are resolved via getVideosMetadata */
  savedVideos: 100,
});

/** 3-proposal scoring weights (§4). affinity dominates so cold-start reflects the account. */
export const PROPOSAL_WEIGHTS = Object.freeze({
  affinity: 0.45,
  rising: 0.3,
  reinforce: 0.2,
  redundancy: 0.15,
});

/** rising-signal half-life (days) for the recency component. */
export const RISING_HALFLIFE_DAYS = 14;

/** reinforcement increments derived from the proposal log (§5). α = selected, β = proposed-but-unselected. */
export const REINFORCE = Object.freeze({
  alpha: 0.2,
  beta: 0.05,
});

/** number of topics proposed to the user. */
export const PROPOSAL_COUNT = 3;

/** max proposals sharing one domain (filter-bubble guard, §4). */
export const MAX_PER_DOMAIN = 2;

/** min learning_score for an extracted keyword to enter the interest profile. */
export const KEYWORD_LEARNING_FLOOR = 0.3;

/** min relevance_pct for a discovered video to enter a curation feed (off-topic drop). */
export const CURATION_RELEVANCE_FLOOR = 40;

/** recency window (days) for the discovery leg's publishedAfter — the rising bias (§4-B5). */
export const CURATION_PUBLISHED_AFTER_DAYS = 365;

/**
 * Weekly pick ladder (2026-08-03, revised same day after the empty-week
 * incident): the topic-mode pick walks these rungs ACCUMULATING candidates,
 * freshest-first, until the week is full. Principle order is codified —
 * this week's uploads > fresh > never-served > less-aligned never-served >
 * long-ago-served re-entry — and NO rung combination may end at an empty
 * week ("덜 정렬된 카드 > 카드 0장", the converged serving principle).
 *
 * exclusionWeeks: how far back the served-history exclusion reaches.
 * null = everything ever served stays out; 4 = only the last four weeks
 * stay out (a month-old good video returning beats an empty week).
 */
export interface CurationPickRung {
  freshDays: number | null;
  threshold: number;
  exclusionWeeks: number | null;
}

export const CURATION_PICK_RUNGS: readonly CurationPickRung[] = Object.freeze([
  { freshDays: 7, threshold: 0.5, exclusionWeeks: null },
  { freshDays: 14, threshold: 0.5, exclusionWeeks: null },
  { freshDays: 30, threshold: 0.5, exclusionWeeks: null },
  { freshDays: null, threshold: 0.5, exclusionWeeks: null },
  { freshDays: null, threshold: 0.35, exclusionWeeks: null },
  { freshDays: null, threshold: 0.35, exclusionWeeks: 4 },
  { freshDays: null, threshold: 0.2, exclusionWeeks: 4 },
]);

/** Concrete per-week plan: rungs resolved to dates against the week's Monday. */
export interface CurationPickStep {
  publishedAfter?: Date;
  threshold: number;
  /** Exclude only items served at/after this week_of; undefined = exclude all. */
  exclusionAfter?: Date;
}

export function curationPickPlan(weekStart: Date): CurationPickStep[] {
  return CURATION_PICK_RUNGS.map((r) => ({
    ...(r.freshDays != null
      ? { publishedAfter: new Date(weekStart.getTime() - r.freshDays * MS_PER_DAY) }
      : {}),
    threshold: r.threshold,
    ...(r.exclusionWeeks != null
      ? { exclusionAfter: new Date(weekStart.getTime() - r.exclusionWeeks * 7 * MS_PER_DAY) }
      : {}),
  }));
}

/** cooldown before re-attempting a failed interest-profile build — avoids the
 * suggest poll re-firing a doomed build every few seconds (P1). */
export const PROFILE_ERROR_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
