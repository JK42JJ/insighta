/**
 * PoolProvider — VideoProvider implementation backed by PostgreSQL video_pool.
 *
 * Priority: 2 (medium — runs after RedisProvider=1, before YouTubeProvider=3).
 * Uses pgvector cosine similarity via the existing matchFromVideoPool() helper.
 *
 * Issue: #508
 * Design: docs/design/insighta-video-cache-layer-design.md §5-1
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { matchFromVideoPool } from '../cache-matcher';
import type { CachedMatch } from '../cache-matcher';
import type {
  VideoProvider,
  ProviderHealth,
  MatchRequest,
  MatchResult,
  VideoCandidate,
} from './types';

const log = logger.child({ module: 'video-discover/v3/providers/pool-provider' });

/** Per-cell candidate cap passed to matchFromVideoPool. */
const PER_CELL_LIMIT = 10;

/** Source tag for all candidates produced by this provider. */
const PROVIDER_SOURCE = 'pool' as const;

/** Provider id used to identify this implementation in logs and meta. */
const PROVIDER_ID = 'pool' as const;

/** Priority relative to other providers (lower = runs first). */
const PROVIDER_PRIORITY = 2;

// ============================================================================
// PoolProvider
// ============================================================================

export class PoolProvider implements VideoProvider {
  readonly id = PROVIDER_ID;
  readonly priority = PROVIDER_PRIORITY;

  /**
   * Check whether the video_pool table has at least one active row.
   * Measures round-trip latency to the DB.
   */
  async health(): Promise<ProviderHealth> {
    const db = getPrismaClient();
    const start = Date.now();

    try {
      const result = await db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count
          FROM video_pool
         WHERE is_active = true
      `;
      const latencyMs = Date.now() - start;
      const count = Number(result[0]?.count ?? 0);

      return {
        available: count > 0,
        latencyMs,
        videoCount: count,
        lastError: null,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      log.error('pool-provider health check failed', { err: message });

      return {
        available: false,
        latencyMs,
        videoCount: null,
        lastError: message,
      };
    }
  }

  /**
   * Delegate to matchFromVideoPool(), then convert CachedMatch[] to
   * VideoCandidate[], filtering excluded IDs and respecting the budget cap.
   */
  async match(request: MatchRequest): Promise<MatchResult> {
    const start = Date.now();

    const rawMatches = await matchFromVideoPool({
      mandalaId: request.mandalaId,
      language: request.language,
      perCell: PER_CELL_LIMIT,
    });

    const candidates = rawMatches
      .filter((m) => !request.excludeVideoIds.has(m.videoId))
      .slice(0, request.budget)
      .map((m): VideoCandidate => cachedMatchToCandidate(m));

    const latencyMs = Date.now() - start;

    log.info('pool-provider match complete', {
      mandalaId: request.mandalaId,
      rawCount: rawMatches.length,
      candidateCount: candidates.length,
      latencyMs,
    });

    return {
      candidates,
      meta: {
        source: PROVIDER_SOURCE,
        latencyMs,
        candidateCount: candidates.length,
        quotaUsed: 0, // DB query, no external quota
      },
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map a CachedMatch (cache-matcher output) to the provider-agnostic
 * VideoCandidate shape.
 */
function cachedMatchToCandidate(m: CachedMatch): VideoCandidate {
  return {
    videoId: m.videoId,
    title: m.title,
    description: m.description,
    channelId: m.channelId,
    channelTitle: m.channelName,
    durationSec: m.durationSec,
    publishedAt: m.publishedAt,
    thumbnailUrl: m.thumbnail,
    viewCount: m.viewCount,
    likeCount: m.likeCount,
    relevanceScore: m.score,
    cellIndex: m.cellIndex,
    source: PROVIDER_SOURCE,
  };
}
