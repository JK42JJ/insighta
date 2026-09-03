/**
 * A brief issue, as a card.
 *
 * The card component is the mandala's — not a copy of it. A reader who has
 * learned that a card is a thing you click to read should not have to learn a
 * second shape for the same act, and a second component would drift from the
 * first the first week either changed.
 *
 * What an issue does not have is filled honestly rather than plausibly:
 *
 *   cover      the lead pick's thumbnail. A brief has no artwork, and
 *              generating one would put a picture on the shelf that is about
 *              nothing inside it.
 *   cellIndex  -1. An issue is in no cell; a real index would be a claim
 *              about a mandala it does not belong to.
 *   mandalaId  null, which is also what hides the card's archive control:
 *              that button is gated on a mandala id, and archiving an issue
 *              out of a mandala it was never in is not an act with a meaning.
 *   createdAt  the publication date, not the row's. A weekly is filed by
 *              when it came out.
 */

import type { InsightCard } from '../model/types';
import type { SubscribedBriefIssue } from '@/shared/lib/api-client';
import { briefCardId } from './card-kind';

/** An issue is in no cell. -1 says so; 0 would name the first one. */
const NO_CELL = -1;

/**
 * The cover. `hqdefault` rather than `maxres`, because maxres 404s on a good
 * share of videos and the card's error handler would then show a hole where
 * the lead story is.
 */
function coverUrl(videoId: string | null): string {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
}

export function briefIssueToInsightCard(issue: SubscribedBriefIssue): InsightCard {
  return {
    id: briefCardId(issue.slug),
    // Where the card goes when clicked. The reader surface, not the API's
    // review page.
    videoUrl: `/brief/${issue.slug}`,
    title: issue.headline,
    thumbnail: coverUrl(issue.coverVideoId),
    // The standfirst is what the issue says it is about, written for a reader
    // rather than assembled from fields.
    userNote: issue.dek,
    createdAt: new Date(issue.publishedAt),
    publishedAt: new Date(issue.publishedAt),
    cellIndex: NO_CELL,
    levelId: 'brief',
    mandalaId: null,
    linkType: 'brief',
  };
}
