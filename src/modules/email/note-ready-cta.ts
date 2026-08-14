/**
 * Note-ready email CTA — pure helper (config-free, unit-testable).
 *
 * The FE learning route is `/learning/:mandalaId/:videoId` (two segments,
 * frontend/src/app/router/index.tsx); `?view=note` lands directly in note mode
 * (the CTA promises the note, not the player). The focus video MUST come from
 * the same source the learning page renders (user_local_cards placed cards) —
 * a book-atom pick can target a mandala whose learning list is empty, which
 * reads as a broken page (2026-07-14 sample regression). No placed video →
 * link the mandala dashboard, never a hollow learning deep link.
 */

const SITE_ORIGIN = 'https://insighta.one';

/** Note-mode learning deep link when a placed video exists; dashboard otherwise. */
export function noteReadyCtaUrl(mandalaId: string, videoId: string | null): string {
  return videoId
    ? `${SITE_ORIGIN}/learning/${mandalaId}/${videoId}?view=note`
    : `${SITE_ORIGIN}/mandalas/${mandalaId}`;
}
