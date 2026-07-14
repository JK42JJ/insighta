/**
 * Note-ready email CTA — pure helpers (config-free, unit-testable).
 *
 * The FE learning route is `/learning/:mandalaId/:videoId` (two segments,
 * frontend/src/app/router/index.tsx). A bare `/learning/:mandalaId` matches no
 * route and client-renders the 404 page — the exact bug a sample-email click
 * surfaced on 2026-07-14. Always emit a two-segment URL, or fall back to the
 * mandala dashboard (a real route) when the book has no video to focus.
 */

const SITE_ORIGIN = 'https://insighta.one';

/** Loose book_json walk — DB jsonb, so trust nothing about the shape. */
export function firstBookVideoId(bookJson: unknown): string | null {
  const book = bookJson as {
    chapters?: Array<{ sections?: Array<{ atoms?: Array<{ vid?: unknown }> }> }>;
  } | null;
  for (const chapter of book?.chapters ?? []) {
    for (const section of chapter?.sections ?? []) {
      for (const atom of section?.atoms ?? []) {
        if (typeof atom?.vid === 'string' && atom.vid.length > 0) return atom.vid;
      }
    }
  }
  return null;
}

/** Two-segment learning deep link when a focus video exists; dashboard otherwise. */
export function noteReadyCtaUrl(mandalaId: string, videoId: string | null): string {
  return videoId
    ? `${SITE_ORIGIN}/learning/${mandalaId}/${videoId}`
    : `${SITE_ORIGIN}/mandalas/${mandalaId}`;
}
