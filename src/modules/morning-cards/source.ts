/**
 * Card source for the mobile morning cards (PRD #1788).
 * Reads today's candidates from the existing video_pool + video_pool_domain_tags
 * output only. No YouTube API call, no transcript access.
 */
import { DOMAIN_LABEL_KO } from '@/config/domains';
import type { MorningCardDomainKey } from './domains';
import { buildMorningCardReason } from './reason';

/** Default number of cards shown per domain. */
export const MORNING_CARDS_DEFAULT_LIMIT = 10;
/** Over-fetch factor so duplicate videos across tags do not shrink the list. */
const FETCH_MULTIPLIER = 3;

/**
 * PRD domain -> video_pool_domain_tags.domain values.
 * Owner decision (2026-11-07): 창업·정부 지원 reads the pool tags `startup` and `policy`
 * (the 9 pool slugs have no separate startup/government slug, but the pool carries both tags).
 */
const POOL_LABELS_BY_DOMAIN: Readonly<Record<MorningCardDomainKey, readonly string[]>> = {
  work_practice: [DOMAIN_LABEL_KO.business],
  startup_gov_support: ['startup', 'policy'],
  ai_tools: [DOMAIN_LABEL_KO.tech],
};

export function poolDomainLabels(domain: MorningCardDomainKey): string[] {
  return [...POOL_LABELS_BY_DOMAIN[domain]];
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

function buildSimpleReason(domain: MorningCardDomainKey): string {
  return buildMorningCardReason({ domain_label: MORNING_CARD_DOMAINS[domain].label });
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
      reason: buildSimpleReason(domain),
    });
    if (cards.length >= limit) break;
  }
  return { cards, shortage: cards.length < limit };
}
