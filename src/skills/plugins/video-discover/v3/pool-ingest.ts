/**
 * CP489 Phase 1 — Tier 2 raw candidate → video_pool ingest helper.
 *
 * Background: every v3 discovery run (wizard precompute + add-cards) fetches
 * ~30 candidates per cell from YouTube `search.list`, enriches with
 * `videos.list` (viewCount / duration), filters shorts / blocklist / lang,
 * then passes the survivors into mandala-filter. CP489 measurement showed
 * the survivors are mostly NEW relative to `video_pool` (GLOBAL hit 3.6%,
 * niche-mandala 1.5%) — most Tier 2 calls embed cold and waste the work.
 *
 * This helper persists the enriched-but-not-yet-mandala-filtered list into
 * `video_pool` so the same videos hit cache on subsequent searches. Same
 * fire-and-forget UPSERT pattern as the user_curated path in cards.ts:480,
 * with a distinct `source` tag for diagnostic separation.
 *
 * Failure mode: every error logged + swallowed. Pool ingest must NEVER
 * affect user-facing latency or correctness — the helper is best-effort
 * background work.
 */

import type { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-discover/v3/pool-ingest' });

/**
 * Minimum shape of an enriched Tier 2 candidate needed for video_pool
 * UPSERT. Mirrors the `Enriched` type local to executor.ts.
 */
export interface IngestCandidate {
  videoId: string;
  title: string;
  description?: string | null;
  channelTitle?: string | null;
  channelId?: string | null;
  thumbnail?: string | null;
  viewCount: number | null;
  likeCount: number | null;
  durationSec: number | null;
  publishedDate: Date | null;
}

export interface IngestPoolOpts {
  prisma: PrismaClient;
  candidates: ReadonlyArray<IngestCandidate>;
  language: 'ko' | 'en';
  source: 'wizard_realtime' | 'add_cards_realtime';
}

export interface IngestPoolResult {
  attempted: number;
  inserted: number;
  errors: number;
}

/**
 * Quality tier classification — mirrors batch-video-collector/manifest.ts
 * thresholds so a video's tier stays consistent across ingest paths.
 */
function classifyQualityTier(viewCount: number | null): 'gold' | 'silver' | 'bronze' {
  const v = viewCount ?? 0;
  if (v >= 100_000) return 'gold';
  if (v >= 10_000) return 'silver';
  return 'bronze';
}

/**
 * Upsert each enriched candidate into video_pool. Idempotent via PK; if a
 * row already exists with a more authoritative source ('v2_promoted',
 * 'batch_trend', etc.) the `source` column is preserved by the UPDATE
 * branch (only `refreshed_at` is bumped). Same conservative semantics as
 * the user_curated path.
 *
 * Returns counts but never throws. Per-row failure is logged at warn level.
 */
export async function ingestEnrichedToPool(opts: IngestPoolOpts): Promise<IngestPoolResult> {
  const { prisma, candidates, language, source } = opts;
  const result: IngestPoolResult = { attempted: 0, inserted: 0, errors: 0 };

  if (candidates.length === 0) return result;

  for (const c of candidates) {
    if (!c.videoId || !c.title) continue;
    result.attempted += 1;
    const qualityTier = classifyQualityTier(c.viewCount);
    try {
      await prisma.video_pool.upsert({
        where: { video_id: c.videoId },
        create: {
          video_id: c.videoId,
          title: c.title,
          description: c.description ?? null,
          channel_name: c.channelTitle ?? null,
          channel_id: c.channelId ?? null,
          view_count: c.viewCount != null ? BigInt(c.viewCount) : 0n,
          like_count: c.likeCount != null ? BigInt(c.likeCount) : 0n,
          duration_seconds: c.durationSec,
          published_at: c.publishedDate,
          thumbnail_url: c.thumbnail ?? null,
          language,
          quality_tier: qualityTier,
          source,
          is_active: true,
        },
        update: {
          refreshed_at: new Date(),
        },
      });
      result.inserted += 1;
    } catch (err) {
      result.errors += 1;
      log.warn(
        `pool-ingest upsert failed (non-fatal): videoId=${c.videoId} source=${source} err=${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return result;
}
