/**
 * A grid renders one kind of card, and says so when it is handed another.
 *
 * Brief issues are drawn with the mandala card component, which means one
 * component now serves two things that must never mix: a mandala card is the
 * user's, sits in a cell, and is dragged; a brief issue is editorial,
 * read-only, and belongs to no mandala. If they mix the failure is silent —
 * an issue appears in a mandala cell, or a card API is called with an issue's
 * identifier and the request is not even wrong, just meaningless.
 *
 * Two defenses, in this order:
 *
 *   1. Identity. An issue's card id is `brief:<slug>`, which is not a uuid.
 *      The card endpoints validate uuids, so a mistaken call is rejected by
 *      the server rather than acted on. This is the strong one — it holds
 *      even when the mistake happens somewhere this file never sees.
 *
 *   2. Kind. `keepKind` drops what does not belong and logs it. Rendering the
 *      wrong card looks like a display bug; the log names it as what it is,
 *      which is a data fault upstream.
 *
 * The guard is not a substitute for the type. `linkType` is required, so
 * every card states its kind; this is what happens when one states the wrong
 * one.
 */

import type { InsightCard, LinkType } from '../model/types';

/** Issue card ids are namespaced so they can never be mistaken for a uuid. */
const BRIEF_ID_PREFIX = 'brief:';

export function briefCardId(slug: string): string {
  return `${BRIEF_ID_PREFIX}${slug}`;
}

/** The slug back out of a card id, or null if this is not an issue card. */
export function briefSlugFromCardId(id: string): string | null {
  return id.startsWith(BRIEF_ID_PREFIX) ? id.slice(BRIEF_ID_PREFIX.length) : null;
}

export function isBriefCard(card: Pick<InsightCard, 'linkType'>): boolean {
  return card.linkType === 'brief';
}

/**
 * Keep the cards that belong on this surface; log the ones that do not.
 *
 * `surface` names the grid in the log, because "a brief card turned up" is
 * not actionable and "a brief card turned up in the mandala grid" is.
 *
 * Logging is per call rather than per card: one bad response usually carries
 * several, and a console with forty identical lines is a console nobody
 * reads.
 */
export function keepKind(
  cards: InsightCard[],
  accepts: (kind: LinkType) => boolean,
  surface: string
): InsightCard[] {
  const kept: InsightCard[] = [];
  const rejected: InsightCard[] = [];
  for (const card of cards) (accepts(card.linkType) ? kept : rejected).push(card);

  if (rejected.length > 0) {
    console.error(
      `[card-kind] ${surface} was handed ${rejected.length} card(s) of the wrong kind — ` +
        'this is a data fault, not a display one',
      rejected.map((c) => ({ id: c.id, linkType: c.linkType, title: c.title }))
    );
  }
  return kept;
}

/** The brief grid takes issues and nothing else. */
export const acceptsBriefOnly = (kind: LinkType): boolean => kind === 'brief';

/** Every mandala surface takes anything a user can add — which is not an issue. */
export const acceptsUserCards = (kind: LinkType): boolean => kind !== 'brief';
