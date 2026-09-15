/**
 * The cover an issue shows on a card.
 *
 * The lead pick's thumbnail when the issue has one -- a brief has no artwork
 * of its own, and a picture about nothing inside it would be worse than none.
 * When there is no pick, the category's own cover, served as a static file
 * under `frontend/public/brief-covers/`, so a shelf never shows a hole.
 *
 * `hqdefault` rather than `maxres`: maxres 404s on a good share of videos and
 * the card's error handler would then show the hole this exists to prevent.
 */

export const BRIEF_COVER_PATH = '/brief-covers';

export function coverUrlOf(videoId: string | null | undefined, categoryKey: string): string {
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return `${BRIEF_COVER_PATH}/${categoryKey}.svg`;
}
