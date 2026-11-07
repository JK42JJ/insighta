/**
 * Card source for the mobile morning cards (PRD #1788).
 * Reads today's candidates from the existing video_pool + video_pool_domain_tags
 * output only. No YouTube API call, no transcript access.
 */
import { DOMAIN_LABEL_KO, type DomainSlug } from '@/config/domains';
import type { MorningCardDomainKey } from './domains';
import { buildMorningCardReason } from './reason';

/** Default number of cards shown per domain. */
export const MORNING_CARDS_DEFAULT_LIMIT = 10;
/** Over-fetch factor so duplicate videos across tags do not shrink the list. */
const FETCH_MULTIPLIER = 3;

/**
 * PRD domain -> video_pool_domain_tags.domain labels (KO labels of the 9 pool slugs).
 * The pool taxonomy has no separate startup/gov slug, so that domain shares the
 * business label with work practice for now.
 */
const POOL_SLUGS_BY_DOMAIN: Readonly<Record<MorningCardDomainKey, readonly DomainSlug[]>> = {
  work_practice: ['business'],
  startup_gov_support: ['business', 'finance'],
  ai_tools: ['tech'],
};

export function poolDomainLabels(domain: MorningCardDomainKey): string[] {
  return POOL_SLUGS_BY_DOMAIN[domain].map((s) => DOMAIN_LABEL_KO[s]);
}

export interface MorningCard {
  video_id: string;
  title: string;
  channel_name: string | null;
  published_at: Date | null;
  thumbnail_url: string | null;
  reason: string;
}

interface TagRow {
  relevance_score: number;
  source: string;
  video_pool: {
    video_id: string;
    title: string;
    channel_name: string | null;
    published_at: Date | null;
    thumbnail_url: string | null;
  };
}

/** Minimal db surface used here (satisfied by the Prisma client, easy to mock). */
export interface MorningCardsDb {
  video_pool_domain_tags: {
    findMany(args: unknown): Promise<TagRow[]>;
  };
}

function buildSimpleReason(row: TagRow): string {
  return buildMorningCardReason({
    relevance_score: row.relevance_score,
    source: row.source,
    published_at: row.video_pool.published_at,
  });
}

export interface MorningCardsResult {
  cards: MorningCard[];
  /** True when fewer in-window cards exist than requested; never padded. */
  shortage: boolean;
}

/** Start of the upload window: Jan 1 (UTC) of the current year. */
export function uploadWindowStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

export async function fetchMorningCards(
  db: MorningCardsDb,
  domain: MorningCardDomainKey,
  limit: number = MORNING_CARDS_DEFAULT_LIMIT,
  now: Date = new Date()
): Promise<MorningCard[]> {
  return (await fetchMorningCardsWithShortage(db, domain, limit, now)).cards;
}

export async function fetchMorningCardsWithShortage(
  db: MorningCardsDb,
  domain: MorningCardDomainKey,
  limit: number = MORNING_CARDS_DEFAULT_LIMIT,
  now: Date = new Date()
): Promise<MorningCardsResult> {
  const windowStart = uploadWindowStart(now);
  const rows = await db.video_pool_domain_tags.findMany({
    where: {
      domain: { in: poolDomainLabels(domain) },
      video_pool: {
        is_active: true,
        is_short: { not: true },
        published_at: { gte: windowStart },
      },
    },
    orderBy: { relevance_score: 'desc' },
    take: limit * FETCH_MULTIPLIER,
    select: {
      relevance_score: true,
      source: true,
      video_pool: {
        select: {
          video_id: true,
          title: true,
          channel_name: true,
          published_at: true,
          thumbnail_url: true,
        },
      },
    },
  });

  const seen = new Set<string>();
  const cards: MorningCard[] = [];
  for (const row of rows) {
    const v = row.video_pool;
    if (seen.has(v.video_id)) continue;
    // Re-check the window in code in case the db layer ignores the filter.
    if (!v.published_at || v.published_at < windowStart) continue;
    seen.add(v.video_id);
    cards.push({
      video_id: v.video_id,
      title: v.title,
      channel_name: v.channel_name,
      published_at: v.published_at,
      thumbnail_url: v.thumbnail_url,
      reason: buildSimpleReason(row),
    });
    if (cards.length >= limit) break;
  }
  return { cards, shortage: cards.length < limit };
}
