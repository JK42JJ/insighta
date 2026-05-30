/**
 * v5 YouTube fanout — parallel search.list across rule-based queries.
 *
 * Strategy:
 *   - buildRuleBasedQueriesSync (no LLM; sub-ms) → N queries
 *   - Promise.allSettled with per-call timeout (single slow query never
 *     blocks the cohort)
 *   - Dedup by videoId, drop Shorts via title heuristic (cheap; no
 *     videos.list call in the hot path)
 *   - Cap raw pool to dedupHardCap (default 120) before handing to LLM
 *
 * Quota cost (worst case): maxQueries × 100 units. With default 8 →
 * 800 units / Add Cards call.
 */

import { logger } from '@/utils/logger';
import {
  searchVideos,
  resolveSearchApiKeys,
  titleIndicatesShorts,
  titleHitsBlocklist,
  type YouTubeSearchItem,
} from '../v2/youtube-client';
import { buildRuleBasedQueriesSync } from '../v2/keyword-builder';
import { getV5Config } from './config';

const log = logger.child({ module: 'video-discover/v5/youtube-fanout' });

export interface FanoutInput {
  centerGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  env: NodeJS.ProcessEnv;
}

export interface FanoutCandidate {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnailUrl: string;
  cellIndex: number | null;
}

export interface FanoutResult {
  candidates: FanoutCandidate[];
  queriesAttempted: number;
  queriesSucceeded: number;
  rawItemCount: number;
  quotaUnitsApprox: number;
}

export async function runYouTubeFanout(input: FanoutInput): Promise<FanoutResult> {
  const cfg = getV5Config(input.env);
  const apiKeys = resolveSearchApiKeys(input.env);
  if (apiKeys.length === 0) {
    log.warn('v5 fanout: no YouTube API keys configured');
    return {
      candidates: [],
      queriesAttempted: 0,
      queriesSucceeded: 0,
      rawItemCount: 0,
      quotaUnitsApprox: 0,
    };
  }

  const queries = buildRuleBasedQueriesSync(
    {
      centerGoal: input.centerGoal,
      subGoals: input.subGoals,
      focusTags: input.focusTags,
      targetLevel: input.targetLevel,
      language: input.language,
    },
    cfg.maxQueries
  );

  if (queries.length === 0) {
    return {
      candidates: [],
      queriesAttempted: 0,
      queriesSucceeded: 0,
      rawItemCount: 0,
      quotaUnitsApprox: 0,
    };
  }

  const results = await Promise.allSettled(
    queries.map((q) =>
      searchVideos({
        query: q.query,
        apiKey: apiKeys,
        maxResults: cfg.searchMaxResults,
        relevanceLanguage: input.language,
        timeoutMs: cfg.searchTimeoutMs,
      }).then((items) => ({ items, cellIndex: q.cellIndex ?? null }))
    )
  );

  let rawItemCount = 0;
  let queriesSucceeded = 0;
  const seen = new Map<string, FanoutCandidate>();

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      log.debug(`v5 fanout query rejected: ${String(r.reason)}`);
      continue;
    }
    queriesSucceeded += 1;
    const { items, cellIndex } = r.value;
    for (const it of items) {
      rawItemCount += 1;
      const cand = toFanoutCandidate(it, cellIndex);
      if (!cand) continue;
      if (seen.has(cand.videoId)) continue;
      if (titleHitsBlocklist(cand.title) || titleIndicatesShorts(cand.title)) continue;
      seen.set(cand.videoId, cand);
      if (seen.size >= cfg.dedupHardCap) break;
    }
    if (seen.size >= cfg.dedupHardCap) break;
  }

  return {
    candidates: Array.from(seen.values()),
    queriesAttempted: queries.length,
    queriesSucceeded,
    rawItemCount,
    quotaUnitsApprox: queries.length * 100,
  };
}

function toFanoutCandidate(
  item: YouTubeSearchItem,
  cellIndex: number | null
): FanoutCandidate | null {
  const videoId = item.id?.videoId;
  if (!videoId) return null;
  const sn = item.snippet ?? {};
  return {
    videoId,
    title: sn.title ?? '',
    description: sn.description ?? '',
    channelTitle: sn.channelTitle ?? '',
    channelId: sn.channelId ?? '',
    publishedAt: sn.publishedAt ?? '',
    thumbnailUrl: sn.thumbnails?.high?.url ?? '',
    cellIndex,
  };
}
