/**
 * batch-video-collector — Source A: trend keywords
 *
 * Pulls live keywords from the `trend_signals` table (populated by the
 * trend-collector skill). Each row carries `metadata.seed_domain` when
 * it came from the Suggest pipeline — we use that as the domain tag.
 * LLM-extracted rows (source='youtube_trending_extracted') don't have a
 * seed_domain and get tagged 'general'.
 *
 * The `limit` is split proportionally across domains so one domain can't
 * dominate the daily quota spend.
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'batch-video-collector/trend-source' });

export interface TrendKeyword {
  keyword: string;
  language: string;
  domain: string;
  /** Source of the trend signal (for audit). */
  trendSource: string;
  /** norm_score from trend_signals, [0, 1]. */
  score: number;
}

interface TrendRow {
  keyword: string;
  language: string;
  norm_score: number;
  source: string;
  metadata: unknown;
}

const DEFAULT_DOMAIN = 'general';

export interface LoadTrendKeywordsOpts {
  /** Zero-based offset into the dedup'd, score-sorted list. Used for
   *  3-day rotation so day 0 takes rows 0..59, day 1 60..119, day 2 120..179.
   *  Over-fetch is sized so slicing after dedup still has enough rows. */
  offset?: number;
}

/**
 * Load up to `limit` trend keywords, unexpired, ordered by norm_score desc.
 * Deduped by (keyword, language) — first (highest-scored) wins.
 */
export async function loadTrendKeywords(
  db: PrismaClient,
  limit: number,
  opts: LoadTrendKeywordsOpts = {}
): Promise<TrendKeyword[]> {
  const offset = Math.max(0, opts.offset ?? 0);
  // Fetch enough to cover offset + limit with dedup headroom.
  const fetchCount = Math.max((offset + limit) * 3, 50);
  const rows = await db.trend_signals.findMany({
    where: { expires_at: { gt: new Date() } },
    orderBy: [{ norm_score: 'desc' }],
    take: fetchCount,
    select: {
      keyword: true,
      language: true,
      norm_score: true,
      source: true,
      metadata: true,
    },
  });

  const seen = new Set<string>();
  const deduped: TrendKeyword[] = [];
  for (const r of rows as TrendRow[]) {
    const key = `${r.language}::${r.keyword.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      keyword: r.keyword,
      language: r.language,
      domain: extractDomain(r.metadata),
      trendSource: r.source,
      score: r.norm_score,
    });
  }

  const out = deduped.slice(offset, offset + limit);
  log.info(
    `loaded ${out.length} unique trend keywords (from ${rows.length} raw rows, dedup'd ${deduped.length}, offset ${offset}, limit ${limit})`
  );
  return out;
}

function extractDomain(metadata: unknown): string {
  if (metadata && typeof metadata === 'object' && 'seed_domain' in metadata) {
    const raw = (metadata as { seed_domain?: unknown }).seed_domain;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return DEFAULT_DOMAIN;
}
