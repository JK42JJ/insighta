/** The swipe deck's explicit view (`/morning-cards?view=deck`); every other view is the watch screen. */
const DECK_VIEW = 'deck';

/** The address asks for the swipe deck (stg 2026-11-25: plain /morning-cards is the watch screen). */
export function isDeckView(search: string): boolean {
  return new URLSearchParams(search).get('view') === DECK_VIEW;
}
