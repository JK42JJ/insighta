/**
 * Single source for the publish-period bucket mapping (2026-07-03).
 *
 * Two divergent copies existed — AddCardsFilters.isoToDaysBucket (chip
 * selection state) and an inline mapping in AddCardsList's round summary.
 * The summary copy topped out at "지난 1년", so a 2yr search was DISPLAYED
 * as 1yr (user report). Both callers now share this table.
 */

export const MS_PER_DAY = 86_400_000;

/** Chip values of PUBLISHED_PRESETS (days as string; '' = any time). */
export type PublishedBucket = '' | '7' | '30' | '180' | '365' | '730' | '1095';

/** Bucket upper bounds carry +1..+15d slack so an ISO produced by
 *  `daysAgoIso(N)` still lands in bucket N after clock skew / a stale
 *  snapshot being re-rendered days later. */
const BUCKET_MAX_DAYS: ReadonlyArray<[number, PublishedBucket]> = [
  [8, '7'],
  [31, '30'],
  [181, '180'],
  [366, '365'],
  [731, '730'],
  [Infinity, '1095'],
];

export function isoToPublishedBucket(iso: string, nowMs: number = Date.now()): PublishedBucket {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.round((nowMs - ts) / MS_PER_DAY);
  for (const [max, bucket] of BUCKET_MAX_DAYS) {
    if (days <= max) return bucket;
  }
  return '1095';
}
