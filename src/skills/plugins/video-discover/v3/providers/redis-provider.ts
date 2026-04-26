/**
 * RedisProvider — video-dictionary cache provider.
 *
 * Sources videos from Redis video-dictionary (pre-collected on Mac Mini).
 * Key structure:
 *   topic:{slug}  — SET of video IDs
 *   video:{id}    — HASH of video metadata (title, channel_id, channel_title,
 *                   duration_sec, published_at, thumbnail_url, view_count, like_count)
 *
 * Performance: uses Redis pipeline for bulk HGETALL (CC review #511).
 * Mapping: sub_goal text → topic slug via token overlap against slug index.
 *
 * Issue: #511
 */

import { getInsightaRedisClient } from '@/modules/redis/client';
import { logger } from '@/utils/logger';
import type {
  VideoProvider,
  ProviderHealth,
  MatchRequest,
  MatchResult,
  VideoCandidate,
  CellDefinition,
} from './types';

const log = logger.child({ module: 'RedisProvider' });

const PROVIDER_ID = 'redis';
const PROVIDER_PRIORITY = 1;
const MAX_VIDEOS_PER_TOPIC = 30;
const TOPIC_INDEX_KEY = 'topic:index';
const TOPIC_KEY_PREFIX = 'topic:';
const VIDEO_KEY_PREFIX = 'video:';

// ============================================================================
// Provider
// ============================================================================

export class RedisProvider implements VideoProvider {
  readonly id = PROVIDER_ID;
  readonly priority = PROVIDER_PRIORITY;

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const redis = await getInsightaRedisClient();
      if (!redis) {
        return {
          available: false,
          latencyMs: null,
          videoCount: null,
          lastError: 'Redis not configured',
        };
      }
      const topicCount = await redis.sCard(TOPIC_INDEX_KEY).catch(() => 0);
      const latencyMs = Date.now() - start;
      return {
        available: topicCount > 0,
        latencyMs,
        videoCount: null,
        lastError: topicCount === 0 ? 'topic:index SET is empty' : null,
      };
    } catch (err) {
      return {
        available: false,
        latencyMs: Date.now() - start,
        videoCount: null,
        lastError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async match(request: MatchRequest): Promise<MatchResult> {
    const start = Date.now();
    const redis = await getInsightaRedisClient();
    if (!redis) {
      return emptyResult(start);
    }

    // 1. Load topic slug index
    const allSlugs = await redis.sMembers(TOPIC_INDEX_KEY).catch(() => [] as string[]);
    if (allSlugs.length === 0) {
      log.info('RedisProvider: topic:index empty — skipping');
      return emptyResult(start);
    }

    // 2. Map each cell's sub_goal → matching topic slugs
    const cellSlugMap = matchCellsToSlugs(request.cells, allSlugs);

    // 3. Collect video IDs from matched topics (SMEMBERS per topic, pipeline)
    const videoIdsByCell = new Map<number, Set<string>>();
    for (const [cellIndex, slugs] of cellSlugMap) {
      const cellVideoIds = new Set<string>();
      for (const slug of slugs) {
        const members = await redis
          .sMembers(`${TOPIC_KEY_PREFIX}${slug}`)
          .catch(() => [] as string[]);
        for (const vid of members.slice(0, MAX_VIDEOS_PER_TOPIC)) {
          if (!request.excludeVideoIds.has(vid)) {
            cellVideoIds.add(vid);
          }
        }
      }
      if (cellVideoIds.size > 0) {
        videoIdsByCell.set(cellIndex, cellVideoIds);
      }
    }

    // 4. Collect all unique video IDs for bulk fetch
    const allVideoIds = new Set<string>();
    for (const ids of videoIdsByCell.values()) {
      for (const id of ids) allVideoIds.add(id);
    }

    if (allVideoIds.size === 0) {
      log.info('RedisProvider: no videos matched any cell slug');
      return emptyResult(start);
    }

    // 5. Bulk HGETALL via pipeline (CC review: avoid N round-trips)
    const videoIds = [...allVideoIds];
    const videoDataMap = await bulkFetchVideos(redis, videoIds);

    // 6. Build candidates per cell
    const candidates: VideoCandidate[] = [];
    let remaining = request.budget;

    for (const [cellIndex, cellVideoIds] of videoIdsByCell) {
      if (remaining <= 0) break;
      for (const videoId of cellVideoIds) {
        if (remaining <= 0) break;
        const data = videoDataMap.get(videoId);
        if (!data) continue;

        candidates.push({
          videoId,
          title: data.title ?? '',
          description: data.description_excerpt ?? null,
          channelId: data.channel_id ?? null,
          channelTitle: data.channel_title ?? null,
          durationSec: parseDuration(data),
          publishedAt: data.published_at ? new Date(data.published_at) : null,
          thumbnailUrl: extractThumbnail(data),
          viewCount: data.view_count ? Number(data.view_count) : null,
          likeCount: data.like_count ? Number(data.like_count) : null,
          relevanceScore: 0.5,
          cellIndex,
          source: 'redis',
        });
        remaining--;
      }
    }

    const latencyMs = Date.now() - start;
    log.info('RedisProvider matched', {
      slugsMatched: [...cellSlugMap.values()].reduce((sum, s) => sum + s.length, 0),
      videosFound: allVideoIds.size,
      candidatesReturned: candidates.length,
      latencyMs,
    });

    return {
      candidates,
      meta: {
        source: PROVIDER_ID,
        latencyMs,
        candidateCount: candidates.length,
        quotaUsed: 0,
      },
    };
  }
}

// ============================================================================
// Slug matching — sub_goal text → topic slugs
// ============================================================================

function matchCellsToSlugs(cells: CellDefinition[], allSlugs: string[]): Map<number, string[]> {
  const result = new Map<number, string[]>();

  for (const cell of cells) {
    const tokens = extractTokens(cell.subGoal);
    const keywordTokens = cell.keywords.flatMap(extractTokens);
    const allTokens = new Set([...tokens, ...keywordTokens]);

    const matched: string[] = [];
    for (const slug of allSlugs) {
      const slugParts = slug.split('-').filter((p) => p.length > 1);
      const overlap = slugParts.filter((part) => allTokens.has(part.toLowerCase()));
      const minOverlap = slugParts.length === 1 ? 1 : 2;
      if (overlap.length >= minOverlap) {
        matched.push(slug);
      }
    }

    if (matched.length > 0) {
      result.set(cell.cellIndex, matched);
    }
  }

  return result;
}

function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ============================================================================
// Bulk video fetch via pipeline
// ============================================================================

interface VideoHash {
  title?: string;
  channel_id?: string;
  channel_title?: string;
  duration_sec?: string;
  duration_seconds?: string;
  published_at?: string;
  thumbnail_url?: string;
  thumbnail_urls?: string;
  view_count?: string;
  like_count?: string;
  description_excerpt?: string;
}

async function bulkFetchVideos(
  redis: NonNullable<Awaited<ReturnType<typeof getInsightaRedisClient>>>,
  videoIds: string[]
): Promise<Map<string, VideoHash>> {
  const result = new Map<string, VideoHash>();

  const pipeline = redis.multi();
  for (const vid of videoIds) {
    pipeline.hGetAll(`${VIDEO_KEY_PREFIX}${vid}`);
  }

  try {
    const replies = await pipeline.exec();
    for (let i = 0; i < videoIds.length; i++) {
      const data = replies[i] as Record<string, string> | null;
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        result.set(videoIds[i]!, data as VideoHash);
      }
    }
  } catch (err) {
    log.warn('Redis pipeline bulk fetch failed', {
      count: videoIds.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function extractThumbnail(data: VideoHash): string | null {
  if (data.thumbnail_url) return data.thumbnail_url;
  if (!data.thumbnail_urls) return null;
  try {
    const parsed = JSON.parse(data.thumbnail_urls);
    return parsed.high ?? parsed.standard ?? parsed.medium ?? parsed.default ?? null;
  } catch {
    return null;
  }
}

function parseDuration(data: VideoHash): number | null {
  const raw = data.duration_seconds ?? data.duration_sec;
  return raw ? Number(raw) : null;
}

function emptyResult(startMs: number): MatchResult {
  return {
    candidates: [],
    meta: {
      source: PROVIDER_ID,
      latencyMs: Date.now() - startMs,
      candidateCount: 0,
      quotaUsed: 0,
    },
  };
}
