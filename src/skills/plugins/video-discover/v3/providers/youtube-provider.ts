/**
 * YouTubeProvider — VideoProvider backed by live YouTube Data API search.
 *
 * Priority 3 (lowest): used as fallback when RedisProvider and PoolProvider
 * cannot satisfy the budget. Makes real HTTP calls to search.list + videos.list
 * so quota cost is ~100 units per query.
 *
 * Responsibilities:
 *   - Build search queries from MatchRequest cells via buildRuleBasedQueriesSync
 *   - Fan out parallel searchVideos() calls with per-call timeout
 *   - Batch-fetch video stats (viewCount, duration) via videosBatch()
 *   - Filter shorts (duration + title) and blocklist titles
 *   - Assign cellIndex from the query that produced the candidate
 *     (fallback: 0 for mandala-wide queries)
 *   - Respect excludeVideoIds and budget
 *   - Track quota usage in MatchMeta
 *
 * Mandala-level filtering (center gate + sub-goal jaccard) is intentionally
 * NOT performed here — that is the orchestrator's job. The provider emits raw
 * candidates with only basic content-hygiene filtering applied.
 *
 * Issue: #508
 */

import { logger } from '@/utils/logger';
import { MS_PER_DAY } from '@/utils/time-constants';
import { buildRuleBasedQueriesSync } from '../../v2/keyword-builder';
import {
  searchVideos,
  videosBatch,
  parseIsoDuration,
  isShortsByDuration,
  titleIndicatesShorts,
  titleHitsBlocklist,
  type YouTubeSearchItem,
  type YouTubeVideoStatsItem,
} from '../../v2/youtube-client';
import { v3Config } from '../config';
import type {
  VideoProvider,
  ProviderHealth,
  MatchRequest,
  MatchResult,
  VideoCandidate,
} from './types';

const log = logger.child({ module: 'video-discover/v3/providers/youtube-provider' });

// ============================================================================
// Quota constants
// Each search.list call costs 100 units; each videos.list (any batch size ≤ 50)
// costs 1 unit. Values mirror the YouTube Data API v3 quota documentation.
// ============================================================================

const QUOTA_UNITS_PER_SEARCH = 100;
const QUOTA_UNITS_PER_VIDEOS_BATCH = 1;

// Number of videos.list batches is Math.ceil(candidates / 50).
// VIDEOS_LIST_MAX_IDS_PER_CALL = 50 is already enforced inside videosBatch().

// ============================================================================
// Internal pool item (pre-enrichment shape)
// ============================================================================

interface PoolItem {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  /** Cell index from the query that produced this item. Null for mandala-wide queries. */
  cellIndexHint: number | null;
}

// ============================================================================
// YouTubeProvider
// ============================================================================

export class YouTubeProvider implements VideoProvider {
  readonly id = 'youtube';
  readonly priority = 3;

  private readonly apiKeys: string[];

  constructor(apiKeys: string[]) {
    this.apiKeys = apiKeys;
  }

  /**
   * Health check: available when at least one API key is configured.
   * Does not make a network call — checking key presence is sufficient
   * to determine whether this provider can be attempted.
   */
  async health(): Promise<ProviderHealth> {
    const available = this.apiKeys.length > 0;
    return {
      available,
      latencyMs: null,
      videoCount: null,
      lastError: available ? null : 'No YouTube API keys configured',
    };
  }

  /**
   * Fetch video candidates from YouTube for the given mandala cells.
   *
   * Steps:
   *   1. Build rule-based search queries per cell
   *   2. Fan out searchVideos() in parallel (Promise.allSettled + timeout)
   *   3. Deduplicate the raw pool by videoId
   *   4. videosBatch() for duration + view/like counts
   *   5. Filter shorts and blocklist entries
   *   6. Exclude already-seen videoIds
   *   7. Assign cellIndex (from query hint or 0 for mandala-wide queries)
   *   8. Cap at budget, compute quota used
   */
  async match(request: MatchRequest): Promise<MatchResult> {
    const t0 = Date.now();

    if (this.apiKeys.length === 0) {
      return {
        candidates: [],
        meta: { source: this.id, latencyMs: 0, candidateCount: 0, quotaUsed: 0 },
      };
    }

    // ── Step 1: build queries ─────────────────────────────────────────────
    const subGoals = request.cells.map((c) => c.subGoal);
    const queries = buildRuleBasedQueriesSync(
      {
        centerGoal: request.centerGoal,
        subGoals,
        focusTags: request.focusTags,
        language: request.language,
      },
      v3Config.maxQueries
    );

    if (queries.length === 0) {
      return {
        candidates: [],
        meta: {
          source: this.id,
          latencyMs: Date.now() - t0,
          candidateCount: 0,
          quotaUsed: 0,
        },
      };
    }

    // ── Step 2: parallel YouTube search ───────────────────────────────────
    const regionCode = request.language === 'ko' ? 'KR' : 'US';
    const publishedAfter =
      v3Config.publishedAfterDays > 0
        ? new Date(Date.now() - v3Config.publishedAfterDays * MS_PER_DAY).toISOString()
        : undefined;

    const settled = await Promise.allSettled(
      queries.map(async (q, idx) => {
        // Rotate search order every 5 queries (mirrors executor Tier 2 strategy).
        const order: 'relevance' | 'viewCount' | 'date' | undefined =
          idx % 5 === 3 ? 'viewCount' : idx % 5 === 4 ? 'date' : undefined;
        // Interleave English queries for Korean mandalas at index mod-5 == 2.
        const queryLang = request.language === 'ko' && idx % 5 === 2 ? 'en' : request.language;
        try {
          const items = await searchVideos({
            query: q.query,
            apiKey: this.apiKeys,
            relevanceLanguage: queryLang,
            regionCode,
            order,
            timeoutMs: v3Config.youtubeSearchTimeoutMs,
            ...(publishedAfter ? { publishedAfter } : {}),
          });
          return { q, items, error: undefined as string | undefined };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[YouTubeProvider] search.list failed for "${q.query}": ${msg}`);
          return { q, items: [] as YouTubeSearchItem[], error: msg };
        }
      })
    );

    // Flatten settled results — the inner try/catch means fulfilled is the
    // only realistic outcome; rejected is a defensive guard.
    const searchResults = settled.map((r, idx) => {
      if (r.status === 'fulfilled') return r.value;
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      log.warn(
        `[YouTubeProvider] search.list settled=rejected for "${queries[idx]?.query ?? '?'}": ${reason}`
      );
      return { q: queries[idx]!, items: [] as YouTubeSearchItem[], error: reason };
    });

    // ── Step 3: deduplicate raw pool ──────────────────────────────────────
    const rawPool: PoolItem[] = [];
    const seenIds = new Set<string>();
    for (const { q, items } of searchResults) {
      for (const item of items) {
        const id = item.id?.videoId;
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rawPool.push({
          videoId: id,
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          channelTitle: item.snippet?.channelTitle ?? null,
          channelId: item.snippet?.channelId ?? null,
          thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? null,
          publishedAt: item.snippet?.publishedAt ?? null,
          cellIndexHint: q.cellIndex ?? null,
        });
      }
    }

    const quotaSearchUsed = queries.length * QUOTA_UNITS_PER_SEARCH;

    if (rawPool.length === 0) {
      return {
        candidates: [],
        meta: {
          source: this.id,
          latencyMs: Date.now() - t0,
          candidateCount: 0,
          quotaUsed: quotaSearchUsed,
        },
      };
    }

    // ── Step 4: videosBatch for stats ─────────────────────────────────────
    let statsItems: YouTubeVideoStatsItem[] = [];
    let quotaBatchUsed = 0;
    try {
      statsItems = await videosBatch({
        videoIds: rawPool.map((p) => p.videoId),
        apiKey: this.apiKeys,
      });
      // videosBatch() internally paginates in chunks of 50 (VIDEOS_LIST_MAX_IDS_PER_CALL).
      const batchCount = Math.ceil(rawPool.length / 50);
      quotaBatchUsed = batchCount * QUOTA_UNITS_PER_VIDEOS_BATCH;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`[YouTubeProvider] videos.list failed (continuing without stats): ${msg}`);
    }
    const statsById = new Map<string, YouTubeVideoStatsItem>();
    for (const s of statsItems) {
      if (s.id) statsById.set(s.id, s);
    }

    // ── Step 5: filter shorts + blocklist ─────────────────────────────────
    // Resolve the valid cell indices from the request so we can map
    // the query cellIndexHint back to a request-level cellIndex.
    const validCellIndices = new Set(request.cells.map((c) => c.cellIndex));

    const candidates: VideoCandidate[] = [];
    for (const p of rawPool) {
      // Skip already-excluded videos before doing any heavier work.
      if (request.excludeVideoIds.has(p.videoId)) continue;

      const s = statsById.get(p.videoId);
      const durationSec = parseIsoDuration(s?.contentDetails?.duration);

      if (isShortsByDuration(durationSec)) continue;
      if (titleIndicatesShorts(p.title)) continue;
      if (titleHitsBlocklist(p.title)) continue;

      const viewCount =
        s?.statistics?.viewCount != null ? parseInt(s.statistics.viewCount, 10) : null;
      const likeCount =
        s?.statistics?.likeCount != null ? parseInt(s.statistics.likeCount, 10) : null;

      // Resolve cellIndex: prefer the query's cellIndexHint when it names a
      // cell that is actually in this request; fall back to 0 (first cell)
      // for mandala-wide queries (core / focus / level sources).
      let cellIndex = 0;
      if (p.cellIndexHint !== null && validCellIndices.has(p.cellIndexHint)) {
        cellIndex = p.cellIndexHint;
      }

      candidates.push({
        videoId: p.videoId,
        title: p.title,
        description: p.description || null,
        channelId: p.channelId,
        channelTitle: p.channelTitle,
        durationSec,
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
        thumbnailUrl: p.thumbnailUrl,
        viewCount: Number.isFinite(viewCount) ? viewCount : null,
        likeCount: Number.isFinite(likeCount) ? likeCount : null,
        relevanceScore: 0, // raw YouTube results carry no pre-scored relevance
        cellIndex,
        source: 'youtube',
      });

      if (candidates.length >= request.budget) break;
    }

    const totalQuota = quotaSearchUsed + quotaBatchUsed;
    const latencyMs = Date.now() - t0;

    log.info(
      `[YouTubeProvider] mandala=${request.mandalaId} queries=${queries.length} rawPool=${rawPool.length} candidates=${candidates.length} quota=${totalQuota} latencyMs=${latencyMs}`
    );

    return {
      candidates,
      meta: {
        source: this.id,
        latencyMs,
        candidateCount: candidates.length,
        quotaUsed: totalQuota,
      },
    };
  }
}
